//! Company data access

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
use rust_decimal::Decimal;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{Company, CompanyCreateRequest, CompanyListQuery, CompanyUpdateRequest};

pub struct CompanyRepository;

impl CompanyRepository {
    pub async fn list(pool: &DbPool, query: &CompanyListQuery) -> Result<Vec<Company>, ApiError> {
        let limit = query.limit.unwrap_or(100).min(500) as i64;
        let offset = query.offset.unwrap_or(0) as i64;

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let rows = {
            let is_active_i32 = query.is_active.map(|value| if value { 1i32 } else { 0i32 });
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
            .fetch_all(pool)
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
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
        };

        Ok(rows.iter().map(row_mappers::row_to_company).collect())
    }

    pub async fn find_by_id(pool: &DbPool, company_id: i64) -> Result<Option<Company>, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
            SELECT id, company_name, registration_number, contact_person,
                   contact_email, contact_phone, billing_address, billing_city,
                   billing_state, billing_postal_code, billing_country, is_active,
                   credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
            FROM companies
            WHERE id = $1
            "#,
            sqlite: r#"
            SELECT id, company_name, registration_number, contact_person,
                   contact_email, contact_phone, billing_address, billing_city,
                   billing_state, billing_postal_code, billing_country, is_active,
                   credit_limit, payment_terms_days, notes, created_by, created_at, updated_at
            FROM companies
            WHERE id = ?1
            "#
        );

        let row = sqlx::query(query)
            .bind(company_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(row.as_ref().map(row_mappers::row_to_company))
    }

    pub async fn exists_by_id(pool: &DbPool, company_id: i64) -> Result<bool, ApiError> {
        let query = crate::sql_query!(
            postgres: "SELECT EXISTS(SELECT 1 FROM companies WHERE id = $1)",
            sqlite: "SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)"
        );

        sqlx::query_scalar::<_, bool>(query)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn exists_by_name(pool: &DbPool, company_name: &str) -> Result<bool, ApiError> {
        let query = crate::sql_query!(
            postgres: "SELECT EXISTS(SELECT 1 FROM companies WHERE LOWER(company_name) = LOWER($1))",
            sqlite: "SELECT EXISTS(SELECT 1 FROM companies WHERE LOWER(company_name) = LOWER(?1))"
        );

        sqlx::query_scalar::<_, bool>(query)
            .bind(company_name)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn exists_by_name_except_id(
        pool: &DbPool,
        company_name: &str,
        company_id: i64,
    ) -> Result<bool, ApiError> {
        let query = crate::sql_query!(
            postgres: "SELECT EXISTS(SELECT 1 FROM companies WHERE LOWER(company_name) = LOWER($1) AND id != $2)",
            sqlite: "SELECT EXISTS(SELECT 1 FROM companies WHERE LOWER(company_name) = LOWER(?1) AND id != ?2)"
        );

        sqlx::query_scalar::<_, bool>(query)
            .bind(company_name)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn insert(
        pool: &DbPool,
        input: &CompanyCreateRequest,
        user_id: i64,
    ) -> Result<Company, ApiError> {
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
            .bind(input.credit_limit)
            .bind(input.payment_terms_days)
            .bind(&input.notes)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            let company_id: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
                .fetch_one(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

            Self::find_by_id(pool, company_id).await?.ok_or_else(|| {
                ApiError::Database("Inserted company could not be read".to_string())
            })?
        };

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let company = {
            let credit_limit = input
                .credit_limit
                .map(|value| Decimal::from_f64_retain(value).unwrap_or_default());

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
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            row_mappers::row_to_company(&row)
        };

        Ok(company)
    }

    pub async fn update(
        pool: &DbPool,
        company_id: i64,
        input: &CompanyUpdateRequest,
    ) -> Result<(), ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            let is_active_i32 = input.is_active.map(|value| if value { 1i32 } else { 0i32 });

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
            .bind(input.credit_limit)
            .bind(input.payment_terms_days)
            .bind(&input.notes)
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        {
            let credit_limit = input
                .credit_limit
                .map(|value| Decimal::from_f64_retain(value).unwrap_or_default());

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
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        Ok(())
    }

    pub async fn delete(pool: &DbPool, company_id: i64) -> Result<u64, ApiError> {
        let query = crate::sql_query!(
            postgres: "DELETE FROM companies WHERE id = $1",
            sqlite: "DELETE FROM companies WHERE id = ?1"
        );

        sqlx::query(query)
            .bind(company_id)
            .execute(pool)
            .await
            .map(|result| result.rows_affected())
            .map_err(|e| ApiError::Database(e.to_string()))
    }
}
