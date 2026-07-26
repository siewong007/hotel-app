//! Inbound webhook receivers for external services.
//!
//! These endpoints are deliberately unauthenticated: the caller is a payment
//! provider, not a logged-in user. Authenticity comes from cryptographic
//! verification of each delivery (PayPal's verify-webhook-signature API), and
//! every mutation stays idempotent because providers redeliver events.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::services::audit::AuditLog;
use crate::services::payments::{PaypalWebhookEvent, PaypalWebhookKind};
use crate::services::paypal_client::{self, PaypalWebhookHeaders};
use axum::Json;
use axum::http::HeaderMap;
use serde_json::Value;
use std::net::IpAddr;
use crate::models::AuditEvent;

/// POST /api/webhooks/paypal — receive one PayPal webhook delivery.
///
/// Verified events always answer 200 regardless of how they were applied:
/// PayPal redelivers on non-2xx, and redelivery cannot fix a business-state
/// conflict — the audit log carries those. Non-2xx is reserved for deliveries
/// that should be retried (infra failures → 5xx) or were never valid
/// (malformed → 400, unverifiable → 403).
pub async fn paypal_webhook(
    pool: &DbPool,
    client_ip: IpAddr,
    headers: &HeaderMap,
    body: &str,
) -> Result<Json<Value>, ApiError> {
    if !paypal_client::is_enabled() {
        return Err(ApiError::ServiceUnavailable(
            "PayPal integration is not configured.".to_string(),
        ));
    }

    let paypal_headers = extract_paypal_headers(headers)?;

    // Cheap shape checks before the network verification roundtrip.
    let event: Value = serde_json::from_str(body)
        .map_err(|_| ApiError::BadRequest("Webhook body is not valid JSON.".to_string()))?;
    // Bounded copies: until the signature is verified these strings are
    // attacker-controlled, and they end up in audit rows even on rejection.
    let event_type: String = event
        .get("event_type")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Webhook event has no event_type.".to_string()))?
        .chars()
        .take(128)
        .collect();
    let event_id: String = event
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .take(128)
        .collect();

    if !paypal_client::verify_webhook_signature(&paypal_headers, body).await? {
        // Not yet authenticated, so no durable audit row — an attacker could
        // otherwise grow audit_logs at the rate limit. Server logs carry the
        // trace; PayPal's dashboard shows failed deliveries on their side.
        log::warn!(
            "Rejected PayPal webhook from {client_ip}: signature verification failed \
             (event_id={event_id}, event_type={event_type})"
        );
        return Err(ApiError::Forbidden(
            "Webhook signature verification failed.".to_string(),
        ));
    }

    let kind = match event_type.as_str() {
        "PAYMENT.CAPTURE.COMPLETED" => PaypalWebhookKind::CaptureCompleted,
        "PAYMENT.CAPTURE.DENIED" => PaypalWebhookKind::CaptureDenied,
        _ => {
            // Verified but not a type this system acts on (refunds, disputes,
            // order lifecycle…): acknowledge so PayPal stops redelivering, and
            // keep the provenance for staff.
            AuditLog::log_event(
                pool,
                AuditEvent {
                    user_id: None,
                    action: "paypal_webhook_ignored",
                    resource_type: "payment",
                    resource_id: None,
                    details: Some(serde_json::json!({
                        "source": "paypal_webhook",
                        "event_id": event_id,
                        "event_type": event_type,
                        "reason": "Event type not handled.",
                    })),
                    ip_address: Some(client_ip.to_string()),
                    user_agent: None,
                },
            )
            .await?;
            return Ok(Json(serde_json::json!({ "received": true })));
        }
    };

    let resource = event.get("resource").cloned().unwrap_or(Value::Null);
    let custom_id = resource
        .get("custom_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some((booking_id, payment_id)) = parse_custom_id(custom_id) else {
        AuditLog::log_event(
            pool,
            AuditEvent {
                user_id: None,
                action: "paypal_webhook_ignored",
                resource_type: "payment",
                resource_id: None,
                details: Some(serde_json::json!({
                    "source": "paypal_webhook",
                    "event_id": event_id,
                    "event_type": event_type,
                    "reason": "resource.custom_id is missing or not \"<booking_id>:<payment_id>\".",
                })),
                ip_address: Some(client_ip.to_string()),
                user_agent: None,
            },
        )
        .await?;
        return Ok(Json(serde_json::json!({ "received": true })));
    };

    let webhook_event = PaypalWebhookEvent {
        kind,
        event_id,
        capture_id: resource
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string),
        booking_id,
        payment_id,
        captured_amount: resource
            .get("amount")
            .and_then(|amount| amount.get("value"))
            .and_then(Value::as_str)
            .map(str::to_string),
        captured_currency: resource
            .get("amount")
            .and_then(|amount| amount.get("currency_code"))
            .and_then(Value::as_str)
            .map(str::to_string),
        client_ip: Some(client_ip.to_string()),
    };

    let outcome =
        crate::services::payments::apply_paypal_webhook_event(pool, &webhook_event).await?;
    Ok(Json(
        serde_json::json!({ "received": true, "outcome": outcome.as_str() }),
    ))
}

/// Collect the five verification headers PayPal sends with every delivery.
/// A request missing any of them cannot be verified and is rejected before
/// spending an upstream API call.
fn extract_paypal_headers(headers: &HeaderMap) -> Result<PaypalWebhookHeaders, ApiError> {
    Ok(PaypalWebhookHeaders {
        transmission_id: required_header(headers, "paypal-transmission-id")?,
        transmission_time: required_header(headers, "paypal-transmission-time")?,
        transmission_sig: required_header(headers, "paypal-transmission-sig")?,
        cert_url: required_header(headers, "paypal-cert-url")?,
        auth_algo: required_header(headers, "paypal-auth-algo")?,
    })
}

fn required_header(headers: &HeaderMap, name: &str) -> Result<String, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ApiError::BadRequest(format!("Missing webhook header {name}.")))
}

/// Parse the `custom_id` this system sets on every PayPal order:
/// `"<booking_id>:<payment_id>"`.
fn parse_custom_id(custom_id: &str) -> Option<(i64, i64)> {
    let (booking, payment) = custom_id.split_once(':')?;
    Some((booking.trim().parse().ok()?, payment.trim().parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn parse_custom_id_accepts_the_shape_create_order_writes() {
        assert_eq!(parse_custom_id("42:1007"), Some((42, 1007)));
        assert_eq!(parse_custom_id(" 42 : 1007 "), Some((42, 1007)));
    }

    #[test]
    fn parse_custom_id_rejects_everything_else() {
        assert_eq!(parse_custom_id(""), None);
        assert_eq!(parse_custom_id("42"), None);
        assert_eq!(parse_custom_id("42:"), None);
        assert_eq!(parse_custom_id(":1007"), None);
        assert_eq!(parse_custom_id("abc:def"), None);
        assert_eq!(parse_custom_id("42:10x7"), None);
    }

    #[test]
    fn required_header_trims_and_rejects_blank() {
        let mut headers = HeaderMap::new();
        headers.insert("paypal-cert-url", HeaderValue::from_static("  https://api.paypal.com/cert  "));
        assert_eq!(
            required_header(&headers, "paypal-cert-url").unwrap(),
            "https://api.paypal.com/cert"
        );
        headers.insert("paypal-auth-algo", HeaderValue::from_static("   "));
        assert!(required_header(&headers, "paypal-auth-algo").is_err());
        assert!(required_header(&headers, "paypal-transmission-id").is_err());
    }
}
