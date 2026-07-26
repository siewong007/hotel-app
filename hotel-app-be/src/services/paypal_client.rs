//! Minimal PayPal REST client, hand-rolled over `reqwest` (no official Rust
//! SDK exists). Scaffolded against PayPal's real Orders v2 API shape and
//! defaulting to the sandbox host, so it goes live purely by supplying real
//! merchant credentials via env (`PAYPAL_ENABLED`, `PAYPAL_CLIENT_ID`,
//! `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`).
//!
//! When the integration is not fully configured, every entry point returns a
//! `ServiceUnavailable` (HTTP 503) rather than fabricating a working gateway.
//! Capture is synchronous — the server calls PayPal directly, so a client
//! cannot forge a captured order. The async webhook path complements it:
//! `/api/webhooks/paypal` (handlers/webhooks.rs) receives PayPal's event
//! deliveries, authenticates them via `verify_webhook_signature` below
//! (requires `PAYPAL_WEBHOOK_ID`), and reconciles captures our synchronous
//! response never reached — see `services::payments::apply_paypal_webhook_event`.

use crate::core::config::{self, PaypalConfig};
use crate::core::error::ApiError;
use base64::Engine;
use rust_decimal::Decimal;
use serde_json::Value;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Result of capturing a PayPal order.
pub struct PaypalCaptureOutcome {
    /// PayPal order status, e.g. `"COMPLETED"`.
    pub status: String,
    /// The `custom_id` echoed back by PayPal (`"<booking_id>:<payment_id>"`),
    /// when present — used to cross-check the capture against our record.
    pub custom_id: Option<String>,
    /// The captured amount value (`amount.value`) echoed back by PayPal, when
    /// present — used to verify the money actually moved matches our record.
    pub captured_amount: Option<String>,
    /// The captured currency code (`amount.currency_code`) echoed back by
    /// PayPal, when present.
    pub captured_currency: Option<String>,
}

/// Return the PayPal config only when the integration is fully configured,
/// otherwise a 503. All public entry points gate on this.
fn require_configured() -> Result<&'static PaypalConfig, ApiError> {
    let cfg = &config::get().paypal;
    if cfg.is_configured() {
        Ok(cfg)
    } else {
        Err(ApiError::ServiceUnavailable(
            "PayPal payments are not configured.".to_string(),
        ))
    }
}

/// True when PayPal is fully configured (used by the public payment-config
/// endpoint without erroring).
pub fn is_enabled() -> bool {
    config::get().paypal.is_configured()
}

fn http_client() -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| ApiError::Internal(format!("Failed to build HTTP client: {e}")))
}

/// Process-wide OAuth token cache. PayPal `client_credentials` tokens live for
/// hours; re-fetching one per API call doubles latency and, on the
/// unauthenticated webhook endpoint, hands strangers an outbound-call
/// amplifier. Credentials are fixed for the process lifetime (env-derived
/// config), so a single slot with an expiry is enough.
struct CachedToken {
    token: String,
    expires_at: Instant,
}

static TOKEN_CACHE: OnceLock<Mutex<Option<CachedToken>>> = OnceLock::new();

/// Fetch an OAuth2 access token via `client_credentials` (Basic auth),
/// reusing the cached token until shortly before it expires.
async fn get_access_token(
    cfg: &PaypalConfig,
    client: &reqwest::Client,
) -> Result<String, ApiError> {
    let cache = TOKEN_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock()
        && let Some(cached) = guard.as_ref()
        && cached.expires_at > Instant::now()
    {
        return Ok(cached.token.clone());
    }

    let client_id = cfg.client_id.as_deref().unwrap_or_default();
    let client_secret = cfg.client_secret.as_deref().unwrap_or_default();
    let basic =
        base64::engine::general_purpose::STANDARD.encode(format!("{client_id}:{client_secret}"));

    let response = client
        .post(format!("{}/v1/oauth2/token", cfg.api_base))
        .header("Authorization", format!("Basic {basic}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("grant_type=client_credentials")
        .send()
        .await
        .map_err(|e| {
            log::error!("PayPal token request failed: {e}");
            ApiError::ServiceUnavailable("PayPal is unreachable.".to_string())
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log::error!("PayPal OAuth failed ({status}): {body}");
        return Err(ApiError::ServiceUnavailable(
            "PayPal authentication failed.".to_string(),
        ));
    }

    let json: Value = response.json().await.map_err(|e| {
        log::error!("PayPal token decode failed: {e}");
        ApiError::ServiceUnavailable("PayPal returned an unreadable response.".to_string())
    })?;

    let token = json
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            ApiError::ServiceUnavailable("PayPal token response missing access_token.".to_string())
        })?;

    // Cache with a two-minute safety margin; skip caching implausibly short
    // lifetimes. A poisoned lock just means every call fetches fresh.
    let expires_in = json.get("expires_in").and_then(Value::as_u64).unwrap_or(0);
    if expires_in > 300
        && let Ok(mut guard) = cache.lock()
    {
        *guard = Some(CachedToken {
            token: token.clone(),
            expires_at: Instant::now() + Duration::from_secs(expires_in - 120),
        });
    }

    Ok(token)
}

/// Create an Orders v2 order (`intent: CAPTURE`) and return the PayPal order id.
/// `custom_id` links the order back to our booking/payment as
/// `"<booking_id>:<payment_id>"`.
pub async fn create_order(
    amount: Decimal,
    currency: &str,
    custom_id: &str,
) -> Result<String, ApiError> {
    let cfg = require_configured()?;
    let client = http_client()?;
    let token = get_access_token(cfg, &client).await?;

    // PayPal expects the amount as a string with exactly 2 decimal places for
    // currencies like USD/MYR.
    let amount_str = format!("{:.2}", amount);
    let payload = serde_json::json!({
        "intent": "CAPTURE",
        "purchase_units": [{
            "custom_id": custom_id,
            "amount": {
                "currency_code": currency,
                "value": amount_str,
            }
        }]
    });

    let response = client
        .post(format!("{}/v2/checkout/orders", cfg.api_base))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| ApiError::ServiceUnavailable(format!("PayPal create-order failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log::error!("PayPal create-order failed ({status}): {body}");
        return Err(ApiError::ServiceUnavailable(
            "PayPal could not create the order.".to_string(),
        ));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| ApiError::ServiceUnavailable(format!("PayPal order decode failed: {e}")))?;

    json.get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            ApiError::ServiceUnavailable("PayPal order response missing id.".to_string())
        })
}

/// Capture a previously created order. Returns the order status and echoed
/// `custom_id`. A `"COMPLETED"` status means the money moved.
pub async fn capture_order(order_id: &str) -> Result<PaypalCaptureOutcome, ApiError> {
    let cfg = require_configured()?;
    let client = http_client()?;
    let token = get_access_token(cfg, &client).await?;

    let response = client
        .post(format!(
            "{}/v2/checkout/orders/{}/capture",
            cfg.api_base, order_id
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        // PayPal requires a body (even empty) on capture.
        .body("{}")
        .send()
        .await
        .map_err(|e| ApiError::ServiceUnavailable(format!("PayPal capture failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log::error!("PayPal capture failed ({status}): {body}");
        return Err(ApiError::ServiceUnavailable(
            "PayPal could not capture the order.".to_string(),
        ));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| ApiError::ServiceUnavailable(format!("PayPal capture decode failed: {e}")))?;

    let status = json
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("UNKNOWN")
        .to_string();

    // The capture object under purchase_units[0].payments.captures[0] carries
    // the authoritative custom_id and the amount that actually moved.
    let capture = json
        .get("purchase_units")
        .and_then(Value::as_array)
        .and_then(|units| units.first())
        .and_then(|unit| unit.get("payments"))
        .and_then(|p| p.get("captures"))
        .and_then(Value::as_array)
        .and_then(|c| c.first());

    let custom_id = capture
        .and_then(|cap| cap.get("custom_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            json.get("purchase_units")
                .and_then(Value::as_array)
                .and_then(|units| units.first())
                .and_then(|unit| unit.get("custom_id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let captured_amount = capture
        .and_then(|cap| cap.get("amount"))
        .and_then(|amount| amount.get("value"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let captured_currency = capture
        .and_then(|cap| cap.get("amount"))
        .and_then(|amount| amount.get("currency_code"))
        .and_then(Value::as_str)
        .map(str::to_string);

    Ok(PaypalCaptureOutcome {
        status,
        custom_id,
        captured_amount,
        captured_currency,
    })
}

/// The five headers PayPal attaches to every webhook delivery; all are
/// required inputs to the verify-webhook-signature call.
pub struct PaypalWebhookHeaders {
    pub transmission_id: String,
    pub transmission_time: String,
    pub transmission_sig: String,
    pub cert_url: String,
    pub auth_algo: String,
}

/// Ask PayPal to verify a webhook delivery's signature
/// (`POST /v1/notifications/verify-webhook-signature`). Returns `Ok(true)`
/// only when PayPal answers `verification_status: "SUCCESS"`.
///
/// Verification is delegated to PayPal's API rather than checking the
/// certificate locally, so the attacker-controllable `cert_url` header is
/// never fetched by this server. `raw_event_body` must be the body exactly as
/// PayPal delivered it: re-serializing parsed JSON can reorder keys and break
/// the signature, so the JSON value is spliced in unmodified via `RawValue`
/// (surrounding whitespace is not preserved, which PayPal tolerates).
pub async fn verify_webhook_signature(
    headers: &PaypalWebhookHeaders,
    raw_event_body: &str,
) -> Result<bool, ApiError> {
    let cfg = require_configured()?;
    let webhook_id = cfg
        .webhook_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            ApiError::ServiceUnavailable(
                "PayPal webhook verification is not configured.".to_string(),
            )
        })?;

    let webhook_event: &serde_json::value::RawValue = serde_json::from_str(raw_event_body)
        .map_err(|_| ApiError::BadRequest("Webhook body is not valid JSON.".to_string()))?;

    #[derive(serde::Serialize)]
    struct VerifyRequest<'a> {
        auth_algo: &'a str,
        cert_url: &'a str,
        transmission_id: &'a str,
        transmission_sig: &'a str,
        transmission_time: &'a str,
        webhook_id: &'a str,
        webhook_event: &'a serde_json::value::RawValue,
    }

    let client = http_client()?;
    let token = get_access_token(cfg, &client).await?;

    let response = client
        .post(format!(
            "{}/v1/notifications/verify-webhook-signature",
            cfg.api_base
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&VerifyRequest {
            auth_algo: &headers.auth_algo,
            cert_url: &headers.cert_url,
            transmission_id: &headers.transmission_id,
            transmission_sig: &headers.transmission_sig,
            transmission_time: &headers.transmission_time,
            webhook_id,
            webhook_event,
        })
        .send()
        .await
        .map_err(|e| {
            log::error!("PayPal verify request failed: {e}");
            ApiError::ServiceUnavailable(
                "PayPal could not verify the webhook signature.".to_string(),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log::error!("PayPal webhook verify failed ({status}): {body}");
        return Err(ApiError::ServiceUnavailable(
            "PayPal could not verify the webhook signature.".to_string(),
        ));
    }

    let json: Value = response.json().await.map_err(|e| {
        log::error!("PayPal verify decode failed: {e}");
        ApiError::ServiceUnavailable("PayPal could not verify the webhook signature.".to_string())
    })?;

    Ok(json.get("verification_status").and_then(Value::as_str) == Some("SUCCESS"))
}
