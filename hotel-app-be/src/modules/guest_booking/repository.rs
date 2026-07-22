use chrono::{Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::Row;

use super::models::{
    BookingInsert, GuestBookingConfirmation, GuestContact, OnlineInventoryAllocation,
    RoomTypeInventory, VoucherPricing,
};
use crate::core::db::{DbPool, DbRow, DbTransaction, decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers::{get_decimal, get_opt_decimal};
use crate::sql_query;

const ACTIVE_BOOKING_STATUSES: &str =
    "'reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending'";

fn json_string_list(row: &DbRow, column: &str) -> Vec<String> {
    if let Ok(Some(value)) = row.try_get::<Option<serde_json::Value>, _>(column) {
        return serde_json::from_value(value).unwrap_or_default();
    }
    row.try_get::<Option<String>, _>(column)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn inventory_from_row(row: &DbRow) -> RoomTypeInventory {
    RoomTypeInventory {
        id: row.try_get("id").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        description: row.try_get("description").ok().flatten(),
        base_price: get_decimal(row, "base_price"),
        weekday_rate: get_opt_decimal(row, "weekday_rate"),
        weekend_rate: get_opt_decimal(row, "weekend_rate"),
        max_occupancy: row.try_get("max_occupancy").unwrap_or(2),
        bed_type: row.try_get("bed_type").ok().flatten(),
        bed_count: row.try_get("bed_count").ok().flatten(),
        images: json_string_list(row, "images"),
        features: json_string_list(row, "features"),
        available_rooms: row.try_get("available_rooms").unwrap_or_default(),
    }
}

fn confirmation_from_row(row: &DbRow) -> GuestBookingConfirmation {
    GuestBookingConfirmation {
        booking_id: row.try_get("id").unwrap_or_default(),
        booking_number: row.try_get("booking_number").unwrap_or_default(),
        room_type_name: row.try_get("room_type_name").unwrap_or_default(),
        check_in_date: row
            .try_get("check_in_date")
            .unwrap_or_else(|_| Utc::now().date_naive()),
        check_out_date: row
            .try_get("check_out_date")
            .unwrap_or_else(|_| Utc::now().date_naive()),
        status: row.try_get("status").unwrap_or_default(),
        payment_status: row.try_get("payment_status").unwrap_or_default(),
        currency: row
            .try_get("currency")
            .unwrap_or_else(|_| "MYR".to_string()),
        subtotal: get_decimal(row, "subtotal"),
        discount_amount: get_decimal(row, "discount_amount"),
        tax_amount: get_decimal(row, "tax_amount"),
        total_amount: get_decimal(row, "total_amount"),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub struct GuestBookingRepository;

impl GuestBookingRepository {
    pub async fn online_allocation_for_stay(
        pool: &DbPool,
        room_type_id: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
    ) -> Result<(i64, bool), ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: "SELECT COALESCE(MAX(walk_in_reserved_rooms), 0)::bigint AS reserved, COALESCE(BOOL_AND(online_booking_enabled), true) AS enabled FROM online_inventory_allocations WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3",
            sqlite: "SELECT COALESCE(MAX(walk_in_reserved_rooms), 0) AS reserved, COALESCE(MIN(online_booking_enabled), 1) AS enabled FROM online_inventory_allocations WHERE room_type_id = ?1 AND stay_date >= ?2 AND stay_date < ?3"
        ))
        .bind(room_type_id)
        .bind(check_in)
        .bind(check_out)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok((
            row.try_get("reserved").unwrap_or_default(),
            row.try_get("enabled").unwrap_or(true),
        ))
    }

    pub async fn list_online_inventory(
        pool: &DbPool,
        stay_date: NaiveDate,
    ) -> Result<Vec<OnlineInventoryAllocation>, ApiError> {
        let next_date = stay_date
            .succ_opt()
            .ok_or_else(|| ApiError::BadRequest("Invalid stay date".to_string()))?;
        let rows = sqlx::query(sql_query!(
            postgres: r#"
                SELECT rt.id AS room_type_id, rt.code AS room_type_code, rt.name AS room_type_name,
                       COUNT(r.id)::bigint AS physical_available_rooms,
                       COALESCE(a.walk_in_reserved_rooms, 0) AS walk_in_reserved_rooms,
                       COALESCE(a.online_booking_enabled, true) AS online_booking_enabled
                FROM room_types rt
                LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.is_active = true
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id
                    AND b.status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
                    AND b.check_in_date < $2 AND b.check_out_date > $1)
                LEFT JOIN online_inventory_allocations a ON a.room_type_id = rt.id AND a.stay_date = $1
                WHERE rt.is_active = true
                GROUP BY rt.id, rt.code, rt.name, a.walk_in_reserved_rooms, a.online_booking_enabled
                ORDER BY rt.name
            "#,
            sqlite: r#"
                SELECT rt.id AS room_type_id, rt.code AS room_type_code, rt.name AS room_type_name,
                       COUNT(r.id) AS physical_available_rooms,
                       COALESCE(a.walk_in_reserved_rooms, 0) AS walk_in_reserved_rooms,
                       COALESCE(a.online_booking_enabled, 1) AS online_booking_enabled
                FROM room_types rt
                LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.is_active = 1
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id
                    AND b.status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
                    AND b.check_in_date < ?2 AND b.check_out_date > ?1)
                LEFT JOIN online_inventory_allocations a ON a.room_type_id = rt.id AND a.stay_date = ?1
                WHERE rt.is_active = 1
                GROUP BY rt.id, rt.code, rt.name, a.walk_in_reserved_rooms, a.online_booking_enabled
                ORDER BY rt.name
            "#
        ))
        .bind(stay_date)
        .bind(next_date)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let physical: i64 = row.try_get("physical_available_rooms").unwrap_or_default();
                let reserved: i32 = row.try_get("walk_in_reserved_rooms").unwrap_or_default();
                let enabled: bool = row.try_get("online_booking_enabled").unwrap_or(true);
                OnlineInventoryAllocation {
                    room_type_id: row.try_get("room_type_id").unwrap_or_default(),
                    room_type_code: row.try_get("room_type_code").unwrap_or_default(),
                    room_type_name: row.try_get("room_type_name").unwrap_or_default(),
                    stay_date,
                    physical_available_rooms: physical,
                    walk_in_reserved_rooms: reserved,
                    online_booking_enabled: enabled,
                    online_available_rooms: if enabled {
                        (physical - i64::from(reserved)).max(0)
                    } else {
                        0
                    },
                }
            })
            .collect())
    }

    pub async fn upsert_online_inventory(
        pool: &DbPool,
        room_type_id: i64,
        stay_date: NaiveDate,
        reserved: i32,
        enabled: bool,
        updated_by: i64,
    ) -> Result<(), ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        Self::lock_room_type_tx(&mut tx, room_type_id).await?;
        sqlx::query(sql_query!(
            postgres: "INSERT INTO online_inventory_allocations (room_type_id, stay_date, walk_in_reserved_rooms, online_booking_enabled, updated_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (room_type_id, stay_date) DO UPDATE SET walk_in_reserved_rooms = EXCLUDED.walk_in_reserved_rooms, online_booking_enabled = EXCLUDED.online_booking_enabled, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP",
            sqlite: "INSERT INTO online_inventory_allocations (room_type_id, stay_date, walk_in_reserved_rooms, online_booking_enabled, updated_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (room_type_id, stay_date) DO UPDATE SET walk_in_reserved_rooms = excluded.walk_in_reserved_rooms, online_booking_enabled = excluded.online_booking_enabled, updated_by = excluded.updated_by, updated_at = datetime('now')"
        ))
        .bind(room_type_id).bind(stay_date).bind(reserved).bind(enabled).bind(updated_by)
        .execute(&mut *tx).await.map_err(ApiError::from)?;
        tx.commit().await.map_err(ApiError::from)?;
        Ok(())
    }

    async fn lock_room_type_tx(
        tx: &mut DbTransaction<'_>,
        room_type_id: i64,
    ) -> Result<(), ApiError> {
        let id = sqlx::query_scalar::<_, i64>(sql_query!(
            postgres: "SELECT id FROM room_types WHERE id = $1 FOR UPDATE",
            sqlite: "SELECT id FROM room_types WHERE id = ?1"
        ))
        .bind(room_type_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        id.ok_or_else(|| ApiError::NotFound("Room type not found".to_string()))?;
        Ok(())
    }

    pub async fn ensure_online_room_available_tx(
        tx: &mut DbTransaction<'_>,
        room_type_id: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
    ) -> Result<(), ApiError> {
        Self::lock_room_type_tx(tx, room_type_id).await?;
        let allocation = sqlx::query(sql_query!(
            postgres: "SELECT COALESCE(MAX(walk_in_reserved_rooms), 0)::bigint AS reserved, COALESCE(BOOL_AND(online_booking_enabled), true) AS enabled FROM online_inventory_allocations WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3",
            sqlite: "SELECT COALESCE(MAX(walk_in_reserved_rooms), 0) AS reserved, COALESCE(MIN(online_booking_enabled), 1) AS enabled FROM online_inventory_allocations WHERE room_type_id = ?1 AND stay_date >= ?2 AND stay_date < ?3"
        ))
        .bind(room_type_id)
        .bind(check_in)
        .bind(check_out)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        let reserved: i64 = allocation.try_get("reserved").unwrap_or_default();
        let enabled: bool = allocation.try_get("enabled").unwrap_or(true);
        if !enabled {
            return Err(ApiError::Conflict(
                "Online booking was closed for one or more selected dates. Please review the refreshed availability."
                    .to_string(),
            ));
        }

        let available: i64 = sqlx::query_scalar(&sql_query!(
            postgres: format!(
                "SELECT COUNT(*)::bigint FROM rooms r WHERE r.room_type_id = $1 AND r.is_active = true AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order') AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status IN ({ACTIVE_BOOKING_STATUSES}) AND b.check_in_date < $3 AND b.check_out_date > $2)"
            ),
            sqlite: format!(
                "SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = ?1 AND r.is_active = 1 AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order') AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status IN ({ACTIVE_BOOKING_STATUSES}) AND b.check_in_date < ?3 AND b.check_out_date > ?2)"
            )
        ))
        .bind(room_type_id)
        .bind(check_in)
        .bind(check_out)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        if available <= reserved {
            return Err(ApiError::Conflict(
                "Online room availability changed. Please review the refreshed options before confirming."
                    .to_string(),
            ));
        }
        Ok(())
    }
    pub async fn guest_contact(pool: &DbPool, guest_id: i64) -> Result<GuestContact, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                SELECT g.full_name, g.email,
                       (SELECT u.id FROM users u
                        WHERE u.guest_id = g.id AND u.user_type::text = 'guest'
                        ORDER BY u.id LIMIT 1) AS actor_user_id
                FROM guests g WHERE g.id = $1
            "#,
            sqlite: r#"
                SELECT g.full_name, g.email,
                       (SELECT u.id FROM users u
                        WHERE u.guest_id = g.id AND u.user_type = 'guest'
                        ORDER BY u.id LIMIT 1) AS actor_user_id
                FROM guests g WHERE g.id = ?1
            "#
        ))
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(GuestContact {
            actor_user_id: row.try_get("actor_user_id").ok().flatten(),
            full_name: row.try_get("full_name").unwrap_or_default(),
            email: row.try_get("email").ok().flatten(),
        })
    }

    pub async fn list_inventory(
        pool: &DbPool,
        check_in: NaiveDate,
        check_out: NaiveDate,
        occupancy: i32,
    ) -> Result<Vec<RoomTypeInventory>, ApiError> {
        let sql = sql_query!(
            postgres: format!(
                r#"
                SELECT rt.id, rt.code, rt.name, rt.description,
                       rt.base_price::text AS base_price,
                       rt.weekday_rate::text AS weekday_rate,
                       rt.weekend_rate::text AS weekend_rate,
                       rt.max_occupancy, rt.bed_type, rt.bed_count,
                       rt.images, rt.features,
                       COUNT(r.id)::bigint AS available_rooms
                FROM room_types rt
                JOIN rooms r ON r.room_type_id = rt.id
                WHERE rt.is_active = true
                  AND rt.max_occupancy >= $3
                  AND r.is_active = true
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.room_id = r.id
                      AND b.status IN ({ACTIVE_BOOKING_STATUSES})
                      AND b.check_in_date < $2
                      AND b.check_out_date > $1
                  )
                GROUP BY rt.id, rt.code, rt.name, rt.description, rt.base_price,
                         rt.weekday_rate, rt.weekend_rate, rt.max_occupancy,
                         rt.bed_type, rt.bed_count, rt.images, rt.features, rt.sort_order
                ORDER BY rt.sort_order, rt.name
                "#
            ),
            sqlite: format!(
                r#"
                SELECT rt.id, rt.code, rt.name, rt.description,
                       CAST(rt.base_price AS TEXT) AS base_price,
                       CAST(rt.weekday_rate AS TEXT) AS weekday_rate,
                       CAST(rt.weekend_rate AS TEXT) AS weekend_rate,
                       rt.max_occupancy, rt.bed_type, rt.bed_count,
                       rt.images, rt.features,
                       COUNT(r.id) AS available_rooms
                FROM room_types rt
                JOIN rooms r ON r.room_type_id = rt.id
                WHERE rt.is_active = 1
                  AND rt.max_occupancy >= ?3
                  AND r.is_active = 1
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.room_id = r.id
                      AND b.status IN ({ACTIVE_BOOKING_STATUSES})
                      AND b.check_in_date < ?2
                      AND b.check_out_date > ?1
                  )
                GROUP BY rt.id, rt.code, rt.name, rt.description, rt.base_price,
                         rt.weekday_rate, rt.weekend_rate, rt.max_occupancy,
                         rt.bed_type, rt.bed_count, rt.images, rt.features, rt.sort_order
                ORDER BY rt.sort_order, rt.name
                "#
            )
        );
        let rows = sqlx::query(&sql)
            .bind(check_in)
            .bind(check_out)
            .bind(occupancy)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(inventory_from_row).collect())
    }

    pub async fn find_inventory(
        pool: &DbPool,
        room_type_id: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
        occupancy: i32,
    ) -> Result<RoomTypeInventory, ApiError> {
        Self::list_inventory(pool, check_in, check_out, occupancy)
            .await?
            .into_iter()
            .find(|room_type| room_type.id == room_type_id)
            .ok_or_else(|| ApiError::Conflict("This room type is no longer available".to_string()))
    }

    pub async fn applicable_rate(
        pool: &DbPool,
        room_type_id: i64,
        date: NaiveDate,
    ) -> Result<Option<(String, Decimal)>, ApiError> {
        let weekday = date.weekday().num_days_from_monday() as i32;
        let row = sqlx::query(sql_query!(
            postgres: r#"
                SELECT rp.code, rr.price::text AS price
                FROM room_rates rr
                JOIN rate_plans rp ON rp.id = rr.rate_plan_id
                WHERE rr.room_type_id = $1
                  AND rp.is_active = true
                  AND rr.effective_from <= $2
                  AND (rr.effective_to IS NULL OR rr.effective_to >= $2)
                  AND (rp.valid_from IS NULL OR rp.valid_from <= $2)
                  AND (rp.valid_to IS NULL OR rp.valid_to >= $2)
                  AND (($3 = 0 AND rp.applies_monday = true)
                    OR ($3 = 1 AND rp.applies_tuesday = true)
                    OR ($3 = 2 AND rp.applies_wednesday = true)
                    OR ($3 = 3 AND rp.applies_thursday = true)
                    OR ($3 = 4 AND rp.applies_friday = true)
                    OR ($3 = 5 AND rp.applies_saturday = true)
                    OR ($3 = 6 AND rp.applies_sunday = true))
                ORDER BY rp.priority DESC, rr.id DESC LIMIT 1
            "#,
            sqlite: r#"
                SELECT rp.code, CAST(rr.price AS TEXT) AS price
                FROM room_rates rr
                JOIN rate_plans rp ON rp.id = rr.rate_plan_id
                WHERE rr.room_type_id = ?1
                  AND rp.is_active = 1
                  AND rr.effective_from <= ?2
                  AND (rr.effective_to IS NULL OR rr.effective_to >= ?2)
                  AND (rp.valid_from IS NULL OR rp.valid_from <= ?2)
                  AND (rp.valid_to IS NULL OR rp.valid_to >= ?2)
                  AND ((?3 = 0 AND rp.applies_monday = 1)
                    OR (?3 = 1 AND rp.applies_tuesday = 1)
                    OR (?3 = 2 AND rp.applies_wednesday = 1)
                    OR (?3 = 3 AND rp.applies_thursday = 1)
                    OR (?3 = 4 AND rp.applies_friday = 1)
                    OR (?3 = 5 AND rp.applies_saturday = 1)
                    OR (?3 = 6 AND rp.applies_sunday = 1))
                ORDER BY rp.priority DESC, rr.id DESC LIMIT 1
            "#
        ))
        .bind(room_type_id)
        .bind(date)
        .bind(weekday)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(row.map(|row| {
            (
                row.try_get("code").unwrap_or_else(|_| "BASE".to_string()),
                get_decimal(&row, "price"),
            )
        }))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn eligible_voucher(
        pool: &DbPool,
        voucher_id: i64,
        guest_id: i64,
        room_type_id: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
        nights: i64,
        subtotal: Decimal,
        currency: &str,
    ) -> Result<VoucherPricing, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                SELECT v.id AS voucher_id, p.id AS promotion_id, p.name AS promotion_name,
                       p.discount_type, p.discount_value::text AS discount_value,
                       p.max_discount_amount::text AS max_discount_amount
                FROM vouchers v JOIN promotions p ON p.id = v.promotion_id
                WHERE v.id = $1 AND v.guest_id = $2 AND v.status = 'available'
                  AND (v.expires_at IS NULL OR v.expires_at > CURRENT_TIMESTAMP)
                  AND p.status = 'published'
                  AND (p.stay_starts_on IS NULL OR p.stay_starts_on <= $4)
                  AND (p.stay_ends_on IS NULL OR p.stay_ends_on >= $5)
                  AND (p.min_nights IS NULL OR p.min_nights <= $6)
                  AND (p.max_nights IS NULL OR p.max_nights >= $6)
                  AND p.min_subtotal <= $7
                  AND p.currency = $8
                  AND (NOT EXISTS (SELECT 1 FROM promotion_room_types pr0 WHERE pr0.promotion_id = p.id)
                    OR EXISTS (SELECT 1 FROM promotion_room_types pr WHERE pr.promotion_id = p.id AND pr.room_type_id = $3))
            "#,
            sqlite: r#"
                SELECT v.id AS voucher_id, p.id AS promotion_id, p.name AS promotion_name,
                       p.discount_type, CAST(p.discount_value AS TEXT) AS discount_value,
                       CAST(p.max_discount_amount AS TEXT) AS max_discount_amount
                FROM vouchers v JOIN promotions p ON p.id = v.promotion_id
                WHERE v.id = ?1 AND v.guest_id = ?2 AND v.status = 'available'
                  AND (v.expires_at IS NULL OR v.expires_at > datetime('now'))
                  AND p.status = 'published'
                  AND (p.stay_starts_on IS NULL OR p.stay_starts_on <= ?4)
                  AND (p.stay_ends_on IS NULL OR p.stay_ends_on >= ?5)
                  AND (p.min_nights IS NULL OR p.min_nights <= ?6)
                  AND (p.max_nights IS NULL OR p.max_nights >= ?6)
                  AND p.min_subtotal <= ?7
                  AND p.currency = ?8
                  AND (NOT EXISTS (SELECT 1 FROM promotion_room_types pr0 WHERE pr0.promotion_id = p.id)
                    OR EXISTS (SELECT 1 FROM promotion_room_types pr WHERE pr.promotion_id = p.id AND pr.room_type_id = ?3))
            "#
        ))
        .bind(voucher_id)
        .bind(guest_id)
        .bind(room_type_id)
        .bind(check_in)
        .bind(check_out)
        .bind(nights)
        .bind(decimal_to_db(subtotal))
        .bind(currency)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| {
            ApiError::Conflict("This voucher is not eligible for the selected stay".to_string())
        })?;
        Ok(VoucherPricing {
            voucher_id: row.try_get("voucher_id").unwrap_or_default(),
            promotion_id: row.try_get("promotion_id").unwrap_or_default(),
            promotion_name: row.try_get("promotion_name").unwrap_or_default(),
            discount_type: row.try_get("discount_type").unwrap_or_default(),
            discount_value: get_decimal(&row, "discount_value"),
            max_discount_amount: get_opt_decimal(&row, "max_discount_amount"),
        })
    }

    pub async fn find_by_request_id(
        pool: &DbPool,
        guest_id: i64,
        request_id: &str,
    ) -> Result<Option<GuestBookingConfirmation>, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                SELECT b.id, b.booking_number, rt.name AS room_type_name,
                       b.check_in_date, b.check_out_date, b.status, b.payment_status,
                       b.currency, b.subtotal::text AS subtotal,
                       b.discount_amount::text AS discount_amount,
                       b.tax_amount::text AS tax_amount, b.total_amount::text AS total_amount,
                       b.created_at
                FROM bookings b
                JOIN rooms r ON r.id = b.room_id
                JOIN room_types rt ON rt.id = r.room_type_id
                WHERE b.guest_id = $1 AND b.portal_request_id = $2
            "#,
            sqlite: r#"
                SELECT b.id, b.booking_number, rt.name AS room_type_name,
                       b.check_in_date, b.check_out_date, b.status, b.payment_status,
                       b.currency, CAST(b.subtotal AS TEXT) AS subtotal,
                       CAST(b.discount_amount AS TEXT) AS discount_amount,
                       CAST(b.tax_amount AS TEXT) AS tax_amount,
                       CAST(b.total_amount AS TEXT) AS total_amount, b.created_at
                FROM bookings b
                JOIN rooms r ON r.id = b.room_id
                JOIN room_types rt ON rt.id = r.room_type_id
                WHERE b.guest_id = ?1 AND b.portal_request_id = ?2
            "#
        ))
        .bind(guest_id)
        .bind(request_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(row.as_ref().map(confirmation_from_row))
    }

    pub async fn direct_booking_channel(pool: &DbPool) -> Result<Option<i64>, ApiError> {
        sqlx::query_scalar(sql_query!(
            postgres: r#"
                SELECT id FROM booking_channels
                WHERE is_active = true AND (LOWER(name) IN ('website', 'direct website', 'direct')
                  OR channel_type = 'direct')
                ORDER BY CASE LOWER(name) WHEN 'direct website' THEN 0 WHEN 'website' THEN 1 ELSE 2 END, id
                LIMIT 1
            "#,
            sqlite: r#"
                SELECT id FROM booking_channels
                WHERE is_active = 1 AND (LOWER(name) IN ('website', 'direct website', 'direct')
                  OR channel_type = 'direct')
                ORDER BY CASE LOWER(name) WHEN 'direct website' THEN 0 WHEN 'website' THEN 1 ELSE 2 END, id
                LIMIT 1
            "#
        ))
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn allocate_room_tx(
        tx: &mut DbTransaction<'_>,
        room_type_id: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
    ) -> Result<i64, ApiError> {
        let sql = sql_query!(
            postgres: format!(
                r#"
                SELECT r.id FROM rooms r
                WHERE r.room_type_id = $1 AND r.is_active = true
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.room_id = r.id AND b.status IN ({ACTIVE_BOOKING_STATUSES})
                      AND b.check_in_date < $3 AND b.check_out_date > $2
                  )
                ORDER BY r.id
                FOR UPDATE SKIP LOCKED LIMIT 1
                "#
            ),
            sqlite: format!(
                r#"
                SELECT r.id FROM rooms r
                WHERE r.room_type_id = ?1 AND r.is_active = 1
                  AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.room_id = r.id AND b.status IN ({ACTIVE_BOOKING_STATUSES})
                      AND b.check_in_date < ?3 AND b.check_out_date > ?2
                  )
                ORDER BY r.id LIMIT 1
                "#
            )
        );
        sqlx::query_scalar(&sql)
            .bind(room_type_id)
            .bind(check_in)
            .bind(check_out)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::Conflict("The selected room type was just booked".to_string()))
    }

    pub async fn insert_booking_tx(
        tx: &mut DbTransaction<'_>,
        input: &BookingInsert,
    ) -> Result<i64, ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let nightly_rates = input.nightly_rates.to_string();
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let nightly_rates = &input.nightly_rates;

        sqlx::query_scalar(sql_query!(
            postgres: r#"
                INSERT INTO bookings (
                    portal_request_id, booking_number, guest_id, room_id,
                    check_in_date, check_out_date, adults, children,
                    room_rate, subtotal, tax_amount, discount_amount, total_amount,
                    currency, status, payment_status, source, booking_channel_id,
                    special_requests, cleaning_preference, daily_rates, created_by
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8,
                    $9, $10, 0, $11, $12, $13, 'pending', 'unpaid',
                    'website', $14, $15, $16, $17, $18
                ) RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO bookings (
                    portal_request_id, booking_number, guest_id, room_id,
                    check_in_date, check_out_date, adults, children,
                    room_rate, rate_per_night, subtotal, tax_amount, discount_amount, total_amount,
                    currency, status, payment_status, source, booking_channel_id,
                    special_requests, cleaning_preference, daily_rates, created_by
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    ?9, ?9, ?10, 0, ?11, ?12, ?13, 'pending', 'unpaid',
                    'website', ?14, ?15, ?16, ?17, ?18
                ) RETURNING id
            "#
        ))
        .bind(&input.portal_request_id)
        .bind(&input.booking_number)
        .bind(input.guest_id)
        .bind(input.room_id)
        .bind(input.check_in_date)
        .bind(input.check_out_date)
        .bind(input.adults)
        .bind(input.children)
        .bind(decimal_to_db(input.room_rate))
        .bind(decimal_to_db(input.subtotal))
        .bind(decimal_to_db(input.discount_amount))
        .bind(decimal_to_db(input.total_amount))
        .bind(&input.currency)
        .bind(input.booking_channel_id)
        .bind(input.special_requests.as_deref())
        .bind(input.cleaning_preference)
        .bind(nightly_rates)
        .bind(input.actor_user_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn redeem_voucher_tx(
        tx: &mut DbTransaction<'_>,
        voucher: &VoucherPricing,
        booking_id: i64,
        guest_id: i64,
        actor_user_id: Option<i64>,
        subtotal: Decimal,
        discount_amount: Decimal,
        total_amount: Decimal,
    ) -> Result<(), ApiError> {
        let updated = sqlx::query(sql_query!(
            postgres: "UPDATE vouchers SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND guest_id = $2 AND status = 'available'",
            sqlite: "UPDATE vouchers SET status = 'redeemed', redeemed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1 AND guest_id = ?2 AND status = 'available'"
        ))
        .bind(voucher.voucher_id)
        .bind(guest_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?
        .rows_affected();
        if updated != 1 {
            return Err(ApiError::Conflict(
                "This voucher was already used".to_string(),
            ));
        }

        sqlx::query(sql_query!(
            postgres: r#"
                INSERT INTO voucher_redemptions (
                    voucher_id, promotion_id, booking_id, guest_id, status,
                    gross_subtotal, discount_type, discount_value,
                    discount_amount, net_total, applied_by
                ) VALUES ($1, $2, $3, $4, 'applied', $5, $6, $7, $8, $9, $10)
            "#,
            sqlite: r#"
                INSERT INTO voucher_redemptions (
                    voucher_id, promotion_id, booking_id, guest_id, status,
                    gross_subtotal, discount_type, discount_value,
                    discount_amount, net_total, applied_by
                ) VALUES (?1, ?2, ?3, ?4, 'applied', ?5, ?6, ?7, ?8, ?9, ?10)
            "#
        ))
        .bind(voucher.voucher_id)
        .bind(voucher.promotion_id)
        .bind(booking_id)
        .bind(guest_id)
        .bind(decimal_to_db(subtotal))
        .bind(&voucher.discount_type)
        .bind(decimal_to_db(voucher.discount_value))
        .bind(decimal_to_db(discount_amount))
        .bind(decimal_to_db(total_amount))
        .bind(actor_user_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn mark_room_reserved_tx(
        tx: &mut DbTransaction<'_>,
        room_id: i64,
        booking_number: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(sql_query!(
            postgres: r#"
                UPDATE rooms SET
                    status = CASE WHEN status IN ('dirty', 'cleaning', 'reserved_dirty')
                                  THEN 'reserved_dirty' ELSE 'reserved' END,
                    status_notes = $1
                WHERE id = $2
            "#,
            sqlite: r#"
                UPDATE rooms SET
                    status = CASE WHEN status IN ('dirty', 'cleaning', 'reserved_dirty')
                                  THEN 'reserved_dirty' ELSE 'reserved' END,
                    status_notes = ?1
                WHERE id = ?2
            "#
        ))
        .bind(format!("Website booking #{booking_number}"))
        .bind(room_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn confirmation_by_id(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<GuestBookingConfirmation, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                SELECT b.id, b.booking_number, rt.name AS room_type_name,
                       b.check_in_date, b.check_out_date, b.status, b.payment_status,
                       b.currency, b.subtotal::text AS subtotal,
                       b.discount_amount::text AS discount_amount,
                       b.tax_amount::text AS tax_amount, b.total_amount::text AS total_amount,
                       b.created_at
                FROM bookings b JOIN rooms r ON r.id = b.room_id
                JOIN room_types rt ON rt.id = r.room_type_id WHERE b.id = $1
            "#,
            sqlite: r#"
                SELECT b.id, b.booking_number, rt.name AS room_type_name,
                       b.check_in_date, b.check_out_date, b.status, b.payment_status,
                       b.currency, CAST(b.subtotal AS TEXT) AS subtotal,
                       CAST(b.discount_amount AS TEXT) AS discount_amount,
                       CAST(b.tax_amount AS TEXT) AS tax_amount,
                       CAST(b.total_amount AS TEXT) AS total_amount, b.created_at
                FROM bookings b JOIN rooms r ON r.id = b.room_id
                JOIN room_types rt ON rt.id = r.room_type_id WHERE b.id = ?1
            "#
        ))
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(confirmation_from_row(&row))
    }

    pub async fn available_count(
        pool: &DbPool,
        room_type_id: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
    ) -> Result<i64, ApiError> {
        Ok(Self::list_inventory(pool, check_in, check_out, 1)
            .await?
            .into_iter()
            .find(|room_type| room_type.id == room_type_id)
            .map(|room_type| room_type.available_rooms)
            .unwrap_or(0))
    }
}
