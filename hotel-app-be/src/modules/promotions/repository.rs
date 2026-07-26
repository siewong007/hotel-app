//! Persistence for promotion campaigns and guest vouchers.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Row, query, query_scalar};

use super::models::{Promotion, PublicPromotion, Voucher};
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
    CAST(p.version AS BIGINT) AS version,
    p.created_by,
    p.updated_by,
    p.created_at,
    p.updated_at
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
    CAST(p.version AS BIGINT) AS version,
    p.created_at,
    p.updated_at
"#;

const VOUCHER_COLUMNS: &str = r#"
    v.id,
    v.promotion_id,
    v.guest_id,
    p.name AS promotion_name,
    p.slug AS promotion_slug,
    v.code,
    v.status,
    v.source,
    v.expires_at,
    v.claimed_at,
    v.redeemed_at,
    v.revoked_at,
    v.created_at
"#;

fn decimal_to_f64(value: rust_decimal::Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

fn promotion_from_row(row: &DbRow, room_type_ids: Vec<i64>) -> Promotion {
    Promotion {
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
        room_type_ids,
        version: row.try_get("version").unwrap_or(1),
        created_by: row.try_get::<Option<i64>, _>("created_by").ok().flatten(),
        updated_by: row.try_get::<Option<i64>, _>("updated_by").ok().flatten(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

/// Row mapper for [`PROMOTION_COLUMNS_PUBLIC`] — the row never contains
/// `created_by`/`updated_by`, so there is no field to accidentally read here.
fn public_promotion_from_row(row: &DbRow, room_type_ids: Vec<i64>) -> PublicPromotion {
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
        room_type_ids,
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
    async fn room_type_ids(pool: &DbPool, promotion_id: i64) -> Result<Vec<i64>, ApiError> {
        query_scalar("SELECT room_type_id FROM promotion_room_types WHERE promotion_id = $1 ORDER BY room_type_id")
        .bind(promotion_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }

    async fn promotions_from_rows(
        pool: &DbPool,
        rows: Vec<DbRow>,
    ) -> Result<Vec<Promotion>, ApiError> {
        let mut promotions = Vec::with_capacity(rows.len());
        for row in rows {
            let promotion_id = row.try_get("id").map_err(ApiError::from)?;
            promotions.push(promotion_from_row(
                &row,
                Self::room_type_ids(pool, promotion_id).await?,
            ));
        }
        Ok(promotions)
    }

    async fn public_promotions_from_rows(
        pool: &DbPool,
        rows: Vec<DbRow>,
    ) -> Result<Vec<PublicPromotion>, ApiError> {
        let mut promotions = Vec::with_capacity(rows.len());
        for row in rows {
            let promotion_id = row.try_get("id").map_err(ApiError::from)?;
            promotions.push(public_promotion_from_row(
                &row,
                Self::room_type_ids(pool, promotion_id).await?,
            ));
        }
        Ok(promotions)
    }

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
                    FROM promotions p
                    WHERE p.status = 'published'
                      AND p.is_public = true
                      AND (p.claim_starts_at IS NULL OR p.claim_starts_at <= CURRENT_TIMESTAMP)
                      AND (p.claim_ends_at IS NULL OR p.claim_ends_at >= CURRENT_TIMESTAMP)
                      AND (p.claim_limit IS NULL OR p.claimed_count < p.claim_limit)
                    ORDER BY p.claim_ends_at NULLS LAST, p.created_at DESC
                    LIMIT $1 OFFSET $2
                "#
        .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS_PUBLIC);
        let rows = query(&sql)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((total, Self::public_promotions_from_rows(pool, rows).await?))
    }

    pub async fn list_admin(
        pool: &DbPool,
        status: Option<&str>,
        search: Option<&str>,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<Promotion>), ApiError> {
        let count_sql = r#"
                SELECT COUNT(*)
                FROM promotions p
                WHERE ($1::text IS NULL OR p.status = $1)
                  AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(p.slug) LIKE '%' || LOWER($2) || '%')
            "#;
        let total = query_scalar::<_, i64>(count_sql)
            .bind(status)
            .bind(search)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = r#"
                    SELECT {PROMOTION_COLUMNS}
                    FROM promotions p
                    WHERE ($1::text IS NULL OR p.status = $1)
                      AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(p.slug) LIKE '%' || LOWER($2) || '%')
                    ORDER BY p.updated_at DESC
                    LIMIT $3 OFFSET $4
                "#
        .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS);
        let rows = query(&sql)
            .bind(status)
            .bind(search)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((total, Self::promotions_from_rows(pool, rows).await?))
    }

    pub async fn find_by_id(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<Option<Promotion>, ApiError> {
        let sql = "SELECT {PROMOTION_COLUMNS} FROM promotions p WHERE p.id = $1"
            .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS);
        let row = query(&sql)
            .bind(promotion_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let id = row.try_get("id").map_err(ApiError::from)?;
        Ok(Some(promotion_from_row(
            &row,
            Self::room_type_ids(pool, id).await?,
        )))
    }

    pub async fn find_by_slug(pool: &DbPool, slug: &str) -> Result<Option<Promotion>, ApiError> {
        let sql = "SELECT {PROMOTION_COLUMNS} FROM promotions p WHERE p.slug = $1"
            .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS);
        let row = query(&sql)
            .bind(slug)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let id = row.try_get("id").map_err(ApiError::from)?;
        Ok(Some(promotion_from_row(
            &row,
            Self::room_type_ids(pool, id).await?,
        )))
    }

    pub async fn find_public_by_slug(
        pool: &DbPool,
        slug: &str,
    ) -> Result<Option<PublicPromotion>, ApiError> {
        let sql = r#"
                    SELECT {PROMOTION_COLUMNS}
                    FROM promotions p
                    WHERE p.slug = $1
                      AND p.status = 'published'
                      AND p.is_public = true
                      AND (p.claim_starts_at IS NULL OR p.claim_starts_at <= CURRENT_TIMESTAMP)
                      AND (p.claim_ends_at IS NULL OR p.claim_ends_at >= CURRENT_TIMESTAMP)
                "#
        .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS_PUBLIC);
        let row = query(&sql)
            .bind(slug)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let id = row.try_get("id").map_err(ApiError::from)?;
        Ok(Some(public_promotion_from_row(
            &row,
            Self::room_type_ids(pool, id).await?,
        )))
    }

    pub async fn find_by_id_tx(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
    ) -> Result<Option<Promotion>, ApiError> {
        let sql = "SELECT {PROMOTION_COLUMNS} FROM promotions p WHERE p.id = $1"
            .replace("{PROMOTION_COLUMNS}", PROMOTION_COLUMNS);
        let row = query(&sql)
            .bind(promotion_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        Ok(row.map(|row| promotion_from_row(&row, Vec::new())))
    }

    pub async fn insert_promotion(
        tx: &mut DbTransaction<'_>,
        draft: &PromotionDraft,
        actor_id: i64,
    ) -> Result<i64, ApiError> {
        query_scalar(r#"
                INSERT INTO promotions (
                    slug, name, description, terms, promotion_kind, discount_type,
                    discount_value, max_discount_amount, currency, claim_starts_at,
                    claim_ends_at, stay_starts_on, stay_ends_on, min_nights, max_nights,
                    min_subtotal, claim_limit, per_guest_limit, is_public, is_cancellable, created_by, updated_by
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19, $20, $21, $22
                ) RETURNING id
            "#)
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
        query_scalar(r#"
                UPDATE promotions SET
                    slug = $1, name = $2, description = $3, terms = $4,
                    promotion_kind = $5, discount_type = $6, discount_value = $7,
                    max_discount_amount = $8, currency = $9, claim_starts_at = $10,
                    claim_ends_at = $11, stay_starts_on = $12, stay_ends_on = $13,
                    min_nights = $14, max_nights = $15, min_subtotal = $16,
                    claim_limit = $17, per_guest_limit = $18, is_public = $19,
                    is_cancellable = $20, updated_by = $21, updated_at = CURRENT_TIMESTAMP, version = version + 1
                WHERE id = $22
                  AND ($23::integer IS NULL OR version = $23)
                  AND status IN ('draft', 'paused')
                RETURNING id
            "#)
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
        let rows = query(&sql)
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

    pub async fn list_admin_vouchers(
        pool: &DbPool,
        status: Option<&str>,
        search: Option<&str>,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<Voucher>), ApiError> {
        let count_sql = r#"
                SELECT COUNT(*) FROM vouchers v
                JOIN promotions p ON p.id = v.promotion_id
                WHERE ($1::text IS NULL OR v.status = $1)
                  AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(v.code) = LOWER($2))
            "#;
        let total = query_scalar::<_, i64>(count_sql)
            .bind(status)
            .bind(search)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = r#"
                    SELECT {VOUCHER_COLUMNS}
                    FROM vouchers v JOIN promotions p ON p.id = v.promotion_id
                    WHERE ($1::text IS NULL OR v.status = $1)
                      -- Raw codes are masked in staff responses. Only allow an exact
                      -- code lookup so substring searches cannot become a code oracle.
                      AND ($2::text IS NULL OR LOWER(p.name) LIKE '%' || LOWER($2) || '%' OR LOWER(v.code) = LOWER($2))
                    ORDER BY v.created_at DESC LIMIT $3 OFFSET $4
                "#
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS);
        let rows = query(&sql)
            .bind(status)
            .bind(search)
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
        let row = query(&sql)
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
        let row = query(&sql)
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
        let sql = "SELECT {VOUCHER_COLUMNS} FROM vouchers v JOIN promotions p ON p.id = v.promotion_id WHERE v.id = $1"
        .replace("{VOUCHER_COLUMNS}", VOUCHER_COLUMNS);
        let row = query(&sql)
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
        .map_err(ApiError::from)
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
}
