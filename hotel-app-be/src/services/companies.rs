//! Company workflows

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Company, CompanyCreateRequest, CompanyListQuery, CompanyUpdateRequest};
use crate::repositories::company::CompanyRepository;
use crate::services::audit::AuditLog;
use crate::models::AuditEvent;

pub async fn list_companies(
    pool: &DbPool,
    query: &CompanyListQuery,
) -> Result<Vec<Company>, ApiError> {
    CompanyRepository::list(pool, query).await
}

pub async fn get_company(pool: &DbPool, company_id: i64) -> Result<Company, ApiError> {
    CompanyRepository::find_by_id(pool, company_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Company not found".to_string()))
}

pub async fn create_company(
    pool: &DbPool,
    input: CompanyCreateRequest,
    user_id: i64,
) -> Result<Company, ApiError> {
    if CompanyRepository::exists_by_name(pool, &input.company_name).await? {
        return Err(ApiError::Conflict(format!(
            "Company '{}' already exists",
            input.company_name
        )));
    }

    let company = CompanyRepository::insert(pool, &input, user_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "company_created",
            resource_type: "company",
            resource_id: Some(company.id),
            details: Some(serde_json::json!({"name": &company.company_name})),
            ..Default::default()
        },
    )
    .await;

    Ok(company)
}

pub async fn update_company(
    pool: &DbPool,
    company_id: i64,
    input: CompanyUpdateRequest,
) -> Result<Company, ApiError> {
    if !CompanyRepository::exists_by_id(pool, company_id).await? {
        return Err(ApiError::NotFound("Company not found".to_string()));
    }

    if let Some(ref new_name) = input.company_name
        && CompanyRepository::exists_by_name_except_id(pool, new_name, company_id).await?
    {
        return Err(ApiError::Conflict(format!(
            "Company '{}' already exists",
            new_name
        )));
    }

    CompanyRepository::update(pool, company_id, &input).await?;
    let company = get_company(pool, company_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "company_updated",
            resource_type: "company",
            resource_id: Some(company_id),
            details: Some(serde_json::json!({"name": &company.company_name})),
            ..Default::default()
        },
    )
    .await;

    Ok(company)
}

pub async fn delete_company(pool: &DbPool, company_id: i64) -> Result<(), ApiError> {
    let rows_affected = CompanyRepository::delete(pool, company_id).await?;
    if rows_affected == 0 {
        return Err(ApiError::NotFound("Company not found".to_string()));
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "company_deleted",
            resource_type: "company",
            resource_id: Some(company_id),
            details: None,
            ..Default::default()
        },
    )
    .await;

    Ok(())
}
