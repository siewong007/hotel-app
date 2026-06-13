//! Audit log data access

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{AuditLogQuery, AuditLogRow, AuditResourceTypeCount, AuditUserOption};

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
type AuditQueryAs<'q, O> = sqlx::query::QueryAs<'q, sqlx::Postgres, O, sqlx::postgres::PgArguments>;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
type AuditQueryAs<'q, O> =
    sqlx::query::QueryAs<'q, sqlx::Sqlite, O, sqlx::sqlite::SqliteArguments<'q>>;

pub struct AuditRepository;

impl AuditRepository {
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_event(
        pool: &DbPool,
        user_id: Option<i64>,
        action: &str,
        resource_type: &str,
        resource_id: Option<i64>,
        details: Option<Value>,
        ip_address: Option<String>,
        user_agent: Option<String>,
        created_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO audit_logs
            (user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
            VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8)
            "#,
        )
        .bind(user_id)
        .bind(action)
        .bind(resource_type)
        .bind(resource_id)
        .bind(details)
        .bind(ip_address)
        .bind(user_agent)
        .bind(created_at)
        .execute(pool)
        .await?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_logs(
        pool: &DbPool,
        params: &AuditLogQuery,
        category_types: Option<&Vec<String>>,
        sort_column: &str,
        sort_direction: &str,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<AuditLogRow>), ApiError> {
        let (where_clause, bind_index) = build_log_where_clause(params, category_types, true);

        let count_query = format!(
            r#"
            SELECT COUNT(*) as count
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {}
            "#,
            where_clause
        );

        let data_query = format!(
            r#"
            SELECT a.id, a.user_id, u.username, a.action, a.resource_type, a.resource_id,
                   a.details, a.ip_address, a.user_agent, a.created_at
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {}
            ORDER BY a.{} {}
            LIMIT ${} OFFSET ${}
            "#,
            where_clause,
            sort_column,
            sort_direction,
            bind_index,
            bind_index + 1
        );

        let mut count_sqlx = sqlx::query_scalar::<_, i64>(&count_query);
        if let Some(user_id) = params.user_id {
            count_sqlx = count_sqlx.bind(user_id);
        }
        if let Some(ref action) = params.action {
            count_sqlx = count_sqlx.bind(action.clone());
        }
        if let Some(ref resource_type) = params.resource_type {
            count_sqlx = count_sqlx.bind(resource_type.clone());
        }
        if let Some(ref start_date) = params.start_date {
            count_sqlx = count_sqlx.bind(start_date.clone());
        }
        if let Some(ref end_date) = params.end_date {
            count_sqlx = count_sqlx.bind(end_date.clone());
        }
        if let Some(ref search) = params.search {
            count_sqlx = count_sqlx.bind(format!("%{}%", search));
        }
        if let Some(types) = category_types {
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            {
                count_sqlx = count_sqlx.bind(types.clone());
            }
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            {
                for resource_type in types {
                    count_sqlx = count_sqlx.bind(resource_type.clone());
                }
            }
        }

        let total = count_sqlx
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to count audit logs: {}", e)))?;

        let mut data_sqlx = bind_log_filters(
            sqlx::query_as::<_, AuditLogRow>(&data_query),
            params,
            category_types,
        );
        data_sqlx = data_sqlx.bind(page_size);
        data_sqlx = data_sqlx.bind(offset);

        let rows = data_sqlx
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch audit logs: {}", e)))?;

        Ok((total, rows))
    }

    pub async fn list_actions(pool: &DbPool) -> Result<Vec<String>, ApiError> {
        sqlx::query_scalar::<_, String>("SELECT DISTINCT action FROM audit_logs ORDER BY action")
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch actions: {}", e)))
    }

    pub async fn list_resource_types(pool: &DbPool) -> Result<Vec<String>, ApiError> {
        sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT resource_type FROM audit_logs ORDER BY resource_type",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch resource types: {}", e)))
    }

    pub async fn list_logs_for_export(
        pool: &DbPool,
        params: &AuditLogQuery,
        category_types: Option<&Vec<String>>,
    ) -> Result<Vec<AuditLogRow>, ApiError> {
        let (where_clause, _) = build_log_where_clause(params, category_types, false);

        let query = format!(
            r#"
            SELECT a.id, a.user_id, u.username, a.action, a.resource_type, a.resource_id,
                   a.details, a.ip_address, a.user_agent, a.created_at
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {}
            ORDER BY a.created_at DESC
            LIMIT 10000
            "#,
            where_clause
        );

        bind_log_filters(
            sqlx::query_as::<_, AuditLogRow>(&query),
            params,
            category_types,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch audit logs: {}", e)))
    }

    pub async fn list_users(pool: &DbPool) -> Result<Vec<AuditUserOption>, ApiError> {
        sqlx::query_as::<_, AuditUserOption>(
            r#"
            SELECT DISTINCT u.id, u.username
            FROM users u
            INNER JOIN audit_logs a ON u.id = a.user_id
            ORDER BY u.username
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch users: {}", e)))
    }

    pub async fn count_by_resource_type(
        pool: &DbPool,
        params: &AuditLogQuery,
    ) -> Result<Vec<AuditResourceTypeCount>, ApiError> {
        let (where_clause, _) = build_category_count_where_clause(params);
        let query = format!(
            r#"
            SELECT a.resource_type AS resource_type, COUNT(*) AS count
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {}
            GROUP BY a.resource_type
            "#,
            where_clause
        );

        let mut query = sqlx::query_as::<_, AuditResourceTypeCount>(&query);
        if let Some(ref start_date) = params.start_date {
            query = query.bind(start_date);
        }
        if let Some(ref end_date) = params.end_date {
            query = query.bind(end_date);
        }
        if let Some(ref search) = params.search {
            query = query.bind(format!("%{}%", search));
        }

        query
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to count audit categories: {}", e)))
    }

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    pub async fn list_db_statements(pool: &DbPool, limit: i64) -> Result<Vec<Value>, sqlx::Error> {
        use sqlx::Row;

        let rows = sqlx::query(
            "SELECT query, calls, total_exec_time, mean_exec_time, rows \
             FROM pg_stat_statements \
             ORDER BY total_exec_time DESC \
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                serde_json::json!({
                    "query": row.try_get::<String, _>("query").unwrap_or_default(),
                    "calls": row.try_get::<i64, _>("calls").unwrap_or_default(),
                    "total_exec_time_ms": row.try_get::<f64, _>("total_exec_time").unwrap_or_default(),
                    "mean_exec_time_ms": row.try_get::<f64, _>("mean_exec_time").unwrap_or_default(),
                    "rows": row.try_get::<i64, _>("rows").unwrap_or_default(),
                })
            })
            .collect())
    }
}

fn build_log_where_clause(
    params: &AuditLogQuery,
    category_types: Option<&Vec<String>>,
    search_details: bool,
) -> (String, i32) {
    let mut where_clauses = Vec::new();
    let mut bind_index = 1;

    if params.user_id.is_some() {
        where_clauses.push(format!("a.user_id = ${}", bind_index));
        bind_index += 1;
    }
    if params.action.is_some() {
        where_clauses.push(format!("a.action = ${}", bind_index));
        bind_index += 1;
    }
    if params.resource_type.is_some() {
        where_clauses.push(format!("a.resource_type = ${}", bind_index));
        bind_index += 1;
    }
    if params.start_date.is_some() {
        where_clauses.push(format!("a.created_at >= ${}::timestamptz", bind_index));
        bind_index += 1;
    }
    if params.end_date.is_some() {
        where_clauses.push(format!("a.created_at <= ${}::timestamptz", bind_index));
        bind_index += 1;
    }
    if params.search.is_some() {
        let details_filter = if search_details {
            format!(" OR a.details::text ILIKE ${}", bind_index)
        } else {
            String::new()
        };
        where_clauses.push(format!(
            "(a.action ILIKE ${0} OR a.resource_type ILIKE ${0} OR u.username ILIKE ${0}{1})",
            bind_index, details_filter
        ));
        bind_index += 1;
    }
    if let Some(types) = category_types {
        if types.is_empty() {
            where_clauses.push("1 = 0".to_string());
        } else {
            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            {
                where_clauses.push(format!("a.resource_type = ANY(${})", bind_index));
                bind_index += 1;
            }

            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            {
                let placeholders = (0..types.len())
                    .map(|index| format!("${}", bind_index + index as i32))
                    .collect::<Vec<_>>()
                    .join(", ");
                where_clauses.push(format!("a.resource_type IN ({})", placeholders));
                bind_index += types.len() as i32;
            }
        }
    }

    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    (where_clause, bind_index)
}

fn build_category_count_where_clause(params: &AuditLogQuery) -> (String, i32) {
    let mut where_clauses = Vec::new();
    let mut bind_index = 1;

    if params.start_date.is_some() {
        where_clauses.push(format!("a.created_at >= ${}::timestamptz", bind_index));
        bind_index += 1;
    }
    if params.end_date.is_some() {
        where_clauses.push(format!("a.created_at <= ${}::timestamptz", bind_index));
        bind_index += 1;
    }
    if params.search.is_some() {
        where_clauses.push(format!(
            "(a.action ILIKE ${0} OR a.resource_type ILIKE ${0} OR u.username ILIKE ${0} OR a.details::text ILIKE ${0})",
            bind_index
        ));
    }

    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    (where_clause, bind_index)
}

fn bind_log_filters<'q, O>(
    mut query: AuditQueryAs<'q, O>,
    params: &AuditLogQuery,
    category_types: Option<&Vec<String>>,
) -> AuditQueryAs<'q, O> {
    if let Some(user_id) = params.user_id {
        query = query.bind(user_id);
    }
    if let Some(ref action) = params.action {
        query = query.bind(action.clone());
    }
    if let Some(ref resource_type) = params.resource_type {
        query = query.bind(resource_type.clone());
    }
    if let Some(ref start_date) = params.start_date {
        query = query.bind(start_date.clone());
    }
    if let Some(ref end_date) = params.end_date {
        query = query.bind(end_date.clone());
    }
    if let Some(ref search) = params.search {
        query = query.bind(format!("%{}%", search));
    }
    if let Some(types) = category_types {
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        {
            query = query.bind(types.clone());
        }
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            for resource_type in types {
                query = query.bind(resource_type.clone());
            }
        }
    }

    query
}
