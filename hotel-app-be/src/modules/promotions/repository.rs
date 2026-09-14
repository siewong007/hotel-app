//! Persistence for promotion campaigns and guest vouchers.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Row, query, query_scalar};

use super::models::{Promotion, PublicPromotion, Voucher, VoucherSummary, VoucherSummaryDiscount};
use super::validation::PromotionDraft;
use crate::core::db::{DbPool, DbRow, DbTransaction, decimal_to_db, opt_decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers::{get_bool, get_decimal, get_opt_decimal};

const PROMOTION_COLUMNS: &str = r#"
    p.id,
    p.slug,
    p.name,
    p.description,
    p.terms,
    p.status,
    p.promotion_kind,
    p.discount_type,
    p.discount_value,
    p.max_discount_amount,
    p.currency,
    p.claim_starts_at,
    p.claim_ends_at,
    p.stay_starts_on,
    p.stay_ends_on,
    p.min_nights,
    p.max_nights,
    p.min_subtotal,
    p.claim_limit,
    p.claimed_count,
    p.per_guest_limit,
    p.is_public,
    p.is_cancellable,
    p.internal_code,
    p.objective,
    rt_ids.ids AS room_type_ids,
    ch_ids.ids AS booking_channel_ids,
    lt_ids.ids AS loyalty_tier_ids,
    CAST(p.version AS BIGINT) AS version,
    p.created_by,
    p.updated_by,
    p.created_at,
    p.updated_at
"#;

/// FROM clause for staff-facing promotion reads. The lateral joins fold the
/// three targeting sets into the row so list endpoints don't pay a query per
/// promotion per join table.
const PROMOTION_ADMIN_FROM: &str = r#"
    FROM promotions p
    LEFT JOIN LATERAL (
        SELECT array_agg(room_type_id ORDER BY room_type_id) AS ids
        FROM promotion_room_types t WHERE t.promotion_id = p.id
    ) rt_ids ON true
    LEFT JOIN LATERAL (
        SELECT array_agg(booking_channel_id ORDER BY booking_channel_id) AS ids
        FROM promotion_channels t WHERE t.promotion_id = p.id
    ) ch_ids ON true
    LEFT JOIN LATERAL (
        SELECT array_agg(loyalty_tier_id ORDER BY loyalty_tier_id) AS ids
        FROM promotion_loyalty_tiers t WHERE t.promotion_id = p.id
    ) lt_ids ON true
"#;

/// Same projection as [`PROMOTION_COLUMNS`] but WITHOUT the staff-only
/// `created_by`/`updated_by` actor columns. Guest-facing and public catalogue
/// LIST queries use this projection directly. A few guest-facing branches
/// (e.g. the loyalty slug lookup) still fetch the full row for internal
/// checks — those must convert to `PublicPromotion` before serializing, which
/// is the enforced JSON boundary: `PublicPromotion` has no actor fields.
const PROMOTION_COLUMNS_PUBLIC: &str = r#"
    p.id,
    p.slug,
    p.name,
    p.description,
    p.terms,
    p.status,
    p.promotion_kind,
    p.discount_type,
    p.discount_value,
    p.max_discount_amount,
    p.currency,
    p.claim_starts_at,
    p.claim_ends_at,
    p.stay_starts_on,
    p.stay_ends_on,
    p.min_nights,
    p.max_nights,
    p.min_subtotal,
    p.claim_limit,
    p.claimed_count,
    p.per_guest_limit,
    p.is_public,
    p.is_cancellable,
    rt_ids.ids AS room_type_ids,
    CAST(p.version AS BIGINT) AS version,
    p.created_at,
    p.updated_at
"#;

/// Public catalogue reads only need room-type targeting — channel and tier
/// sets are staff-only detail.
const PROMOTION_PUBLIC_FROM: &str = r#"
    FROM promotions p
    LEFT JOIN LATERAL (
        SELECT array_agg(room_type_id ORDER BY room_type_id) AS ids
        FROM promotion_room_types t WHERE t.promotion_id = p.id
    ) rt_ids ON true
"#;

const VOUCHER_COLUMNS: &str = r#"
    v.id,
    v.promotion_id,
    v.guest_id,
    p.name AS promotion_name,
    p.slug AS promotion_slug,
    p.is_cancellable,
    v.code,
    v.status,
    v.source,
    v.expires_at,
    v.claimed_at,
    v.redeemed_at,
    v.revoked_at,
    v.created_at
"#;

/// Admin projection: everything in [`VOUCHER_COLUMNS`] plus the owning guest's
/// display name and the revocation reason. `guests.nick_name` is NOT NULL and
/// is the established `guest_name` convention in admin joins.
const VOUCHER_COLUMNS_ADMIN: &str = r#"
    v.id,
    v.promotion_id,
    v.guest_id,
    p.name AS promotion_name,
    p.slug AS promotion_slug,
    p.is_cancellable,
    v.code,
    v.status,
    v.source,
    v.expires_at,
    v.claimed_at,
    v.redeemed_at,
    v.revoked_at,
    v.revocation_reason,
    v.created_at,
    g.nick_name AS guest_name
"#;

/// FROM clause for staff-facing voucher reads — adds the guests join needed
/// for `guest_name`. Guest-facing queries keep the promotions-only join.
const VOUCHER_ADMIN_FROM: &str = "FROM vouchers v JOIN promotions p ON p.id = v.promotion_id LEFT JOIN guests g ON g.id = v.guest_id";

fn decimal_to_f64(value: rust_decimal::Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

/// Whether `error` is the integrity violation raised by `constraint`. Same
/// dual-check convention as the guest/user repositories: match on the PG
/// `SQLSTATE` (or the SQLite wording the harness once produced) plus the
/// constraint name, which always appears in the server message.
fn is_constraint_violation(error: &sqlx::Error, pg_code: &str, constraint: &str) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };
    let matches_code = database_error.code().as_deref() == Some(pg_code)
        || database_error.message().contains("constraint failed");
    matches_code
        && (database_error.constraint() == Some(constraint)
            || database_error.message().contains(constraint))
}

fn id_list(row: &DbRow, column: &str) -> Vec<i64> {
    row.try_get::<Option<Vec<i64>>, _>(column)
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn promotion_from_row(row: &DbRow) -> Promotion {
    let status: String = row.try_get("status").unwrap_or_default();
    let claim_starts_at: Option<DateTime<Utc>> = row.try_get("claim_starts_at").ok().flatten();
    let claim_ends_at: Option<DateTime<Utc>> = row.try_get("claim_ends_at").ok().flatten();
    Promotion {
        id: row.try_get("id").unwrap_or_default(),
        slug: row.try_get("slug").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        description: row
            .try_get::<Option<String>, _>("description")
            .ok()
            .flatten(),
        terms: row.try_get::<Option<String>, _>("terms").ok().flatten(),
        lifecycle: super::lifecycle::lifecycle_for(
            &status,
            claim_starts_at,
            claim_ends_at,
            Utc::now(),
        )
        .to_string(),
        status,
        promotion_kind: row.try_get("promotion_kind").unwrap_or_default(),
        discount_type: row.try_get("discount_type").unwrap_or_default(),
        discount_value: decimal_to_f64(get_decimal(row, "discount_value")),
        max_discount_amount: get_opt_decimal(row, "max_discount_amount").map(decimal_to_f64),
        currency: row
            .try_get("currency")
            .unwrap_or_else(|_| "USD".to_string()),
        claim_starts_at,
        claim_ends_at,
        stay_starts_on: row
            .try_get::<Option<NaiveDate>, _>("stay_starts_on")
            .ok()
            .flatten(),
        stay_ends_on: row
            .try_get::<Option<NaiveDate>, _>("stay_ends_on")
            .ok()
            .flatten(),
        min_nights: row.try_get::<Option<i32>, _>("min_nights").ok().flatten(),
        max_nights: row.try_get::<Option<i32>, _>("max_nights").ok().flatten(),
        min_subtotal: get_opt_decimal(row, "min_subtotal").map(decimal_to_f64),
        claim_limit: row.try_get::<Option<i64>, _>("claim_limit").ok().flatten(),
        claimed_count: row.try_get("claimed_count").unwrap_or_default(),
        per_guest_limit: row.try_get("per_guest_limit").unwrap_or(1),
        is_public: get_bool(row, "is_public"),
        is_cancellable: get_bool(row, "is_cancellable"),
        internal_code: row
            .try_get::<Option<String>, _>("internal_code")
            .ok()
            .flatten(),
        objective: row.try_get::<Option<String>, _>("objective").ok().flatten(),
        room_type_ids: id_list(row, "room_type_ids"),
        booking_channel_ids: id_list(row, "booking_channel_ids"),
        loyalty_tier_ids: id_list(row, "loyalty_tier_ids"),
        version: row.try_get("version").unwrap_or(1),
        created_by: row.try_get::<Option<i64>, _>("created_by").ok().flatten(),
        updated_by: row.try_get::<Option<i64>, _>("updated_by").ok().flatten(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

/// Row mapper for [`PROMOTION_COLUMNS_PUBLIC`] — the row never contains
/// `created_by`/`updated_by`, so there is no field to accidentally read here.
fn public_promotion_from_row(row: &DbRow) -> PublicPromotion {
    PublicPromotion {
        id: row.try_get("id").unwrap_or_default(),
        slug: row.try_get("slug").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        description: row
            .try_get::<Option<String>, _>("description")
            .ok()
            .flatten(),
        terms: row.try_get::<Option<String>, _>("terms").ok().flatten(),
        status: row.try_get("status").unwrap_or_default(),
        promotion_kind: row.try_get("promotion_kind").unwrap_or_default(),
        discount_type: row.try_get("discount_type").unwrap_or_default(),
        discount_value: decimal_to_f64(get_decimal(row, "discount_value")),
        max_discount_amount: get_opt_decimal(row, "max_discount_amount").map(decimal_to_f64),
        currency: row
            .try_get("currency")
            .unwrap_or_else(|_| "USD".to_string()),
        claim_starts_at: row
            .try_get::<Option<DateTime<Utc>>, _>("claim_starts_at")
            .ok()
            .flatten(),
        claim_ends_at: row
            .try_get::<Option<DateTime<Utc>>, _>("claim_ends_at")
            .ok()
            .flatten(),
        stay_starts_on: row
            .try_get::<Option<NaiveDate>, _>("stay_starts_on")
            .ok()
            .flatten(),
        stay_ends_on: row
            .try_get::<Option<NaiveDate>, _>("stay_ends_on")
            .ok()
            .flatten(),
        min_nights: row.try_get::<Option<i32>, _>("min_nights").ok().flatten(),
        max_nights: row.try_get::<Option<i32>, _>("max_nights").ok().flatten(),
        min_subtotal: get_opt_decimal(row, "min_subtotal").map(decimal_to_f64),
        claim_limit: row.try_get::<Option<i64>, _>("claim_limit").ok().flatten(),
        claimed_count: row.try_get("claimed_count").unwrap_or_default(),
        per_guest_limit: row.try_get("per_guest_limit").unwrap_or(1),
        is_public: get_bool(row, "is_public"),
        is_cancellable: get_bool(row, "is_cancellable"),
        room_type_ids: id_list(row, "room_type_ids"),
        version: row.try_get("version").unwrap_or(1),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

fn mask_voucher_code(code: &str) -> String {
    let suffix = code.chars().rev().take(4).collect::<Vec<_>>();
    let suffix = suffix.into_iter().rev().collect::<String>();
    if suffix.is_empty() {
        "••••".to_string()
    } else {
        format!("••••{suffix}")
    }
}

fn voucher_from_row(row: &DbRow, include_code: bool) -> Voucher {
    let raw_code = row.try_get::<String, _>("code").unwrap_or_default();
    Voucher {
        id: row.try_get("id").unwrap_or_default(),
        promotion_id: row.try_get("promotion_id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        promotion_name: row.try_get("promotion_name").unwrap_or_default(),
        promotion_slug: row.try_get("promotion_slug").unwrap_or_default(),
        code: include_code.then_some(raw_code.clone()),
        code_masked: mask_voucher_code(&raw_code),
        status: row.try_get("status").unwrap_or_default(),
        source: row.try_get("source").unwrap_or_default(),
        is_cancellable: get_bool(row, "is_cancellable"),
        guest_name: row
            .try_get::<Option<String>, _>("guest_name")
            .ok()
            .flatten(),
        revocation_reason: row
            .try_get::<Option<String>, _>("revocation_reason")
            .ok()
            .flatten(),
        expires_at: row
            .try_get::<Option<DateTime<Utc>>, _>("expires_at")
            .ok()
            .flatten(),
        claimed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("claimed_at")
            .ok()
            .flatten(),
        redeemed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("redeemed_at")
            .ok()
            .flatten(),
        revoked_at: row
            .try_get::<Option<DateTime<Utc>>, _>("revoked_at")
            .ok()
            .flatten(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub struct PromotionRepository;

impl PromotionRepository {
    pub async fn list_public(
        pool: &DbPool,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<PublicPromotion>), ApiError> {
        let count_sql = r#"
                SELECT COUNT(*)
                FROM promotions p
                WHERE p.status = 'published'
                  AND p.is_public = true
                  AND (p.claim_starts_at IS NULL OR p.claim_starts_at <= CURRENT_TIMESTAMP)
                  AND (p.claim_ends_at IS NULL OR p.claim_ends_at >= CURRENT_TIMESTAMP)
                  AND (p.claim_limit IS NULL OR p.claimed_count < p.claim_limit)
            "#;
        let total = query_scalar::<_, i64>(count_sql)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = r#"
                    SELECT {PROMOTION_COLUMNS}
                    {PROMOTION_PUBLIC_FROM}
                    WHERE p.status = 'published'
                      AND p.is_public = true
                      AND (p.claim_starts_at IS NULL OR p.claim_starts_at <= CURRENT_TIMESTAMP)
                      AND (p.claim_ends_at IS NULL OR p.claim_ends_at >= CURRENT_TIMESTAMP)
                      AND (p.claim_limit IS NULL OR p.claimed_count < p.claim_limit)
                    ORDER BY p.claim_ends_at NULLS LAST, p.created_at DESC
                    LIMIT $1 OFFSET $2
                "#
        .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS_PUBLIC)
        .replace("{PROMOTION_PUBLIC_FROM}", PROMOTION_PUBLIC_FROM);
        let rows = query(sqlx::AssertSqlSafe(&*sql))
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((total, rows.iter().map(public_promotion_from_row).collect()))
    }

    /// `lifecycle_filter` is a validated lifecycle name; the clause it maps to
    /// is a fixed literal selected by [`lifecycle::lifecycle_clause`], so no
    /// user input reaches the SQL text.
    pub async fn list_admin(
        pool: &DbPool,
        lifecycle_filter: Option<&str>,
        search: Option<&str>,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<Promotion>), ApiError> {
        let clause = lifecycle_filter
            .and_then(super::lifecycle::lifecycle_clause)
            .unwrap_or("true");
        let count_sql = format!(
            r#"
                SELECT COUNT(*)
                {PROMOTION_ADMIN_FROM}
                WHERE ({clause})
                  AND ($1::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($1) || '%' OR LOWER(p.slug) LIKE '%' || LOWER($1) || '%')
            "#,
        );
        let total = query_scalar::<_, i64>(sqlx::AssertSqlSafe(&*count_sql))
            .bind(search)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = format!(
            r#"
                    SELECT {{PROMOTION_COLUMNS}}
                    {{PROMOTION_ADMIN_FROM}}
                    WHERE ({clause})
                      AND ($1::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($1) || '%' OR LOWER(p.slug) LIKE '%' || LOWER($1) || '%')
                    ORDER BY p.updated_at DESC
                    LIMIT $2 OFFSET $3
                "#
        )
        .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS)
        .replace("{PROMOTION_ADMIN_FROM}", PROMOTION_ADMIN_FROM);
        let rows = query(sqlx::AssertSqlSafe(&*sql))
            .bind(search)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((total, rows.iter().map(promotion_from_row).collect()))
    }

    pub async fn find_by_id(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<Option<Promotion>, ApiError> {
        let sql = "SELECT {PROMOTION_COLUMNS} {PROMOTION_ADMIN_FROM} WHERE p.id = $1"
            .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS)
            .replace("{PROMOTION_ADMIN_FROM}", PROMOTION_ADMIN_FROM);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(promotion_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(promotion_from_row))
    }

    pub async fn find_by_slug(pool: &DbPool, slug: &str) -> Result<Option<Promotion>, ApiError> {
        let sql = "SELECT {PROMOTION_COLUMNS} {PROMOTION_ADMIN_FROM} WHERE p.slug = $1"
            .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS)
            .replace("{PROMOTION_ADMIN_FROM}", PROMOTION_ADMIN_FROM);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(slug)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(promotion_from_row))
    }

    pub async fn find_public_by_slug(
        pool: &DbPool,
        slug: &str,
    ) -> Result<Option<PublicPromotion>, ApiError> {
        // Same visibility predicate as the public catalogue list — a promotion
        // hidden there (full, out of window, private, unpublished) must not be
        // fetchable by guessing its slug.
        let sql = r#"
                    SELECT {PROMOTION_COLUMNS}
                    {PROMOTION_PUBLIC_FROM}
                    WHERE p.slug = $1
                      AND p.status = 'published'
                      AND p.is_public = true
                      AND (p.claim_starts_at IS NULL OR p.claim_starts_at <= CURRENT_TIMESTAMP)
                      AND (p.claim_ends_at IS NULL OR p.claim_ends_at >= CURRENT_TIMESTAMP)
                      AND (p.claim_limit IS NULL OR p.claimed_count < p.claim_limit)
                "#
        .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS_PUBLIC)
        .replace("{PROMOTION_PUBLIC_FROM}", PROMOTION_PUBLIC_FROM);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(slug)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(public_promotion_from_row))
    }

    /// Same projection as the pool reads, including targeting sets — claim and
    /// issue paths enforce targeting inside the transaction.
    pub async fn find_by_id_tx(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
    ) -> Result<Option<Promotion>, ApiError> {
        let sql = "SELECT {PROMOTION_COLUMNS} {PROMOTION_ADMIN_FROM} WHERE p.id = $1"
            .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS)
            .replace("{PROMOTION_ADMIN_FROM}", PROMOTION_ADMIN_FROM);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(promotion_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(promotion_from_row))
    }

    pub async fn insert_promotion(
        tx: &mut DbTransaction<'_>,
        draft: &PromotionDraft,
        actor_id: i64,
    ) -> Result<i64, ApiError> {
        query_scalar(
            r#"
                INSERT INTO promotions (
                    slug, name, description, terms, promotion_kind, discount_type,
                    discount_value, max_discount_amount, currency, claim_starts_at,
                    claim_ends_at, stay_starts_on, stay_ends_on, min_nights, max_nights,
                    min_subtotal, claim_limit, per_guest_limit, is_public, is_cancellable,
                    internal_code, objective, created_by, updated_by
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
                ) RETURNING id
            "#,
        )
        .bind(&draft.slug)
        .bind(&draft.name)
        .bind(&draft.description)
        .bind(&draft.terms)
        .bind(&draft.promotion_kind)
        .bind(&draft.discount_type)
        .bind(decimal_to_db(draft.discount_value))
        .bind(opt_decimal_to_db(draft.max_discount_amount))
        .bind(&draft.currency)
        .bind(draft.claim_starts_at)
        .bind(draft.claim_ends_at)
        .bind(draft.stay_starts_on)
        .bind(draft.stay_ends_on)
        .bind(draft.min_nights)
        .bind(draft.max_nights)
        .bind(opt_decimal_to_db(draft.min_subtotal))
        .bind(draft.claim_limit)
        .bind(draft.per_guest_limit)
        .bind(draft.is_public)
        .bind(draft.is_cancellable)
        .bind(&draft.internal_code)
        .bind(&draft.objective)
        .bind(actor_id)
        .bind(actor_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn update_promotion(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        expected_version: Option<i64>,
        draft: &PromotionDraft,
        actor_id: i64,
    ) -> Result<Option<i64>, ApiError> {
        query_scalar(
            r#"
                UPDATE promotions SET
                    slug = $1, name = $2, description = $3, terms = $4,
                    promotion_kind = $5, discount_type = $6, discount_value = $7,
                    max_discount_amount = $8, currency = $9, claim_starts_at = $10,
                    claim_ends_at = $11, stay_starts_on = $12, stay_ends_on = $13,
                    min_nights = $14, max_nights = $15, min_subtotal = $16,
                    claim_limit = $17, per_guest_limit = $18, is_public = $19,
                    is_cancellable = $20, internal_code = $21, objective = $22,
                    updated_by = $23, updated_at = CURRENT_TIMESTAMP, version = version + 1
                WHERE id = $24
                  AND ($25::integer IS NULL OR version = $25)
                  AND status IN ('draft', 'paused')
                RETURNING id
            "#,
        )
        .bind(&draft.slug)
        .bind(&draft.name)
        .bind(&draft.description)
        .bind(&draft.terms)
        .bind(&draft.promotion_kind)
        .bind(&draft.discount_type)
        .bind(decimal_to_db(draft.discount_value))
        .bind(opt_decimal_to_db(draft.max_discount_amount))
        .bind(&draft.currency)
        .bind(draft.claim_starts_at)
        .bind(draft.claim_ends_at)
        .bind(draft.stay_starts_on)
        .bind(draft.stay_ends_on)
        .bind(draft.min_nights)
        .bind(draft.max_nights)
        .bind(opt_decimal_to_db(draft.min_subtotal))
        .bind(draft.claim_limit)
        .bind(draft.per_guest_limit)
        .bind(draft.is_public)
        .bind(draft.is_cancellable)
        .bind(&draft.internal_code)
        .bind(&draft.objective)
        .bind(actor_id)
        .bind(promotion_id)
        .bind(expected_version)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn replace_room_type_targets(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        room_type_ids: &[i64],
    ) -> Result<(), ApiError> {
        query("DELETE FROM promotion_room_types WHERE promotion_id = $1")
            .bind(promotion_id)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        for room_type_id in room_type_ids {
            query("INSERT INTO promotion_room_types (promotion_id, room_type_id) VALUES ($1, $2)")
                .bind(promotion_id)
                .bind(room_type_id)
                .execute(&mut **tx)
                .await
                .map_err(ApiError::from)?;
        }
        Ok(())
    }

    pub async fn replace_channel_targets(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        booking_channel_ids: &[i64],
    ) -> Result<(), ApiError> {
        query("DELETE FROM promotion_channels WHERE promotion_id = $1")
            .bind(promotion_id)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        for channel_id in booking_channel_ids {
            query(
                "INSERT INTO promotion_channels (promotion_id, booking_channel_id) VALUES ($1, $2)",
            )
            .bind(promotion_id)
            .bind(channel_id)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        }
        Ok(())
    }

    pub async fn replace_tier_targets(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        loyalty_tier_ids: &[i64],
    ) -> Result<(), ApiError> {
        query("DELETE FROM promotion_loyalty_tiers WHERE promotion_id = $1")
            .bind(promotion_id)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        for tier_id in loyalty_tier_ids {
            query("INSERT INTO promotion_loyalty_tiers (promotion_id, loyalty_tier_id) VALUES ($1, $2)")
                .bind(promotion_id)
                .bind(tier_id)
                .execute(&mut **tx)
                .await
                .map_err(ApiError::from)?;
        }
        Ok(())
    }

    /// True when the guest holds an active loyalty membership at one of
    /// `tier_ids`. Callers skip this entirely when the set is empty.
    pub async fn guest_in_loyalty_tiers(
        pool: &DbPool,
        guest_id: i64,
        tier_ids: &[i64],
    ) -> Result<bool, ApiError> {
        query_scalar(
            r#"SELECT EXISTS(
                SELECT 1 FROM loyalty_members lm
                JOIN loyalty_accounts la ON la.member_id = lm.id
                WHERE lm.guest_id = $1 AND lm.status = 'active'
                  AND la.current_tier_id = ANY($2)
            )"#,
        )
        .bind(guest_id)
        .bind(tier_ids)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn set_status(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        status: &str,
        expected_version: Option<i64>,
        actor_id: i64,
    ) -> Result<Option<i64>, ApiError> {
        query_scalar(r#"
                UPDATE promotions
                SET status = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP, version = version + 1
                WHERE id = $3 AND ($4::integer IS NULL OR version = $4)
                RETURNING id
            "#)
        .bind(status)
        .bind(actor_id)
        .bind(promotion_id)
        .bind(expected_version)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn guest_has_voucher(
        pool: &DbPool,
        promotion_id: i64,
        guest_id: i64,
    ) -> Result<bool, ApiError> {
        query_scalar(
            "SELECT EXISTS(SELECT 1 FROM vouchers WHERE promotion_id = $1 AND guest_id = $2)",
        )
        .bind(promotion_id)
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn list_guest_vouchers(
        pool: &DbPool,
        guest_id: i64,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<Voucher>), ApiError> {
        let total = query_scalar::<_, i64>("SELECT COUNT(*) FROM vouchers WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = r#"
                    SELECT {VOUCHER_COLUMNS}
                    FROM vouchers v JOIN promotions p ON p.id = v.promotion_id
                    WHERE v.guest_id = $1
                    ORDER BY CASE v.status WHEN 'available' THEN 0 WHEN 'redeemed' THEN 1 ELSE 2 END,
                             v.expires_at NULLS LAST, v.created_at DESC
                    LIMIT $2 OFFSET $3
                "#
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS);
        let rows = query(sqlx::AssertSqlSafe(&*sql))
            .bind(guest_id)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((
            total,
            rows.iter().map(|row| voucher_from_row(row, true)).collect(),
        ))
    }

    /// `status` accepts the persisted vocabulary plus the query aliases
    /// `expired` (available, past `expires_at`) and `expiring_soon`
    /// (available, expiring within 7 days).
    pub async fn list_admin_vouchers(
        pool: &DbPool,
        status: Option<&str>,
        search: Option<&str>,
        promotion_id: Option<i64>,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<Voucher>), ApiError> {
        let count_sql = r#"
                SELECT COUNT(*) FROM vouchers v
                JOIN promotions p ON p.id = v.promotion_id
                WHERE (
                    $1::text IS NULL
                    OR ($1 = 'expired' AND v.status = 'available' AND v.expires_at < CURRENT_TIMESTAMP)
                    OR ($1 = 'expiring_soon' AND v.status = 'available'
                        AND v.expires_at >= CURRENT_TIMESTAMP
                        AND v.expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days')
                    OR ($1 <> 'expired' AND $1 <> 'expiring_soon' AND v.status = $1)
                )
                  AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(v.code) = LOWER($2))
                  AND ($3::bigint IS NULL OR v.promotion_id = $3)
            "#;
        let total = query_scalar::<_, i64>(count_sql)
            .bind(status)
            .bind(search)
            .bind(promotion_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = r#"
                    SELECT {VOUCHER_COLUMNS}
                    {VOUCHER_ADMIN_FROM}
                    WHERE (
                        $1::text IS NULL
                        OR ($1 = 'expired' AND v.status = 'available' AND v.expires_at < CURRENT_TIMESTAMP)
                        OR ($1 = 'expiring_soon' AND v.status = 'available'
                            AND v.expires_at >= CURRENT_TIMESTAMP
                            AND v.expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days')
                        OR ($1 <> 'expired' AND $1 <> 'expiring_soon' AND v.status = $1)
                    )
                      -- Raw codes are masked in staff responses. Only allow an exact
                      -- code lookup so substring searches cannot become a code oracle.
                      AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(v.code) = LOWER($2))
                      AND ($3::bigint IS NULL OR v.promotion_id = $3)
                    ORDER BY v.created_at DESC LIMIT $4 OFFSET $5
                "#
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS_ADMIN)
        .replace("{VOUCHER_ADMIN_FROM}", VOUCHER_ADMIN_FROM);
        let rows = query(sqlx::AssertSqlSafe(&*sql))
            .bind(status)
            .bind(search)
            .bind(promotion_id)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((
            total,
            rows.iter()
                .map(|row| voucher_from_row(row, false))
                .collect(),
        ))
    }

    pub async fn find_voucher_for_guest(
        pool: &DbPool,
        voucher_id: i64,
        guest_id: i64,
    ) -> Result<Option<Voucher>, ApiError> {
        let sql = "SELECT {VOUCHER_COLUMNS} FROM vouchers v JOIN promotions p ON p.id = v.promotion_id WHERE v.id = $1 AND v.guest_id = $2"
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(voucher_id)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(|row| voucher_from_row(row, true)))
    }

    pub async fn find_voucher_by_promotion_guest(
        pool: &DbPool,
        promotion_id: i64,
        guest_id: i64,
        include_code: bool,
    ) -> Result<Option<Voucher>, ApiError> {
        let sql = "SELECT {VOUCHER_COLUMNS} FROM vouchers v JOIN promotions p ON p.id = v.promotion_id WHERE v.promotion_id = $1 AND v.guest_id = $2"
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(promotion_id)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(|row| voucher_from_row(row, include_code)))
    }

    pub async fn find_voucher_admin(
        pool: &DbPool,
        voucher_id: i64,
    ) -> Result<Option<Voucher>, ApiError> {
        let sql = "SELECT {VOUCHER_COLUMNS} {VOUCHER_ADMIN_FROM} WHERE v.id = $1"
            .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS_ADMIN)
            .replace("{VOUCHER_ADMIN_FROM}", VOUCHER_ADMIN_FROM);
        let row = query(sqlx::AssertSqlSafe(&*sql))
            .bind(voucher_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(|row| voucher_from_row(row, false)))
    }

    pub async fn insert_voucher_if_new(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        guest_id: i64,
        code: &str,
        source: &str,
        expires_at: Option<DateTime<Utc>>,
        issued_by: Option<i64>,
    ) -> Result<Option<i64>, ApiError> {
        query_scalar(r#"
                INSERT INTO vouchers (promotion_id, guest_id, code, status, source, expires_at, issued_by, claimed_at)
                VALUES ($1, $2, $3, 'available', $4, $5, $6, CURRENT_TIMESTAMP)
                ON CONFLICT (promotion_id, guest_id) DO NOTHING
                RETURNING id
            "#)
        .bind(promotion_id)
        .bind(guest_id)
        .bind(code)
        .bind(source)
        .bind(expires_at)
        .bind(issued_by)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| {
            // The (promotion, guest) pair conflict is already filtered by
            // ON CONFLICT .. DO NOTHING; what remains is the code uniqueness
            // guard and the guest/promotion FKs, both client mistakes.
            if is_constraint_violation(&error, "23505", "vouchers_code_key") {
                return ApiError::Conflict(
                    "That voucher code is already in use".to_string(),
                );
            }
            if is_constraint_violation(&error, "23503", "vouchers_guest_id_fkey") {
                return ApiError::NotFound("Guest not found".to_string());
            }
            ApiError::from(error)
        })
    }

    pub async fn reserve_claim_capacity(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
    ) -> Result<bool, ApiError> {
        let result = query(
            r#"
                UPDATE promotions
                SET claimed_count = claimed_count + 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                  AND status = 'published'
                  AND (claim_limit IS NULL OR claimed_count < claim_limit)
            "#,
        )
        .bind(promotion_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn revoke_voucher(
        tx: &mut DbTransaction<'_>,
        voucher_id: i64,
        actor_id: i64,
        reason: Option<&str>,
    ) -> Result<Option<i64>, ApiError> {
        query_scalar(
            r#"
                UPDATE vouchers
                SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_by = $1,
                    revocation_reason = $2, updated_at = CURRENT_TIMESTAMP
                WHERE id = $3 AND status = 'available'
                RETURNING id
            "#,
        )
        .bind(actor_id)
        .bind(reason)
        .bind(voucher_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn voucher_admin_summary(pool: &DbPool) -> Result<VoucherSummary, ApiError> {
        let status_row = query(
            r#"
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'available') AS available,
                    COUNT(*) FILTER (WHERE status = 'redeemed') AS redeemed,
                    COUNT(*) FILTER (WHERE status = 'revoked') AS revoked,
                    COUNT(*) FILTER (
                        WHERE status = 'available' AND expires_at < CURRENT_TIMESTAMP
                    ) AS expired,
                    COUNT(*) FILTER (
                        WHERE status = 'available'
                          AND expires_at >= CURRENT_TIMESTAMP
                          AND expires_at < CURRENT_TIMESTAMP + INTERVAL '7 days'
                    ) AS expiring_soon
                FROM vouchers
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        let redemption_count = query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM voucher_redemptions WHERE status = 'applied'",
        )
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        let discount_rows = query(
            r#"
                SELECT p.currency AS currency, COALESCE(SUM(r.discount_amount), 0) AS amount
                FROM voucher_redemptions r
                JOIN promotions p ON p.id = r.promotion_id
                WHERE r.status = 'applied'
                GROUP BY p.currency
                ORDER BY p.currency
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(VoucherSummary {
            total: status_row.try_get("total").unwrap_or_default(),
            available: status_row.try_get("available").unwrap_or_default(),
            redeemed: status_row.try_get("redeemed").unwrap_or_default(),
            revoked: status_row.try_get("revoked").unwrap_or_default(),
            expired: status_row.try_get("expired").unwrap_or_default(),
            expiring_soon: status_row.try_get("expiring_soon").unwrap_or_default(),
            redemption_count,
            discount_given: discount_rows
                .iter()
                .map(|row| VoucherSummaryDiscount {
                    currency: row
                        .try_get("currency")
                        .unwrap_or_else(|_| "USD".to_string()),
                    amount: decimal_to_f64(get_decimal(row, "amount")),
                })
                .collect(),
        })
    }

    pub async fn targeting_options(pool: &DbPool) -> Result<(Vec<DbRow>, Vec<DbRow>), ApiError> {
        let channels = query(
            "SELECT id, name, channel_type FROM booking_channels WHERE is_active = true ORDER BY name",
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        let tiers = query(
            "SELECT id, code, name FROM loyalty_tiers WHERE is_active = true ORDER BY sort_order, name",
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok((channels, tiers))
    }

    /// Claim funnel: one row per voucher status/source counter for the
    /// campaign's issued vouchers.
    pub async fn campaign_voucher_funnel(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<DbRow, ApiError> {
        query(r#"
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE status = 'available') AS available,
                       COUNT(*) FILTER (WHERE status = 'redeemed') AS redeemed,
                       COUNT(*) FILTER (WHERE status = 'revoked') AS revoked,
                       COUNT(*) FILTER (WHERE status = 'available' AND expires_at < CURRENT_TIMESTAMP) AS expired,
                       COUNT(*) FILTER (WHERE source = 'guest_claim') AS guest_claims,
                       COUNT(*) FILTER (WHERE source = 'admin_issue') AS admin_issues
                FROM vouchers
                WHERE promotion_id = $1
            "#)
        .bind(promotion_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    /// Redemption totals over applied rows — reversed rows count separately so
    /// operators see both sides of the ledger.
    pub async fn campaign_redemption_totals(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<DbRow, ApiError> {
        query(r#"
                SELECT COUNT(*) FILTER (WHERE status = 'applied') AS applied,
                       COUNT(*) FILTER (WHERE status = 'reversed') AS reversed,
                       COALESCE(SUM(gross_subtotal) FILTER (WHERE status = 'applied'), 0)::text AS gross_subtotal,
                       COALESCE(SUM(discount_amount) FILTER (WHERE status = 'applied'), 0)::text AS discount_amount,
                       COALESCE(SUM(net_total) FILTER (WHERE status = 'applied'), 0)::text AS net_total,
                       COUNT(DISTINCT booking_id) FILTER (WHERE status = 'applied') AS bookings,
                       COUNT(DISTINCT guest_id) FILTER (WHERE status = 'applied') AS guests
                FROM voucher_redemptions
                WHERE promotion_id = $1
            "#)
        .bind(promotion_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    /// Stay-night attribution — one row per night the campaign discounted.
    pub async fn campaign_per_night_totals(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<DbRow, ApiError> {
        query(
            r#"
                SELECT COUNT(*) AS nights,
                       COALESCE(SUM(a.gross_amount), 0)::text AS gross_amount,
                       COALESCE(SUM(a.discount_amount), 0)::text AS discount_amount,
                       COALESCE(SUM(a.net_amount), 0)::text AS net_amount
                FROM voucher_redemption_allocations a
                JOIN voucher_redemptions r ON r.id = a.redemption_id
                WHERE r.promotion_id = $1 AND r.status = 'applied'
            "#,
        )
        .bind(promotion_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    /// Channel mix of the bookings the campaign's vouchers redeemed against.
    pub async fn campaign_channel_mix(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<Vec<DbRow>, ApiError> {
        query(
            r#"
                SELECT b.booking_channel_id AS channel_id,
                       bc.name,
                       bc.channel_type,
                       COUNT(*) AS redemptions,
                       COALESCE(SUM(r.net_total), 0)::text AS net_total
                FROM voucher_redemptions r
                JOIN bookings b ON b.id = r.booking_id
                LEFT JOIN booking_channels bc ON bc.id = b.booking_channel_id
                WHERE r.promotion_id = $1 AND r.status = 'applied'
                GROUP BY b.booking_channel_id, bc.name, bc.channel_type
                ORDER BY redemptions DESC, bc.name
            "#,
        )
        .bind(promotion_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }
}
