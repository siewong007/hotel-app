use chrono::NaiveDate;
use sqlx::Row;

use super::allocation::room_type_lock_order;
use super::models::{
    BookingGroup, BookingGroupMember, GROUP_STATUS_ACTIVE, GROUP_STATUS_VOIDED, NewBookingGroup,
    derive_group_payment_status,
};
use crate::core::db::{DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;
use crate::models::row_mappers::get_decimal;

const GROUP_COLUMNS: &str = r#"
    id, uuid::text AS uuid, group_number, guest_id, check_in_date, check_out_date,
    source, status, payment_status, payment_method, room_count, subtotal,
    discount_amount, tax_amount, tourism_tax_amount, total_amount, currency,
    voucher_id, hold_expires_at, created_at, updated_at
"#;

fn group_from_row(row: &DbRow) -> Result<BookingGroup, ApiError> {
    Ok(BookingGroup {
        id: row.try_get("id").map_err(ApiError::from)?,
        uuid: row.try_get("uuid").map_err(ApiError::from)?,
        group_number: row.try_get("group_number").map_err(ApiError::from)?,
        guest_id: row.try_get("guest_id").map_err(ApiError::from)?,
        check_in_date: row.try_get("check_in_date").map_err(ApiError::from)?,
        check_out_date: row.try_get("check_out_date").map_err(ApiError::from)?,
        source: row.try_get("source").map_err(ApiError::from)?,
        status: row.try_get("status").map_err(ApiError::from)?,
        payment_status: row.try_get("payment_status").map_err(ApiError::from)?,
        payment_method: row.try_get("payment_method").map_err(ApiError::from)?,
        room_count: row.try_get("room_count").map_err(ApiError::from)?,
        subtotal: get_decimal(row, "subtotal"),
        discount_amount: get_decimal(row, "discount_amount"),
        tax_amount: get_decimal(row, "tax_amount"),
        tourism_tax_amount: get_decimal(row, "tourism_tax_amount"),
        total_amount: get_decimal(row, "total_amount"),
        currency: row.try_get("currency").map_err(ApiError::from)?,
        voucher_id: row.try_get("voucher_id").map_err(ApiError::from)?,
        hold_expires_at: row.try_get("hold_expires_at").map_err(ApiError::from)?,
        created_at: row.try_get("created_at").map_err(ApiError::from)?,
        updated_at: row.try_get("updated_at").map_err(ApiError::from)?,
    })
}

/// `G` + the booking-number shape, so a group reference is recognisable next
/// to its rooms' `BK-…` numbers.
pub fn generate_group_number_for_date(date: NaiveDate) -> String {
    format!(
        "G{}",
        crate::modules::bookings::helpers::generate_booking_number_for_date(date)
    )
}

pub struct BookingGroupRepository;

impl BookingGroupRepository {
    /// Lock every room type in the cart in ascending id order (the fixed
    /// order that keeps concurrent group checkouts deadlock-free). Errors with
    /// `NotFound` if any id is unknown.
    pub async fn lock_room_types_tx(
        tx: &mut DbTransaction<'_>,
        room_type_ids: &[i64],
    ) -> Result<(), ApiError> {
        let ordered = room_type_lock_order(room_type_ids);
        if ordered.is_empty() {
            return Ok(());
        }
        let locked: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM room_types WHERE id = ANY($1) ORDER BY id FOR UPDATE",
        )
        .bind(&ordered)
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        if locked.len() != ordered.len() {
            return Err(ApiError::NotFound("Room type not found".to_string()));
        }
        Ok(())
    }

    /// Insert an empty group; members are attached with [`Self::attach_tx`]
    /// and totals filled by [`Self::refresh_totals_tx`] in the same tx.
    pub async fn create_tx(
        tx: &mut DbTransaction<'_>,
        input: &NewBookingGroup,
    ) -> Result<BookingGroup, ApiError> {
        if input.check_out_date <= input.check_in_date {
            return Err(ApiError::BadRequest(
                "Check-out must be after check-in".to_string(),
            ));
        }
        let sql = format!(
            r#"
            INSERT INTO booking_groups (
                group_number, guest_id, check_in_date, check_out_date, source,
                currency, voucher_id, hold_expires_at, portal_request_id, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING {GROUP_COLUMNS}
            "#
        );
        let row = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(generate_group_number_for_date(input.check_in_date))
            .bind(input.guest_id)
            .bind(input.check_in_date)
            .bind(input.check_out_date)
            .bind(&input.source)
            .bind(&input.currency)
            .bind(input.voucher_id)
            .bind(input.hold_expires_at)
            .bind(&input.portal_request_id)
            .bind(input.created_by)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        group_from_row(&row)
    }

    /// Link member bookings to a group. Each must belong to the group's guest
    /// and not already sit in another group.
    pub async fn attach_tx(
        tx: &mut DbTransaction<'_>,
        group_id: i64,
        booking_ids: &[i64],
    ) -> Result<(), ApiError> {
        let updated = sqlx::query(
            r#"
            UPDATE bookings b SET booking_group_id = g.id, updated_at = CURRENT_TIMESTAMP
            FROM booking_groups g
            WHERE g.id = $1 AND b.id = ANY($2)
              AND b.guest_id = g.guest_id
              AND (b.booking_group_id IS NULL OR b.booking_group_id = g.id)
            "#,
        )
        .bind(group_id)
        .bind(booking_ids)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?
        .rows_affected();
        if updated as usize != booking_ids.len() {
            return Err(ApiError::Conflict(
                "A booking could not be added to this group".to_string(),
            ));
        }
        Ok(())
    }

    /// Keep a room's group in step after a single-room change (payment or
    /// void). No-op for bookings outside a group. Skips the refresh
    /// when another transaction holds the group lock: every group-level path
    /// refreshes the group itself before committing, and waiting here would
    /// invert the group → booking lock order those paths use.
    pub async fn refresh_for_booking_tx(
        tx: &mut DbTransaction<'_>,
        booking_id: i64,
    ) -> Result<(), ApiError> {
        let group_id: Option<i64> = sqlx::query_scalar(
            r#"
            SELECT g.id FROM bookings b
            JOIN booking_groups g ON g.id = b.booking_group_id
            WHERE b.id = $1
            FOR UPDATE OF g SKIP LOCKED
            "#,
        )
        .bind(booking_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        if let Some(group_id) = group_id {
            Self::refresh_totals_tx(tx, group_id).await?;
        }
        Ok(())
    }

    /// Recompute the group's totals, room count, payment status and status
    /// from its non-voided members. Call after any member changes (create,
    /// single-room cancel, payment) inside the same transaction.
    pub async fn refresh_totals_tx(
        tx: &mut DbTransaction<'_>,
        group_id: i64,
    ) -> Result<BookingGroup, ApiError> {
        let statuses: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT COALESCE(payment_status, 'unpaid') FROM bookings
            WHERE booking_group_id = $1 AND status <> 'voided'
            ORDER BY id
            "#,
        )
        .bind(group_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        let payment_status = derive_group_payment_status(statuses.iter().map(String::as_str));
        let status = if statuses.is_empty() {
            GROUP_STATUS_VOIDED
        } else {
            GROUP_STATUS_ACTIVE
        };
        let sql = format!(
            r#"
            UPDATE booking_groups g SET
                room_count = s.room_count,
                subtotal = s.subtotal,
                discount_amount = s.discount_amount,
                tax_amount = s.tax_amount,
                tourism_tax_amount = s.tourism_tax_amount,
                total_amount = s.total_amount,
                payment_status = $2,
                status = $3,
                updated_at = CURRENT_TIMESTAMP
            FROM (
                SELECT COUNT(*)::int AS room_count,
                       COALESCE(SUM(subtotal), 0) AS subtotal,
                       COALESCE(SUM(discount_amount), 0) AS discount_amount,
                       COALESCE(SUM(tax_amount), 0) AS tax_amount,
                       COALESCE(SUM(tourism_tax_amount), 0) AS tourism_tax_amount,
                       COALESCE(SUM(total_amount), 0) AS total_amount
                FROM bookings WHERE booking_group_id = $1 AND status <> 'voided'
            ) s
            WHERE g.id = $1
            RETURNING {}
            "#,
            GROUP_COLUMNS
                .split(',')
                .map(|column| format!("g.{}", column.trim()))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let row = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(group_id)
            .bind(&payment_status)
            .bind(status)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::NotFound("Booking group not found".to_string()))?;
        group_from_row(&row)
    }

    pub async fn find_by_id(
        pool: &DbPool,
        group_id: i64,
    ) -> Result<Option<BookingGroup>, ApiError> {
        let sql = format!("SELECT {GROUP_COLUMNS} FROM booking_groups WHERE id = $1");
        let row = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(group_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        row.as_ref().map(group_from_row).transpose()
    }

    /// The group, scoped to its guest — the IDOR-safe lookup for portal reads.
    pub async fn find_for_guest(
        pool: &DbPool,
        group_id: i64,
        guest_id: i64,
    ) -> Result<Option<BookingGroup>, ApiError> {
        let sql =
            format!("SELECT {GROUP_COLUMNS} FROM booking_groups WHERE id = $1 AND guest_id = $2");
        let row = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(group_id)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        row.as_ref().map(group_from_row).transpose()
    }

    /// Lock the group row (payment, cancel and hold expiry serialise on it).
    pub async fn lock_tx(
        tx: &mut DbTransaction<'_>,
        group_id: i64,
    ) -> Result<BookingGroup, ApiError> {
        let sql = format!("SELECT {GROUP_COLUMNS} FROM booking_groups WHERE id = $1 FOR UPDATE");
        let row = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(group_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::NotFound("Booking group not found".to_string()))?;
        group_from_row(&row)
    }

    /// Lock the group row like [`Self::lock_tx`], but refuse instead of
    /// waiting when another change already holds it, so two guest changes to
    /// the same group never both apply. Maps a busy lock to
    /// [`ApiError::GroupBusy`] ("try again").
    pub async fn lock_tx_nowait(
        tx: &mut DbTransaction<'_>,
        group_id: i64,
    ) -> Result<BookingGroup, ApiError> {
        let sql =
            format!("SELECT {GROUP_COLUMNS} FROM booking_groups WHERE id = $1 FOR UPDATE NOWAIT");
        let row = sqlx::query(sqlx::AssertSqlSafe(&*sql))
            .bind(group_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| match &error {
                sqlx::Error::Database(db) if db.code().as_deref() == Some("55P03") => {
                    ApiError::GroupBusy
                }
                _ => ApiError::from(error),
            })?
            .ok_or_else(|| ApiError::NotFound("Booking group not found".to_string()))?;
        group_from_row(&row)
    }

    /// Refuse a room change while any live room of the group has arrived.
    pub async fn ensure_no_room_arrived_tx(
        tx: &mut DbTransaction<'_>,
        group_id: i64,
    ) -> Result<(), ApiError> {
        let arrived: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM bookings WHERE booking_group_id = $1 \
             AND status = ANY($2))",
        )
        .bind(group_id)
        .bind(super::voucher_resplit::ARRIVED_STATUSES)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        if arrived {
            return Err(ApiError::GroupRoomCheckedIn);
        }
        Ok(())
    }

    /// Member rooms in booking order, including voided ones (callers filter).
    pub async fn members(
        pool: &DbPool,
        group_id: i64,
    ) -> Result<Vec<BookingGroupMember>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.booking_number, b.room_id, r.room_number, r.room_type_id,
                   rt.name AS room_type_name, b.adults, COALESCE(b.children, 0) AS children,
                   COALESCE(b.extra_bed_count, 0) AS extra_bed_count,
                   COALESCE(b.status, 'pending') AS status,
                   COALESCE(b.payment_status, 'unpaid') AS payment_status,
                   b.subtotal, b.discount_amount, b.tax_amount, b.tourism_tax_amount,
                   b.total_amount
            FROM bookings b
            LEFT JOIN rooms r ON r.id = b.room_id
            LEFT JOIN room_types rt ON rt.id = r.room_type_id
            WHERE b.booking_group_id = $1
            ORDER BY b.id
            "#,
        )
        .bind(group_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        rows.iter()
            .map(|row| {
                Ok(BookingGroupMember {
                    booking_id: row.try_get("id").map_err(ApiError::from)?,
                    booking_number: row.try_get("booking_number").map_err(ApiError::from)?,
                    room_id: row.try_get("room_id").map_err(ApiError::from)?,
                    room_number: row.try_get("room_number").map_err(ApiError::from)?,
                    room_type_id: row.try_get("room_type_id").map_err(ApiError::from)?,
                    room_type_name: row.try_get("room_type_name").map_err(ApiError::from)?,
                    adults: row.try_get("adults").map_err(ApiError::from)?,
                    children: row.try_get("children").map_err(ApiError::from)?,
                    extra_bed_count: row.try_get("extra_bed_count").map_err(ApiError::from)?,
                    status: row.try_get("status").map_err(ApiError::from)?,
                    payment_status: row.try_get("payment_status").map_err(ApiError::from)?,
                    subtotal: get_decimal(row, "subtotal"),
                    discount_amount: get_decimal(row, "discount_amount"),
                    tax_amount: get_decimal(row, "tax_amount"),
                    tourism_tax_amount: get_decimal(row, "tourism_tax_amount"),
                    total_amount: get_decimal(row, "total_amount"),
                })
            })
            .collect()
    }
}
