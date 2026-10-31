//! Combined receipt for a multi-room booking group.
//!
//! Each room booking keeps its own invoice (numbering, ledgers and refunds stay
//! per booking); this endpoint only gathers those invoices into one document
//! with group totals, for a group that was paid together.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct GroupReceiptRow {
    pub booking_id: i64,
    pub booking_number: Option<String>,
    pub invoice_number: String,
    pub room_number: Option<String>,
    pub room_type: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights: i32,
    pub room_total: Decimal,
    pub tourism_tax_amount: Decimal,
    pub extra_bed_count: i32,
    pub extra_bed_charge: Decimal,
    pub total: Decimal,
}

#[derive(sqlx::FromRow)]
struct GroupHeader {
    group_number: String,
    guest_id: i64,
    guest_name: Option<String>,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    currency: String,
    payment_status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupReceipt {
    pub booking_group_id: i64,
    pub group_number: String,
    pub guest_id: i64,
    pub guest_name: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub currency: String,
    pub payment_status: String,
    pub group_payment_ref: Option<String>,
    pub rooms: Vec<GroupReceiptRow>,
    pub room_total: Decimal,
    pub tourism_tax_amount: Decimal,
    pub extra_bed_charge: Decimal,
    pub grand_total: Decimal,
}

/// Build (and, where missing, issue the per-room invoices for) a group receipt.
pub async fn group_receipt(
    pool: &DbPool,
    user_id: i64,
    group_id: i64,
) -> Result<GroupReceipt, ApiError> {
    let group: Option<GroupHeader> = sqlx::query_as(
        "SELECT bg.group_number, bg.guest_id, g.nick_name AS guest_name, bg.check_in_date, \
         bg.check_out_date, bg.currency, bg.payment_status \
         FROM booking_groups bg LEFT JOIN guests g ON g.id = bg.guest_id \
         WHERE bg.id = $1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;
    let Some(group) = group else {
        return Err(ApiError::NotFound("Booking group not found".to_string()));
    };

    let booking_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM bookings WHERE booking_group_id = $1 \
         AND COALESCE(status, '') <> 'voided' ORDER BY id",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)?;
    if booking_ids.is_empty() {
        return Err(ApiError::NotFound(
            "This booking group has no active room bookings".to_string(),
        ));
    }

    let mut rooms = Vec::with_capacity(booking_ids.len());
    for booking_id in booking_ids {
        let invoice_number =
            super::service::ensure_invoice_for_booking(pool, booking_id, user_id).await?;
        let row: GroupReceiptRow = sqlx::query_as(
            "SELECT b.id AS booking_id, b.booking_number, $2::text AS invoice_number, \
             r.room_number, rt.name AS room_type, b.check_in_date, b.check_out_date, \
             (b.check_out_date - b.check_in_date)::int AS nights, \
             b.total_amount AS room_total, \
             COALESCE(b.tourism_tax_amount, 0) AS tourism_tax_amount, \
             COALESCE(b.extra_bed_count, 0)::int AS extra_bed_count, \
             COALESCE(b.extra_bed_charge, 0) AS extra_bed_charge, \
             b.total_amount + COALESCE(b.tourism_tax_amount, 0) \
               + COALESCE(b.extra_bed_charge, 0) AS total \
             FROM bookings b \
             LEFT JOIN rooms r ON r.id = b.room_id \
             LEFT JOIN room_types rt ON rt.id = r.room_type_id \
             WHERE b.id = $1",
        )
        .bind(booking_id)
        .bind(&invoice_number)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        rooms.push(row);
    }

    let group_payment_ref: Option<String> = sqlx::query_scalar(
        "SELECT p.metadata->>'group_payment_ref' FROM payments p \
         JOIN bookings b ON b.id = p.booking_id \
         WHERE b.booking_group_id = $1 AND p.metadata ? 'group_payment_ref' \
         ORDER BY (p.status = 'completed') DESC, p.id DESC LIMIT 1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?
    .flatten();

    let sum = |f: fn(&GroupReceiptRow) -> Decimal| rooms.iter().map(f).sum::<Decimal>();
    Ok(GroupReceipt {
        booking_group_id: group_id,
        group_number: group.group_number,
        guest_id: group.guest_id,
        guest_name: group.guest_name,
        check_in_date: group.check_in_date,
        check_out_date: group.check_out_date,
        currency: group.currency,
        payment_status: group.payment_status,
        group_payment_ref,
        room_total: sum(|r| r.room_total),
        tourism_tax_amount: sum(|r| r.tourism_tax_amount),
        extra_bed_charge: sum(|r| r.extra_bed_charge),
        grand_total: sum(|r| r.total),
        rooms,
    })
}
