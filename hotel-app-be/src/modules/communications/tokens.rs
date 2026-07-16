//! Stateless HMAC-signed unsubscribe tokens.
//!
//! Format: `base64url(guest_id) + "." + hex(HMAC-SHA256(JWT_SECRET, guest_id))`.
//! Tokens carry no expiry: unsubscribe links in already-delivered email must
//! keep working indefinitely.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::core::error::ApiError;

type HmacSha256 = Hmac<Sha256>;

fn mac_for(payload: &[u8]) -> Result<HmacSha256, ApiError> {
    let secret = crate::core::config::get().jwt_secret.clone();
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| ApiError::Internal("Unsubscribe token key failure".to_string()))?;
    mac.update(payload);
    Ok(mac)
}

pub fn sign_unsubscribe_token(guest_id: i64) -> Result<String, ApiError> {
    let payload = guest_id.to_string();
    let mac = mac_for(payload.as_bytes())?;
    let signature = hex::encode(mac.finalize().into_bytes());
    Ok(format!("{}.{signature}", URL_SAFE_NO_PAD.encode(&payload)))
}

pub fn verify_unsubscribe_token(token: &str) -> Option<i64> {
    let (payload_b64, signature_hex) = token.split_once('.')?;
    let payload = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let signature = hex::decode(signature_hex).ok()?;
    let mac = mac_for(&payload).ok()?;
    mac.verify_slice(&signature).ok()?;
    String::from_utf8(payload).ok()?.parse().ok()
}
