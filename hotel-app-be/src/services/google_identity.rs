use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;
use jsonwebtoken::{
    Algorithm, DecodingKey, Validation, decode, decode_header,
    jwk::{AlgorithmParameters, Jwk, JwkSet, KeyAlgorithm, PublicKeyUse},
};
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use validator::ValidateEmail;

const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_JWKS_CACHE_TTL: Duration = Duration::from_secs(3_600);
const GOOGLE_ISSUERS: [&str; 2] = ["accounts.google.com", "https://accounts.google.com"];

/// A verified Google identity claim suitable for guest-account resolution.
#[allow(dead_code)]
#[derive(Clone, PartialEq, Eq)]
pub struct GoogleIdentity {
    pub subject: String,
    pub email: String,
    pub email_verified: bool,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum GoogleAudience {
    Single(String),
    Multiple(Vec<String>),
}

impl GoogleAudience {
    fn contains(&self, expected: &str) -> bool {
        match self {
            Self::Single(audience) => audience == expected,
            Self::Multiple(audiences) => audiences.iter().any(|audience| audience == expected),
        }
    }
}

#[derive(Deserialize)]
struct GoogleClaims {
    #[serde(rename = "iss")]
    issuer: String,
    #[serde(rename = "aud")]
    audience: GoogleAudience,
    #[serde(rename = "exp")]
    expiry: u64,
    #[serde(rename = "sub")]
    subject: String,
    email: String,
    email_verified: bool,
    given_name: Option<String>,
    family_name: Option<String>,
}

struct CachedJwks {
    jwks: JwkSet,
    expires_at: Instant,
}

static GOOGLE_JWKS_CACHE: OnceLock<Mutex<Option<CachedJwks>>> = OnceLock::new();
static GOOGLE_HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

/// Verifies a Google ID token against Google's rotating RSA signing keys before
/// exposing its identity claims to account-resolution code.
#[allow(dead_code)]
pub async fn verify_id_token(
    credential: &str,
    configured_client_id: Option<&str>,
) -> Result<GoogleIdentity, ApiError> {
    let client_id = configured_client_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::ServiceUnavailable("Google sign-in is not configured.".to_string())
        })?;
    let header = decode_header(credential)
        .map_err(|_| ApiError::Unauthorized("Invalid Google credential.".to_string()))?;

    if header.alg != Algorithm::RS256 {
        return Err(ApiError::Unauthorized(
            "Invalid Google credential.".to_string(),
        ));
    }
    let key_id = header
        .kid
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("Invalid Google credential.".to_string()))?;

    let cached = google_jwks(false).await?;
    let claims = if should_refresh_jwks(&cached, key_id) {
        // A newly rotated key is resolved by one forced refresh. A cached key
        // with a bad signature is rejected instead of triggering outbound work.
        let refreshed = google_jwks(true).await?;
        verify_with_jwks(credential, key_id, &refreshed)?
    } else {
        verify_with_jwks(credential, key_id, &cached)?
    };

    validate_claims(&claims, client_id)
}

fn validate_claims(claims: &GoogleClaims, client_id: &str) -> Result<GoogleIdentity, ApiError> {
    let now = jsonwebtoken::get_current_timestamp();
    let email = Sanitizer::sanitize_email(&claims.email);
    let subject = claims.subject.as_str();

    if !GOOGLE_ISSUERS.contains(&claims.issuer.as_str())
        || !claims.audience.contains(client_id)
        || claims.expiry <= now
        || !claims.email_verified
        || email.is_empty()
        || !email.validate_email()
        || subject.trim().is_empty()
        || subject != subject.trim()
        || subject.len() > 255
    {
        return Err(ApiError::Unauthorized(
            "Invalid Google credential.".to_string(),
        ));
    }

    Ok(GoogleIdentity {
        subject: subject.to_string(),
        email,
        email_verified: true,
        given_name: clean_name(claims.given_name.as_deref()),
        family_name: clean_name(claims.family_name.as_deref()),
    })
}

fn clean_name(value: Option<&str>) -> Option<String> {
    value
        .map(Sanitizer::sanitize_guest_name)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(100).collect())
}

fn verify_with_jwks(
    credential: &str,
    key_id: &str,
    jwks: &JwkSet,
) -> Result<GoogleClaims, ApiError> {
    let jwk = google_rsa_signing_key(jwks, key_id)?;
    let key = DecodingKey::from_jwk(jwk)
        .map_err(|_| ApiError::Unauthorized("Invalid Google credential.".to_string()))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = false;
    validation.validate_aud = false;
    validation.set_required_spec_claims::<&str>(&[]);

    decode::<GoogleClaims>(credential, &key, &validation)
        .map(|token| token.claims)
        .map_err(|_| ApiError::Unauthorized("Invalid Google credential.".to_string()))
}

fn google_rsa_signing_key<'a>(jwks: &'a JwkSet, key_id: &str) -> Result<&'a Jwk, ApiError> {
    jwks.find(key_id)
        .filter(|jwk| {
            matches!(jwk.algorithm, AlgorithmParameters::RSA(_))
                && jwk.common.key_algorithm == Some(KeyAlgorithm::RS256)
                && matches!(jwk.common.public_key_use, Some(PublicKeyUse::Signature))
        })
        .ok_or_else(|| ApiError::Unauthorized("Invalid Google credential.".to_string()))
}

fn should_refresh_jwks(jwks: &JwkSet, key_id: &str) -> bool {
    jwks.find(key_id).is_none()
}

async fn google_jwks(force_refresh: bool) -> Result<JwkSet, ApiError> {
    let cache = GOOGLE_JWKS_CACHE.get_or_init(|| Mutex::new(None));
    if !force_refresh
        && let Ok(guard) = cache.lock()
        && let Some(cached) = guard.as_ref()
        && cached.expires_at > Instant::now()
    {
        return Ok(cached.jwks.clone());
    }

    let client = google_http_client()?;
    let response = client
        .get(GOOGLE_JWKS_URL)
        .send()
        .await
        .map_err(|_| {
            ApiError::ServiceUnavailable("Google sign-in is temporarily unavailable.".to_string())
        })?
        .error_for_status()
        .map_err(|_| {
            ApiError::ServiceUnavailable("Google sign-in is temporarily unavailable.".to_string())
        })?;
    let jwks = response.json::<JwkSet>().await.map_err(|_| {
        ApiError::ServiceUnavailable("Google sign-in is temporarily unavailable.".to_string())
    })?;

    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CachedJwks {
            jwks: jwks.clone(),
            expires_at: Instant::now() + GOOGLE_JWKS_CACHE_TTL,
        });
    }

    Ok(jwks)
}

fn google_http_client() -> Result<&'static reqwest::Client, ApiError> {
    GOOGLE_HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|_| "Google HTTP client initialization failed".to_string())
        })
        .as_ref()
        .map_err(|_| {
            ApiError::ServiceUnavailable("Google sign-in is temporarily unavailable.".to_string())
        })
}

/// The required guest-contact fields that still need to be supplied.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileCompletion {
    pub complete: bool,
    pub missing_fields: Vec<&'static str>,
}

#[allow(dead_code)]
impl ProfileCompletion {
    pub fn missing(missing_fields: Vec<&'static str>) -> Self {
        Self {
            complete: false,
            missing_fields,
        }
    }
}

#[allow(dead_code)]
pub fn profile_completion(
    first_name: Option<&str>,
    last_name: Option<&str>,
    phone: Option<&str>,
) -> ProfileCompletion {
    let mut missing_fields = Vec::new();
    if first_name.is_none_or(|value| value.trim().is_empty()) {
        missing_fields.push("first_name");
    }
    if last_name.is_none_or(|value| value.trim().is_empty()) {
        missing_fields.push("last_name");
    }
    if phone.is_none_or(|value| value.trim().is_empty()) {
        missing_fields.push("phone");
    }

    ProfileCompletion {
        complete: missing_fields.is_empty(),
        missing_fields,
    }
}

/// Creates a lowercase username that satisfies the database username constraint.
#[allow(dead_code)]
pub fn google_username(email: &str, subject: &str) -> String {
    let local_part = email.split_once('@').map_or(email, |(local, _)| local);
    let normalized = local_part
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let base = normalized.trim_matches('_');
    let base = if base.is_empty() { "guest" } else { base };
    let suffix = subject
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect::<String>();
    let suffix = suffix
        .chars()
        .rev()
        .take(6)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let suffix = if suffix.is_empty() { "google" } else { &suffix };
    let base_limit = 100 - suffix.len() - 1;

    format!("{}_{}", &base[..base.len().min(base_limit)], suffix)
}

#[cfg(test)]
mod tests {
    use super::{
        GoogleAudience, GoogleClaims, ProfileCompletion, google_username, profile_completion,
        should_refresh_jwks, validate_claims,
    };
    use jsonwebtoken::jwk::JwkSet;
    use serde_json::json;

    const CLIENT_ID: &str = "hotel-client.apps.googleusercontent.com";

    fn future_expiry() -> u64 {
        jsonwebtoken::get_current_timestamp() + 3_600
    }

    fn claims(issuer: &str, audience: &str, expiry: u64, email_verified: bool) -> GoogleClaims {
        GoogleClaims {
            issuer: issuer.to_string(),
            audience: GoogleAudience::Single(audience.to_string()),
            expiry,
            email_verified,
            email: "aisha.rahman@example.com".to_string(),
            subject: "10987654321".to_string(),
            given_name: Some("Aisha".to_string()),
            family_name: Some("Rahman".to_string()),
        }
    }

    #[test]
    fn profile_completion_requires_first_name_last_name_and_phone() {
        assert_eq!(
            profile_completion(Some("Aisha"), Some("Rahman"), None),
            ProfileCompletion::missing(vec!["phone"]),
        );
    }

    #[test]
    fn profile_completion_does_not_require_an_address() {
        assert!(profile_completion(Some("Aisha"), Some("Rahman"), Some("+60123456789")).complete);
    }

    #[test]
    fn google_username_is_lowercase_and_database_safe() {
        assert_eq!(
            google_username("Aisha.Rahman@gmail.com", "10987654321"),
            "aisha_rahman_654321"
        );
    }

    #[test]
    fn rejects_a_google_claim_with_the_wrong_audience() {
        let claims = claims(
            "https://accounts.google.com",
            "other-client",
            future_expiry(),
            true,
        );

        assert!(validate_claims(&claims, CLIENT_ID).is_err());
    }

    #[test]
    fn rejects_a_google_claim_with_the_wrong_issuer() {
        let claims = claims("https://example.com", CLIENT_ID, future_expiry(), true);

        assert!(validate_claims(&claims, CLIENT_ID).is_err());
    }

    #[test]
    fn rejects_an_expired_google_claim() {
        let claims = claims("accounts.google.com", CLIENT_ID, 0, true);

        assert!(validate_claims(&claims, CLIENT_ID).is_err());
    }

    #[test]
    fn rejects_an_unverified_google_email() {
        let claims = claims("accounts.google.com", CLIENT_ID, future_expiry(), false);

        assert!(validate_claims(&claims, CLIENT_ID).is_err());
    }

    #[test]
    fn accepts_google_issuer_subject_and_verified_email() {
        let claims = claims("accounts.google.com", CLIENT_ID, future_expiry(), true);

        assert_eq!(
            validate_claims(&claims, CLIENT_ID).unwrap().subject,
            "10987654321"
        );
    }

    #[test]
    fn does_not_refresh_jwks_when_the_cached_key_rejects_a_signature() {
        let jwks: JwkSet = serde_json::from_value(json!({
            "keys": [{
                "kty": "RSA",
                "kid": "known-key",
                "use": "sig",
                "alg": "RS256",
                "n": "n",
                "e": "AQAB"
            }]
        }))
        .unwrap();

        assert!(!should_refresh_jwks(&jwks, "known-key"));
    }

    #[test]
    fn refreshes_jwks_when_the_cached_key_id_is_unknown() {
        let jwks = JwkSet { keys: Vec::new() };

        assert!(should_refresh_jwks(&jwks, "rotated-key"));
    }
}
