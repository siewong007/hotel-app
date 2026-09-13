//! Persistence for guest_segments plus the dynamic membership queries
//! (`count_matching`/`sample_matching`) that the compiled rule clauses feed.

use sqlx::{Row, query, query_scalar};

use super::models::{GuestSegment, LoyaltyTierOption, SegmentDistinctValues, SegmentSampleGuest};
use super::rules::{self, CompiledClause};
use super::service::SegmentDraft;
use crate::core::db::{DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;

const SEGMENT_COLUMNS: &str = r#"
    id, name, slug, description, rules, is_active, created_by, updated_by,
    created_at, updated_at
"#;

fn required_timestamp(row: &DbRow, col: &str) -> chrono::DateTime<chrono::Utc> {
    row.try_get(col).unwrap_or_else(|_| chrono::Utc::now())
}

fn segment_from_row(row: &DbRow) -> GuestSegment {
    GuestSegment {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        slug: row.try_get("slug").unwrap_or_default(),
        description: row.try_get("description").ok().flatten(),
        rules: row.try_get("rules").unwrap_or(serde_json::json!({})),
        is_active: row.try_get("is_active").unwrap_or(true),
        created_at: required_timestamp(row, "created_at"),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

pub struct SegmentRepository;

impl SegmentRepository {
    pub async fn list(
        pool: &DbPool,
        search: Option<String>,
        is_active: Option<bool>,
        page_size: i64,
        offset: i64,
    ) -> Result<(Vec<GuestSegment>, i64), ApiError> {
        let total: i64 = query_scalar(
            r#"
                SELECT COUNT(*) FROM guest_segments
                WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%')
                  AND ($2::boolean IS NULL OR is_active = $2)
            "#,
        )
        .bind(&search)
        .bind(is_active)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        let rows = query(
            r#"
                SELECT id, name, slug, description, rules, is_active, created_by, updated_by,
                       created_at, updated_at
                FROM guest_segments
                WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%')
                  AND ($2::boolean IS NULL OR is_active = $2)
                ORDER BY name, id
                LIMIT $3 OFFSET $4
            "#,
        )
        .bind(&search)
        .bind(is_active)
        .bind(page_size)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok((rows.iter().map(segment_from_row).collect(), total))
    }

    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<GuestSegment>, ApiError> {
        let sql = format!("SELECT {SEGMENT_COLUMNS} FROM guest_segments WHERE id = $1");
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(segment_from_row))
    }

    pub async fn slug_exists(
        pool: &DbPool,
        slug: &str,
        exclude_id: Option<i64>,
    ) -> Result<bool, ApiError> {
        let exists: bool = query_scalar(
            "SELECT EXISTS(SELECT 1 FROM guest_segments WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2))",
        )
        .bind(slug)
        .bind(exclude_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(exists)
    }

    pub async fn insert_tx(
        tx: &mut DbTransaction<'_>,
        draft: &SegmentDraft,
        actor_id: i64,
    ) -> Result<i64, ApiError> {
        query_scalar(
            r#"
                INSERT INTO guest_segments (name, slug, description, rules, is_active, created_by, updated_by)
                VALUES ($1, $2, $3, $4, $5, $6, $6)
                RETURNING id
            "#,
        )
        .bind(&draft.name)
        .bind(&draft.slug)
        .bind(&draft.description)
        .bind(&draft.rules)
        .bind(draft.is_active)
        .bind(actor_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn update_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        draft: &SegmentDraft,
        actor_id: i64,
    ) -> Result<bool, ApiError> {
        let result = query(
            r#"
                UPDATE guest_segments SET
                    name = $1, slug = $2, description = $3, rules = $4,
                    is_active = $5, updated_by = $6, updated_at = CURRENT_TIMESTAMP
                WHERE id = $7
            "#,
        )
        .bind(&draft.name)
        .bind(&draft.slug)
        .bind(&draft.description)
        .bind(&draft.rules)
        .bind(draft.is_active)
        .bind(actor_id)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete(tx: &mut DbTransaction<'_>, id: i64) -> Result<bool, ApiError> {
        let result = query("DELETE FROM guest_segments WHERE id = $1")
            .bind(id)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    /// Campaigns referencing the segment — delete guard.
    pub async fn campaign_count(pool: &DbPool, segment_id: i64) -> Result<i64, ApiError> {
        query_scalar("SELECT COUNT(*) FROM email_campaigns WHERE segment_id = $1")
            .bind(segment_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    /// Live member count for a compiled clause over active guests.
    pub async fn count_matching(pool: &DbPool, clause: &CompiledClause) -> Result<i64, ApiError> {
        let sql = format!(
            "SELECT COUNT(*) FROM guests g WHERE g.is_active IS TRUE AND {}",
            clause.sql
        );
        let row = rules::apply_binds(query(sqlx::AssertSqlSafe(&*sql)), &clause.binds)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.try_get::<i64, _>(0).unwrap_or_default())
    }

    /// First `limit` matching guests for the preview. The clause is compiled
    /// with `first_param = 1`; the limit bind lands at `$n+1` after it.
    pub async fn sample_matching(
        pool: &DbPool,
        clause: &CompiledClause,
        limit: i64,
    ) -> Result<Vec<SegmentSampleGuest>, ApiError> {
        let limit_param = clause.binds.len() + 1;
        let sql = format!(
            "SELECT g.id, COALESCE(NULLIF(btrim(concat_ws(' ', g.first_name, g.last_name)), ''), g.nick_name) AS name \
             FROM guests g WHERE g.is_active IS TRUE AND {} ORDER BY g.id LIMIT ${limit_param}",
            clause.sql
        );
        let rows = rules::apply_binds(query(sqlx::AssertSqlSafe(&*sql)), &clause.binds)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| SegmentSampleGuest {
                id: row.try_get("id").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
            })
            .collect())
    }

    pub async fn loyalty_tier_options(pool: &DbPool) -> Result<Vec<LoyaltyTierOption>, ApiError> {
        let rows = query("SELECT id, name FROM loyalty_tiers ORDER BY sort_order, id")
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| LoyaltyTierOption {
                id: row.try_get("id").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
            })
            .collect())
    }

    /// Observed distinct values for the suggest-style rule fields — real data,
    /// not a guessed enum.
    pub async fn distinct_values(pool: &DbPool) -> Result<SegmentDistinctValues, ApiError> {
        async fn distinct(pool: &DbPool, column: &str) -> Result<Vec<String>, ApiError> {
            // `column` is a fixed whitelist member chosen by this function's
            // callers below — never user input.
            let sql = format!(
                "SELECT DISTINCT {column} FROM guests \
                 WHERE {column} IS NOT NULL AND length(btrim({column})) > 0 \
                 ORDER BY {column} LIMIT 200"
            );
            let rows = query(sqlx::AssertSqlSafe(&*sql))
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;
            Ok(rows
                .iter()
                .filter_map(|row| row.try_get::<String, _>(0).ok())
                .collect())
        }
        Ok(SegmentDistinctValues {
            countries: distinct(pool, "country").await?,
            nationalities: distinct(pool, "nationality").await?,
            languages: distinct(pool, "language_preference").await?,
            communication_preferences: distinct(pool, "communication_preference").await?,
            vip_statuses: distinct(pool, "vip_status").await?,
        })
    }
}
