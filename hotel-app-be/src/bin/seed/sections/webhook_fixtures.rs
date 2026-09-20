//! Gateway-replay fixtures. There is no webhook/outbox/event-store table —
//! PayPal webhooks reconcile a `payments` row in place (custom_id carries
//! "<booking_id>:<payment_id>", the order id lives in
//! `gateway_payment_intent_id`, and outcomes are appended to audit_logs by
//! apply_paypal_webhook_event). These pending PayPal payments are the rows a
//! replayed PAYMENT.CAPTURE.COMPLETED / .DENIED event would settle or flag:
//!
//!   * 804130 on booking 802112 — pending_payment hold; a COMPLETED event with
//!     custom_id "802112:804130" settles it, a second delivery reports
//!     AlreadyApplied (idempotency check, no extra rows needed)
//!   * 804131 on booking 802131 — the aging hold; same replay shape
//!   * 804132 on booking 802201 — anonymous-booking hold (anonymous module)
//!
//! Order ids are deterministic dev fixtures — they were never real PayPal ids.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
INSERT INTO public.payments (
    id, booking_id, amount, currency, payment_method, payment_type,
    payment_gateway, gateway_payment_intent_id, status, notes,
    created_by, created_at, idempotency_key
)
OVERRIDING SYSTEM VALUE VALUES
    (804130, 802112, 291.60, 'USD', 'paypal', 'booking',
        'paypal', 'PAYID-STGORDER0000001', 'pending', 'PayPal order created — awaiting capture webhook',
        800006, (SELECT today-4 FROM staging_ref)::timestamptz, 'stg-pp-order-130'),
    (804131, 802131, 194.40, 'USD', 'paypal', 'booking',
        'paypal', 'PAYID-STGORDER0000002', 'processing', 'PayPal capture in flight — replay CAPTURE.COMPLETED to settle',
        800006, (SELECT today-1 FROM staging_ref)::timestamptz, 'stg-pp-order-131'),
    (804132, 802201, 194.40, 'USD', 'paypal', 'booking',
        'paypal', 'PAYID-STGORDER0000003', 'pending', 'Anonymous-booking PayPal order awaiting capture',
        800006, CURRENT_TIMESTAMP - interval '3 hours', 'stg-pp-order-132');
"#;
