use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;
use jsonwebtoken::{
    Algorithm, DecodingKey, Validation, decode, decode_header,
    jwk::{AlgorithmParameters, Jwk, JwkSet, KeyAlgorithm, PublicKeyUse},
};
use serde::Deserialize;
use std::time::{Duration, Instant};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::{Mutex, OnceLock},
};
use validator::ValidateEmail;

const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_JWKS_CACHE_TTL: Duration = Duration::from_secs(3_600);
/// Minimum spacing between forced JWKS refreshes triggered by an unknown
/// `kid`. This leaves a bounded path for legitimate key rotation while
/// stopping junk credentials from becoming an outbound-request amplifier.
const GOOGLE_JWKS_UNKNOWN_KID_COOLDOWN: Duration = Duration::from_secs(60);
const GOOGLE_ISSUERS: [&str; 2] = ["accounts.google.com", "https://accounts.google.com"];

/// A verified Google identity claim suitable for guest-account resolution.
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
    refresh_state: JwksRefreshState,
}

/// State shared by one cached JWKS generation. Reservation happens under the
/// cache mutex before an HTTP request starts, so concurrent unknown-key
/// requests cannot all fetch at once.
#[derive(Clone, Copy)]
struct JwksRefreshState {
    generation: u64,
    refresh_in_flight_generation: Option<u64>,
    cooldown_until: Instant,
}

impl JwksRefreshState {
    fn new(generation: u64, now: Instant) -> Self {
        Self {
            generation,
            refresh_in_flight_generation: None,
            cooldown_until: now,
        }
    }

    fn advance_generation(&mut self, now: Instant) {
        self.generation = self.generation.saturating_add(1);
        self.refresh_in_flight_generation = None;
        // Keep an outstanding cooldown when a regular cache refresh races an
        // unknown-key request. It must not reopen the forced-refresh gate.
        self.cooldown_until = self.cooldown_until.max(now);
    }

    fn complete_unknown_kid_refresh(&mut self) {
        self.refresh_in_flight_generation = None;
    }
}

static GOOGLE_JWKS_CACHE: OnceLock<Mutex<Option<CachedJwks>>> = OnceLock::new();
static GOOGLE_HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

/// Verifies a Google ID token against Google's rotating RSA signing keys before
/// exposing its identity claims to account-resolution code.
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

    let cached = google_jwks().await?;
    let jwks = if should_refresh_jwks(&cached, key_id) {
        refresh_jwks_for_unknown_kid(key_id).await?
    } else {
        cached
    };

    verify_token_with_jwks(credential, &jwks, client_id)
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

fn reserve_unknown_kid_refresh(
    jwks: &JwkSet,
    key_id: &str,
    state: &mut JwksRefreshState,
    now: Instant,
) -> bool {
    if !should_refresh_jwks(jwks, key_id)
        || state.refresh_in_flight_generation == Some(state.generation)
        || now < state.cooldown_until
    {
        return false;
    }

    state.refresh_in_flight_generation = Some(state.generation);
    state.cooldown_until = now + GOOGLE_JWKS_UNKNOWN_KID_COOLDOWN;
    true
}

async fn refresh_jwks_for_unknown_kid(key_id: &str) -> Result<JwkSet, ApiError> {
    let cache = GOOGLE_JWKS_CACHE.get_or_init(|| Mutex::new(None));
    let now = Instant::now();
    let refresh_state = {
        let mut guard = cache.lock().map_err(|_| {
            ApiError::ServiceUnavailable("Google sign-in is temporarily unavailable.".to_string())
        })?;
        match guard.as_mut().filter(|cached| cached.expires_at > now) {
            Some(cached) => {
                if !reserve_unknown_kid_refresh(
                    &cached.jwks,
                    key_id,
                    &mut cached.refresh_state,
                    now,
                ) {
                    return Ok(cached.jwks.clone());
                }
                Some(cached.refresh_state)
            }
            None => None,
        }
    };

    let Some(refresh_state) = refresh_state else {
        return google_jwks().await;
    };

    let jwks = match fetch_google_jwks().await {
        Ok(jwks) => jwks,
        Err(error) => {
            if let Ok(mut guard) = cache.lock()
                && let Some(cached) = guard.as_mut()
                && cached.refresh_state.generation == refresh_state.generation
            {
                cached.refresh_state.complete_unknown_kid_refresh();
            }
            return Err(error);
        }
    };
    if let Ok(mut guard) = cache.lock()
        && let Some(cached) = guard.as_ref()
        && cached.refresh_state.generation == refresh_state.generation
    {
        let mut refresh_state = refresh_state;
        refresh_state.complete_unknown_kid_refresh();
        *guard = Some(CachedJwks {
            jwks: jwks.clone(),
            expires_at: Instant::now() + GOOGLE_JWKS_CACHE_TTL,
            refresh_state,
        });
    }

    Ok(jwks)
}

async fn google_jwks() -> Result<JwkSet, ApiError> {
    let cache = GOOGLE_JWKS_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock()
        && let Some(cached) = guard.as_ref()
        && cached.expires_at > Instant::now()
    {
        return Ok(cached.jwks.clone());
    }

    let jwks = fetch_google_jwks().await?;
    if let Ok(mut guard) = cache.lock() {
        let now = Instant::now();
        let mut refresh_state = guard
            .as_ref()
            .map(|cached| cached.refresh_state)
            .unwrap_or_else(|| JwksRefreshState::new(0, now));
        refresh_state.advance_generation(now);
        *guard = Some(CachedJwks {
            jwks: jwks.clone(),
            expires_at: now + GOOGLE_JWKS_CACHE_TTL,
            refresh_state,
        });
    }

    Ok(jwks)
}

async fn fetch_google_jwks() -> Result<JwkSet, ApiError> {
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

    Ok(jwks)
}

fn verify_token_with_jwks(
    credential: &str,
    jwks: &JwkSet,
    client_id: &str,
) -> Result<GoogleIdentity, ApiError> {
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

    let claims = verify_with_jwks(credential, key_id, jwks)?;
    validate_claims(&claims, client_id)
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileCompletion {
    pub complete: bool,
    pub missing_fields: Vec<&'static str>,
}

impl ProfileCompletion {
    // Not yet called from production code — reserved for the follow-up
    // `POST /profile/complete` task, which will build a "still missing" verdict
    // directly from `CompleteGuestProfileRequest` validation failures.
    #[allow(dead_code)]
    pub fn missing(missing_fields: Vec<&'static str>) -> Self {
        Self {
            complete: false,
            missing_fields,
        }
    }
}

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
    let suffix = google_identity_fingerprint(email, subject);
    let base_limit = 100 - suffix.len() - 1;

    format!("{}_{}", &base[..base.len().min(base_limit)], suffix)
}

pub fn google_identity_fingerprint(email: &str, subject: &str) -> String {
    let mut hasher = DefaultHasher::new();
    email.hash(&mut hasher);
    subject.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::{
        GoogleAudience, GoogleClaims, JwksRefreshState, ProfileCompletion, google_username,
        profile_completion, reserve_unknown_kid_refresh, should_refresh_jwks, validate_claims,
        verify_token_with_jwks,
    };
    use jsonwebtoken::jwk::JwkSet;
    use serde_json::json;
    use std::time::{Duration, Instant};

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
        let username = google_username("Aisha.Rahman@gmail.com", "10987654321");

        assert!(username.starts_with("aisha_rahman_"));
        assert!(username.len() <= 100);
        assert!(
            username
                .chars()
                .all(|character| character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || character == '_'
                    || character == '-')
        );
    }

    #[test]
    fn google_usernames_do_not_collide_when_subjects_share_the_old_six_character_suffix() {
        let first = google_username("aisha.rahman@example.com", "first-subject-654321");
        let second = google_username("aisha.rahman@example.com", "second-subject-654321");

        assert_ne!(first, second);
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

    #[test]
    fn unknown_kid_refresh_is_single_flight_per_cache_generation_and_cooldown() {
        let jwks = JwkSet { keys: Vec::new() };
        let now = Instant::now();
        let mut state = JwksRefreshState::new(7, now);

        assert!(reserve_unknown_kid_refresh(
            &jwks,
            "attacker-key-one",
            &mut state,
            now
        ));
        assert!(!reserve_unknown_kid_refresh(
            &jwks,
            "attacker-key-two",
            &mut state,
            now
        ));

        state.complete_unknown_kid_refresh();
        assert!(!reserve_unknown_kid_refresh(
            &jwks,
            "rotated-key",
            &mut state,
            now + Duration::from_secs(1)
        ));
        assert!(reserve_unknown_kid_refresh(
            &jwks,
            "rotated-key",
            &mut state,
            now + Duration::from_secs(61)
        ));
    }

    const FIXTURE_SIGNED_GOOGLE_TOKEN: &str = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImZpeHR1cmUta2V5In0.eyJpc3MiOiJhY2NvdW50cy5nb29nbGUuY29tIiwiYXVkIjoiaG90ZWwtY2xpZW50LmFwcHMuZ29vZ2xl\
dXNlcmNvbnRlbnQuY29tIiwiZXhwIjo0MTAyNDQ0ODAwLCJzdWIiOiIxMDk4NzY1NDMyMSIsImVtYWlsIjoiYWlzaGEucmFobWFuQGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImdpdmVuX25hbWUiOiJB\
aXNoYSIsImZhbWlseV9uYW1lIjoiUmFobWFuIn0.uzjKZWoXnjMvmGDqKa8BEx23en7bgn12ov-gCwFJ9KWlrGdFiilTREblZXfPiLfdk8DiIe1f_iX11wxagXZgNsJK7BnVqFgjuVRVrdFMeAXIOXTppO_yMrw5ttIc7ENRilk5EuZxeTHC4YVpY3ZGBb2mpR4rDHjD7l4xX-xFoPTnFps-rTsoV2D4CdkyuNi39e0Dc8l8t-DfNtyXGB9C3iaJMp68MeC6Gw15cYE4FzvTuHI4RePN7LqOkZ_4xTul3Vifp8mWty5K5Ib3y38u8Dm4oxXPiSZNqb5-NITmld4dJwev0a-Lt550lqA2hmtrP2bpWw4F71cyHXJxm0FVNg";
    const FIXTURE_SIGNED_UNKNOWN_KID_TOKEN: &str = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InVua25vd24ta2V5In0.eyJpc3MiOiJhY2NvdW50cy5nb29nbGUuY29tIiwiYXVkIjoiaG90ZWwtY2xpZW50LmFwcHMuZ29vZ2xl\
dXNlcmNvbnRlbnQuY29tIiwiZXhwIjo0MTAyNDQ0ODAwLCJzdWIiOiIxMDk4NzY1NDMyMSIsImVtYWlsIjoiYWlzaGEucmFobWFuQGV4YW1wbGUuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImdpdmVuX25hbWUiOiJB\
aXNoYSIsImZhbWlseV9uYW1lIjoiUmFobWFuIn0.uo_TQFvhAT6hlmNgOn4FHY_Mb0L8aYL6BfLPiDnn5r65OG68JkXLibaG9wbJcDmWwhgT2BmPz3Ll_w-zJUgyY7-YKfY4ayJyJmgYC8YfBit-Ft5m1y2RvJVNFI-qGmUDVypzzpInMtkoNkBB4nAfB00q0vfZwYpFsyDq90iw8J_w8R0LT4FRQazOoJAIb55bPIzFbDV2ynaJgLAbpqEu8gS1QOgxWg7PK8_yzd1P94CiTploqAx560KQK6OE4TWjvtdeQGBqb9UjKeg_Hw3IxfjQ1y28CZQkHz5ua6H7Bi2CBQYKtIsnVyUjaeDEfZojTNVg7-scG-TFS2S2ZC6k_w";

    fn fixture_jwks() -> JwkSet {
        serde_json::from_value(json!({
            "keys": [{
                "kty": "RSA",
                "n": "yRE6rHuNR0QbHO3H3Kt2pOKGVhQqGZXInOduQNxXzuKlvQTLUTv4l4sggh5_CYYi_cvI-SXVT9kPWSKXxJXBXd_4LkvcPuUakBoAkfh-eiFVMh2VrUyWyj3MFl0HTVF9KwRXLAcwkREiS3npThHRyIxuy0ZMeZfxVL5arMhw1SRELB8HoGfG_AtH89BIE9jDBHZ9dLelK9a184zAf8LwoPLxvJb3Il5nncqPcSfKDDodMFBIMc4lQzDKL5gvmiXLXB1AGLm8KBjfE8s3L5xqi-yUod-j8MtvIj812dkS4QMiRVN_by2h3ZY8LYVGrqZXZTcgn2ujn8uKjXLZVD5TdQ",
                "e": "AQAB",
                "kid": "fixture-key",
                "alg": "RS256",
                "use": "sig"
            }]
        }))
        .expect("fixture JWK must deserialize")
    }

    #[test]
    fn accepts_a_fixture_signed_rs256_google_token_from_its_jwk() {
        let identity =
            verify_token_with_jwks(FIXTURE_SIGNED_GOOGLE_TOKEN, &fixture_jwks(), CLIENT_ID)
                .expect("the matching fixture JWK must verify the RS256 signature");

        assert_eq!(identity.subject, "10987654321");
        assert_eq!(identity.email, "aisha.rahman@example.com");
    }

    #[test]
    fn rejects_a_tampered_fixture_rs256_google_token() {
        let tampered = format!(
            "{}A",
            &FIXTURE_SIGNED_GOOGLE_TOKEN[..FIXTURE_SIGNED_GOOGLE_TOKEN.len() - 1]
        );

        assert!(verify_token_with_jwks(&tampered, &fixture_jwks(), CLIENT_ID).is_err());
    }

    #[test]
    fn rejects_a_fixture_signed_token_whose_kid_is_not_in_the_jwks() {
        assert!(
            verify_token_with_jwks(FIXTURE_SIGNED_UNKNOWN_KID_TOKEN, &fixture_jwks(), CLIENT_ID,)
                .is_err()
        );
    }
}
