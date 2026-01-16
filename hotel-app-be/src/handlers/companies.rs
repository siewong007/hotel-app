//! Company handlers
//!
//! Handles company CRUD operations for direct billing.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::Row;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::{Company, CompanyCreateRequest, CompanyUpdateRequest, row_mappers};

/// Query parameters for listing companies
#[derive(Debug, Deserialize)]
pub struct CompanyListQuery {
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

/// List all companies with optional filters
pub async fn list_companies_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<CompanyListQuery>,
) -> Result<Json<Vec<Company>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let limit = query.limit.unwrap_or(100).min(500) as i64;
    let offset = query.offset.unwrap_or(0) as i64;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let rows = {
        // SQLite version: use ?N parameters, no ::text casts, LIKE instead of ILIKE
        // For boolean, bind as i32 (0/1)
        let is_active_i32 = query.is_active.map(|b| if b { 1i32 } else { 0i32 });

        sqlx::query(
            r#"
            SELECT id, company_name, registration_number, contact_person,
                   contact_email, contact_phone, billing_address, billing_city,
                   billing_state, billing_postal_code, billing_country, is_active,
                   credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
            FROM companies
            WHERE (?1 IS NULL OR company_name LIKE '%' || ?1 || '%')
              AND (?2 IS NULL OR is_active = ?2)
            ORDER BY company_name ASC
            LIMIT ?3 OFFSET ?4
            "#,
        )
        .bind(query.search.as_deref())
        .bind(is_active_i32)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let rows = {
        sqlx::query(
            r#"
            SELECT id, company_name, registration_number, contact_person,
                   contact_email, contact_phone, billing_address, billing_city,
                   billing_state, billing_postal_code, billing_country, is_active,
                   credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
            FROM companies
            WHERE ($1::text IS NULL OR company_name ILIKE '%' || $1 || '%')
              AND ($2::bool IS NULL OR is_active = $2)
            ORDER BY company_name ASC
            LIMIT $3 OFFSET $4
            "#,
        )
        .bind(query.search.as_deref())
        .bind(query.is_active)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    let companies: Vec<Company> = rows.iter().map(|row| row_mappers::row_to_company(row)).collect();

    Ok(Json(companies))
}

/// Get a single company by ID
pub async fn get_company_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(company_id): Path<i64>,
) -> Result<Json<Company>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query = r#"
        SELECT id, company_name, registration_number, contact_person,
               contact_email, contact_phone, billing_address, billing_city,
               billing_state, billing_postal_code, billing_country, is_active,
               credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
        FROM companies
        WHERE id = ?1
        "#;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query = r#"
        SELECT id, company_name, registration_number, contact_person,
               contact_email, contact_phone, billing_address, billing_city,
               billing_state, billing_postal_code, billing_country, is_active,
               credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
        FROM companies
        WHERE id = $1
        "#;

    let row = sqlx::query(query)
        .bind(company_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Company not found".to_string()))?;

    Ok(Json(row_mappers::row_to_company(&row)))
}

/// Create a new company
pub async fn create_company_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<CompanyCreateRequest>,
) -> Result<Json<Company>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if company with same name already exists
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM companies WHERE LOWER(company_name) = LOWER(?1)",
    )
    .bind(&input.company_name)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM companies WHERE LOWER(company_name) = LOWER($1)",
    )
    .bind(&input.company_name)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing.is_some() {
        return Err(ApiError::Conflict(format!(
            "Company '{}' already exists",
            input.company_name
        )));
    }

    // Convert credit_limit to f64 for database binding (works for both SQLite and PostgreSQL)
    let credit_limit_f64 = input.credit_limit;

    // SQLite version: no RETURNING clause, use separate SELECT
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let company = {
        sqlx::query(
            r#"
            INSERT INTO companies (
                company_name, registration_number, contact_person, contact_email,
                contact_phone, billing_address, billing_city, billing_state,
                billing_postal_code, billing_country, is_active, credit_limit,
                payment_terms_days, notes, created_by
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12, ?13, ?14)
            "#,
        )
        .bind(&input.company_name)
        .bind(&input.registration_number)
        .bind(&input.contact_person)
        .bind(&input.contact_email)
        .bind(&input.contact_phone)
        .bind(&input.billing_address)
        .bind(&input.billing_city)
        .bind(&input.billing_state)
        .bind(&input.billing_postal_code)
        .bind(&input.billing_country)
        .bind(credit_limit_f64)
        .bind(input.payment_terms_days)
        .bind(&input.notes)
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let company_id: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let row = sqlx::query(
            r#"
            SELECT id, company_name, registration_number, contact_person,
                   contact_email, contact_phone, billing_address, billing_city,
                   billing_state, billing_postal_code, billing_country, is_active,
                   credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
            FROM companies
            WHERE id = ?1
            "#,
        )
        .bind(company_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        row_mappers::row_to_company(&row)
    };

    // PostgreSQL version: use RETURNING clause
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let company = {
        let credit_limit = input.credit_limit.map(|v| Decimal::from_f64_retain(v).unwrap_or_default());

        let row = sqlx::query(
            r#"
            INSERT INTO companies (
                company_name, registration_number, contact_person, contact_email,
                contact_phone, billing_address, billing_city, billing_state,
                billing_postal_code, billing_country, is_active, credit_limit,
                payment_terms_days, notes, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13, $14)
            RETURNING id, company_name, registration_number, contact_person,
                      contact_email, contact_phone, billing_address, billing_city,
                      billing_state, billing_postal_code, billing_country, is_active,
                      credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
            "#,
        )
        .bind(&input.company_name)
        .bind(&input.registration_number)
        .bind(&input.contact_person)
        .bind(&input.contact_email)
        .bind(&input.contact_phone)
        .bind(&input.billing_address)
        .bind(&input.billing_city)
        .bind(&input.billing_state)
        .bind(&input.billing_postal_code)
        .bind(&input.billing_country)
        .bind(credit_limit)
        .bind(input.payment_terms_days)
        .bind(&input.notes)
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        row_mappers::row_to_company(&row)
    };

    Ok(Json(company))
}

/// Update a company
pub async fn update_company_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(company_id): Path<i64>,
    Json(input): Json<CompanyUpdateRequest>,
) -> Result<Json<Company>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    // Check if company exists
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM companies WHERE id = ?1")
        .bind(company_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM companies WHERE id = $1")
        .bind(company_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing.is_none() {
        return Err(ApiError::NotFound("Company not found".to_string()));
    }

    // Check for duplicate name if updating name
    if let Some(ref new_name) = input.company_name {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let duplicate: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM companies WHERE LOWER(company_name) = LOWER(?1) AND id != ?2",
        )
        .bind(new_name)
        .bind(company_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let duplicate: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM companies WHERE LOWER(company_name) = LOWER($1) AND id != $2",
        )
        .bind(new_name)
        .bind(company_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if duplicate.is_some() {
            return Err(ApiError::Conflict(format!(
                "Company '{}' already exists",
                new_name
            )));
        }
    }

    // SQLite version: use ?N parameters, datetime('now'), bind booleans as i32
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        // Convert credit_limit to f64 for SQLite
        let credit_limit_f64 = input.credit_limit;
        // Convert is_active to i32 for SQLite
        let is_active_i32 = input.is_active.map(|b| if b { 1i32 } else { 0i32 });

        sqlx::query(
            r#"
            UPDATE companies SET
                company_name = COALESCE(?1, company_name),
                registration_number = COALESCE(?2, registration_number),
                contact_person = COALESCE(?3, contact_person),
                contact_email = COALESCE(?4, contact_email),
                contact_phone = COALESCE(?5, contact_phone),
                billing_address = COALESCE(?6, billing_address),
                billing_city = COALESCE(?7, billing_city),
                billing_state = COALESCE(?8, billing_state),
                billing_postal_code = COALESCE(?9, billing_postal_code),
                billing_country = COALESCE(?10, billing_country),
                is_active = COALESCE(?11, is_active),
                credit_limit = COALESCE(?12, credit_limit),
                payment_terms_days = COALESCE(?13, payment_terms_days),
                notes = COALESCE(?14, notes),
                updated_at = datetime('now')
            WHERE id = ?15
            "#,
        )
        .bind(&input.company_name)
        .bind(&input.registration_number)
        .bind(&input.contact_person)
        .bind(&input.contact_email)
        .bind(&input.contact_phone)
        .bind(&input.billing_address)
        .bind(&input.billing_city)
        .bind(&input.billing_state)
        .bind(&input.billing_postal_code)
        .bind(&input.billing_country)
        .bind(is_active_i32)
        .bind(credit_limit_f64)
        .bind(input.payment_terms_days)
        .bind(&input.notes)
        .bind(company_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // PostgreSQL version: use $N parameters, NOW(), native booleans
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    {
        let credit_limit = input.credit_limit.map(|v| Decimal::from_f64_retain(v).unwrap_or_default());

        sqlx::query(
            r#"
            UPDATE companies SET
                company_name = COALESCE($1, company_name),
                registration_number = COALESCE($2, registration_number),
                contact_person = COALESCE($3, contact_person),
                contact_email = COALESCE($4, contact_email),
                contact_phone = COALESCE($5, contact_phone),
                billing_address = COALESCE($6, billing_address),
                billing_city = COALESCE($7, billing_city),
                billing_state = COALESCE($8, billing_state),
                billing_postal_code = COALESCE($9, billing_postal_code),
                billing_country = COALESCE($10, billing_country),
                is_active = COALESCE($11, is_active),
                credit_limit = COALESCE($12, credit_limit),
                payment_terms_days = COALESCE($13, payment_terms_days),
                notes = COALESCE($14, notes),
                updated_at = NOW()
            WHERE id = $15
            "#,
        )
        .bind(&input.company_name)
        .bind(&input.registration_number)
        .bind(&input.contact_person)
        .bind(&input.contact_email)
        .bind(&input.contact_phone)
        .bind(&input.billing_address)
        .bind(&input.billing_city)
        .bind(&input.billing_state)
        .bind(&input.billing_postal_code)
        .bind(&input.billing_country)
        .bind(input.is_active)
        .bind(credit_limit)
        .bind(input.payment_terms_days)
        .bind(&input.notes)
        .bind(company_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // Fetch the updated company
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let row = sqlx::query(
        r#"
        SELECT id, company_name, registration_number, contact_person,
               contact_email, contact_phone, billing_address, billing_city,
               billing_state, billing_postal_code, billing_country, is_active,
               credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
        FROM companies
        WHERE id = ?1
        "#,
    )
    .bind(company_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let row = sqlx::query(
        r#"
        SELECT id, company_name, registration_number, contact_person,
               contact_email, contact_phone, billing_address, billing_city,
               billing_state, billing_postal_code, billing_country, is_active,
               credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
        FROM companies
        WHERE id = $1
        "#,
    )
    .bind(company_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(row_mappers::row_to_company(&row)))
}

/// Delete a company
pub async fn delete_company_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(company_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let result = sqlx::query("DELETE FROM companies WHERE id = ?1")
        .bind(company_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let result = sqlx::query("DELETE FROM companies WHERE id = $1")
        .bind(company_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Company not found".to_string()));
    }

    Ok(Json(serde_json::json!({
        "message": "Company deleted successfully"
    })))
}
