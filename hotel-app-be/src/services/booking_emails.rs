//! Guest-facing booking lifecycle emails queued from staff actions.
//!
//! Two triggers live here:
//!
//! * a booking becoming `confirmed` (staff create, or a staff edit that moves
//!   the status into `confirmed`), and
//! * a payment being confirmed for a booking (staff approving a pending
//!   bank-transfer claim).
//!
//! Both reuse the `booking_confirmation` kind/topic: the schema's
//! `email_deliveries_kind_check` / `email_deliveries_topic_check` allow that
//! pair with `campaign_id IS NULL` (see `database/postgres/patches/0008`), so
//! neither trigger needs a schema change. Each carries a stable idempotency
//! key, so a repeated staff action queues exactly one email.
//!
//! Every sender is a no-op when the guest has no email on file — that is the
//! "(if available)" contract, not an error.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::communications::repository::{CommunicationsRepository, DeliveryValues};
use crate::modules::communications::validation::html_escape;

/// Booking + guest fields shared by both emails.
#[derive(sqlx::FromRow)]
struct BookingEmailSource {
    guest_id: i64,
    guest_name: Option<String>,
    guest_email: Option<String>,
    booking_number: Option<String>,
    check_in_date: chrono::NaiveDate,
    check_out_date: chrono::NaiveDate,
    total_amount: rust_decimal::Decimal,
    currency: Option<String>,
    room_number: Option<String>,
    room_type: Option<String>,
}

impl BookingEmailSource {
    fn guest_name(&self) -> &str {
        self.guest_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Guest")
    }

    fn booking_label(&self) -> &str {
        self.booking_number
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("your booking")
    }

    fn nights(&self) -> i64 {
        (self.check_out_date - self.check_in_date).num_days().max(0)
    }

    /// `"MYR 250.00"` — the booking's own currency, falling back to a bare
    /// amount when the column is null.
    fn money(&self, amount: rust_decimal::Decimal) -> String {
        match self
            .currency
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(currency) => format!("{} {}", currency, amount.round_dp(2)),
            None => amount.round_dp(2).to_string(),
        }
    }

    fn stay_block_html(&self) -> String {
        format!(
            "<p><strong>Booking:</strong> {}<br>\
             <strong>Room:</strong> {} ({})<br>\
             <strong>Stay:</strong> {} to {} · {} night(s)<br>\
             <strong>Total:</strong> {}</p>",
            html_escape(self.booking_label()),
            html_escape(self.room_number.as_deref().unwrap_or("-")),
            html_escape(self.room_type.as_deref().unwrap_or("-")),
            self.check_in_date,
            self.check_out_date,
            self.nights(),
            self.money(self.total_amount),
        )
    }

    fn stay_block_text(&self) -> String {
        format!(
            "Booking: {}\nRoom: {} ({})\nStay: {} to {} ({} night(s))\nTotal: {}",
            self.booking_label(),
            self.room_number.as_deref().unwrap_or("-"),
            self.room_type.as_deref().unwrap_or("-"),
            self.check_in_date,
            self.check_out_date,
            self.nights(),
            self.money(self.total_amount),
        )
    }
}

/// Load the booking's guest-mail context. Returns `None` when the booking is
/// gone or the guest has no usable email address, so callers can treat both as
/// "nothing to send".
async fn load_source(
    pool: &DbPool,
    booking_id: i64,
) -> Result<Option<(BookingEmailSource, String)>, ApiError> {
    let source = sqlx::query_as::<_, BookingEmailSource>(
        r#"
        SELECT g.id AS guest_id,
               g.full_name AS guest_name,
               g.email AS guest_email,
               b.booking_number,
               b.check_in_date,
               b.check_out_date,
               b.total_amount,
               b.currency,
               r.room_number,
               rt.name AS room_type
        FROM bookings b
        JOIN guests g ON g.id = b.guest_id
        LEFT JOIN rooms r ON r.id = b.room_id
        LEFT JOIN room_types rt ON rt.id = r.room_type_id
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;

    let Some(source) = source else {
        return Ok(None);
    };
    let Some(recipient) = source
        .guest_email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return Ok(None);
    };

    Ok(Some((source, recipient)))
}

/// Queue one `email_deliveries` row in its own transaction. Callers run after
/// their own work has committed, so a mail failure can never roll back the
/// booking or payment change it describes.
async fn queue(
    pool: &DbPool,
    guest_id: i64,
    recipient: &str,
    subject: &str,
    body_html: &str,
    body_text: &str,
    idempotency_key: &str,
) -> Result<(), ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id,
            topic: "booking_confirmation",
            recipient_email: recipient,
            subject,
            body_html,
            body_text: Some(body_text),
            voucher_id: None,
            idempotency_key,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)
}

/// Guest-facing confirmation for a booking that has just become `confirmed`.
pub async fn queue_booking_confirmation_email(
    pool: &DbPool,
    booking_id: i64,
) -> Result<(), ApiError> {
    let Some((source, recipient)) = load_source(pool, booking_id).await? else {
        return Ok(());
    };

    let subject = format!("Booking confirmed {}", source.booking_label());
    let body_html = format!(
        "<p>Dear {},</p>\
         <p>Your reservation <strong>{}</strong> is confirmed. We look forward to welcoming you.</p>\
         {}\
         <p>You can review this booking any time in your guest portal.</p>",
        html_escape(source.guest_name()),
        html_escape(source.booking_label()),
        source.stay_block_html(),
    );
    let body_text = format!(
        "Dear {},\nYour reservation {} is confirmed. We look forward to welcoming you.\n{}\nYou can review this booking any time in your guest portal.",
        source.guest_name(),
        source.booking_label(),
        source.stay_block_text(),
    );

    queue(
        pool,
        source.guest_id,
        &recipient,
        &subject,
        &body_html,
        &body_text,
        &format!("booking-confirmed:{booking_id}"),
    )
    .await
}

/// Best-effort wrapper: a notification failure must never surface as a failed
/// booking confirmation that has already been committed.
pub async fn try_queue_booking_confirmation_email(pool: &DbPool, booking_id: i64) {
    if let Err(error) = queue_booking_confirmation_email(pool, booking_id).await {
        log::error!("Failed to queue booking confirmation email for booking {booking_id}: {error}");
    }
}

/// Guest-facing notification that a payment has been confirmed against a
/// booking, with the resulting paid/outstanding position.
pub async fn queue_payment_confirmation_email(
    pool: &DbPool,
    booking_id: i64,
    payment_id: i64,
) -> Result<(), ApiError> {
    let Some((source, recipient)) = load_source(pool, booking_id).await? else {
        return Ok(());
    };

    #[derive(sqlx::FromRow)]
    struct PaymentRow {
        amount: rust_decimal::Decimal,
        payment_method: String,
    }

    let Some(payment) = sqlx::query_as::<_, PaymentRow>(
        "SELECT amount, payment_method FROM payments WHERE id = $1 AND booking_id = $2",
    )
    .bind(payment_id)
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?
    else {
        return Ok(());
    };

    // Running position across every non-refund completed payment, so the guest
    // sees the balance that remains rather than only this one instalment.
    let paid = sqlx::query_scalar::<_, rust_decimal::Decimal>(
        r#"
        SELECT COALESCE(SUM(amount) FILTER (
            WHERE status = 'completed'
              AND COALESCE(payment_type, 'booking') != 'refund'
        ), 0)
        FROM payments
        WHERE booking_id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .map_err(ApiError::from)?;

    let balance = (source.total_amount - paid).max(rust_decimal::Decimal::ZERO);
    let method = payment.payment_method.replace('_', " ");
    let closing = if balance.is_zero() {
        "Your booking is fully paid and confirmed. There is nothing left to settle."
    } else {
        "Your booking is confirmed. The remaining balance is payable at the hotel."
    };

    let subject = format!("Payment confirmed for booking {}", source.booking_label());
    let body_html = format!(
        "<p>Dear {},</p>\
         <p>We have confirmed your payment of <strong>{}</strong> ({}) for booking <strong>{}</strong>.</p>\
         {}\
         <p><strong>Payments received:</strong> {}<br>\
         <strong>Balance:</strong> {}</p>\
         <p>{}</p>",
        html_escape(source.guest_name()),
        html_escape(&source.money(payment.amount)),
        html_escape(&method),
        html_escape(source.booking_label()),
        source.stay_block_html(),
        source.money(paid),
        source.money(balance),
        closing,
    );
    let body_text = format!(
        "Dear {},\nWe have confirmed your payment of {} ({}) for booking {}.\n{}\nPayments received: {}\nBalance: {}\n{}",
        source.guest_name(),
        source.money(payment.amount),
        method,
        source.booking_label(),
        source.stay_block_text(),
        source.money(paid),
        source.money(balance),
        closing,
    );

    queue(
        pool,
        source.guest_id,
        &recipient,
        &subject,
        &body_html,
        &body_text,
        &format!("payment-confirmed:{payment_id}"),
    )
    .await
}

/// Best-effort wrapper: a notification failure must never undo a staff payment
/// approval that has already been committed.
pub async fn try_queue_payment_confirmation_email(
    pool: &DbPool,
    booking_id: i64,
    payment_id: i64,
) {
    if let Err(error) = queue_payment_confirmation_email(pool, booking_id, payment_id).await {
        log::error!(
            "Failed to queue payment confirmation email for payment {payment_id} (booking {booking_id}): {error}"
        );
    }
}
