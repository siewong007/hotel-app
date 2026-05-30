//! Passkey/WebAuthn handlers
//!
//! Handles passkey registration and authentication.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};
use base64::Engine;
use base64::engine::general_purpose;
use ring::signature;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::env;

// Helper function to decode base64url (WebAuthn format)
fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    // WebAuthn uses base64url encoding without padding
    // Convert base64url to standard base64
    let standard_b64 = input.replace('-', "+").replace('_', "/");

    // Add padding if needed
    let padded = match standard_b64.len() % 4 {
        2 => format!("{}==", standard_b64),
        3 => format!("{}=", standard_b64),
        _ => standard_b64,
    };

    general_purpose::STANDARD
        .decode(&padded)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

fn decode_standard_b64(input: &str, label: &str) -> Result<Vec<u8>, ApiError> {
    general_purpose::STANDARD
        .decode(input)
        .map_err(|_| ApiError::BadRequest(format!("Invalid {label} encoding")))
}

fn base64url_encode(bytes: &[u8]) -> String {
    general_purpose::STANDARD
        .encode(bytes)
        .replace('+', "-")
        .replace('/', "_")
        .trim_end_matches('=')
        .to_string()
}

fn json_byte_array(value: &Value, label: &str) -> Result<Vec<u8>, ApiError> {
    let values = value
        .as_array()
        .ok_or_else(|| ApiError::BadRequest(format!("Missing {label}")))?;

    values
        .iter()
        .map(|v| {
            let byte = v
                .as_u64()
                .ok_or_else(|| ApiError::BadRequest(format!("Invalid {label}")))?;
            u8::try_from(byte).map_err(|_| ApiError::BadRequest(format!("Invalid {label}")))
        })
        .collect()
}

fn rp_id() -> String {
    env::var("PASSKEY_RP_ID").unwrap_or_else(|_| "localhost".to_string())
}

fn origin_host(origin: &str) -> Option<&str> {
    let (_, rest) = origin.split_once("://")?;
    let authority = rest.split('/').next().unwrap_or(rest);
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    host_port.split(':').next().filter(|host| !host.is_empty())
}

fn origin_allowed(origin: &str, rp_id: &str) -> bool {
    let Some(host) = origin_host(origin) else {
        return false;
    };

    host == rp_id
        || host.ends_with(&format!(".{rp_id}"))
        || (rp_id == "localhost" && matches!(host, "127.0.0.1" | "::1"))
}

fn verify_client_data(
    client_data: &[u8],
    expected_type: &str,
    expected_challenge: &[u8],
    rp_id: &str,
) -> Result<Vec<u8>, ApiError> {
    let value: Value = serde_json::from_slice(client_data)
        .map_err(|_| ApiError::BadRequest("Invalid WebAuthn client data".to_string()))?;

    let actual_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Missing WebAuthn client data type".to_string()))?;
    if actual_type != expected_type {
        return Err(ApiError::Unauthorized(
            "Invalid WebAuthn client data type".to_string(),
        ));
    }

    let challenge = value
        .get("challenge")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Missing WebAuthn challenge".to_string()))?;
    let challenge_bytes = decode_base64url(challenge)
        .map_err(|_| ApiError::BadRequest("Invalid WebAuthn challenge".to_string()))?;
    if challenge_bytes != expected_challenge {
        return Err(ApiError::Unauthorized(
            "WebAuthn challenge mismatch".to_string(),
        ));
    }

    let origin = value
        .get("origin")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Missing WebAuthn origin".to_string()))?;
    if !origin_allowed(origin, rp_id) {
        return Err(ApiError::Unauthorized(
            "WebAuthn origin is not allowed".to_string(),
        ));
    }

    if value
        .get("crossOrigin")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(ApiError::Unauthorized(
            "Cross-origin WebAuthn assertions are not allowed".to_string(),
        ));
    }

    Ok(Sha256::digest(client_data).to_vec())
}

struct CborReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> CborReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_u8(&mut self) -> Result<u8, ApiError> {
        let byte = *self
            .data
            .get(self.pos)
            .ok_or_else(|| ApiError::BadRequest("Truncated CBOR data".to_string()))?;
        self.pos += 1;
        Ok(byte)
    }

    fn read_exact(&mut self, len: usize) -> Result<&'a [u8], ApiError> {
        let end = self
            .pos
            .checked_add(len)
            .ok_or_else(|| ApiError::BadRequest("Invalid CBOR length".to_string()))?;
        let slice = self
            .data
            .get(self.pos..end)
            .ok_or_else(|| ApiError::BadRequest("Truncated CBOR data".to_string()))?;
        self.pos = end;
        Ok(slice)
    }

    fn read_type_len(&mut self) -> Result<(u8, u64), ApiError> {
        let first = self.read_u8()?;
        let major = first >> 5;
        let additional = first & 0x1f;
        let len = match additional {
            0..=23 => additional as u64,
            24 => self.read_u8()? as u64,
            25 => {
                let bytes = self.read_exact(2)?;
                u16::from_be_bytes([bytes[0], bytes[1]]) as u64
            }
            26 => {
                let bytes = self.read_exact(4)?;
                u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as u64
            }
            27 => {
                let bytes = self.read_exact(8)?;
                u64::from_be_bytes([
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ])
            }
            _ => {
                return Err(ApiError::BadRequest(
                    "Indefinite CBOR is not supported".to_string(),
                ));
            }
        };
        Ok((major, len))
    }

    fn read_map_len(&mut self) -> Result<usize, ApiError> {
        let (major, len) = self.read_type_len()?;
        if major != 5 {
            return Err(ApiError::BadRequest("Expected CBOR map".to_string()));
        }
        usize::try_from(len).map_err(|_| ApiError::BadRequest("CBOR map too large".to_string()))
    }

    fn read_text(&mut self) -> Result<String, ApiError> {
        let (major, len) = self.read_type_len()?;
        if major != 3 {
            return Err(ApiError::BadRequest("Expected CBOR text".to_string()));
        }
        let bytes = self.read_exact(
            usize::try_from(len)
                .map_err(|_| ApiError::BadRequest("CBOR text too large".to_string()))?,
        )?;
        std::str::from_utf8(bytes)
            .map(|s| s.to_string())
            .map_err(|_| ApiError::BadRequest("Invalid CBOR text".to_string()))
    }

    fn read_bytes(&mut self) -> Result<&'a [u8], ApiError> {
        let (major, len) = self.read_type_len()?;
        if major != 2 {
            return Err(ApiError::BadRequest("Expected CBOR bytes".to_string()));
        }
        self.read_exact(
            usize::try_from(len)
                .map_err(|_| ApiError::BadRequest("CBOR bytes too large".to_string()))?,
        )
    }

    fn read_int(&mut self) -> Result<i64, ApiError> {
        let (major, value) = self.read_type_len()?;
        match major {
            0 => i64::try_from(value)
                .map_err(|_| ApiError::BadRequest("CBOR integer too large".to_string())),
            1 => {
                let value = i64::try_from(value)
                    .map_err(|_| ApiError::BadRequest("CBOR integer too large".to_string()))?;
                Ok(-1 - value)
            }
            _ => Err(ApiError::BadRequest("Expected CBOR integer".to_string())),
        }
    }

    fn skip(&mut self) -> Result<(), ApiError> {
        let (major, len) = self.read_type_len()?;
        match major {
            0 | 1 => Ok(()),
            2 | 3 => {
                self.read_exact(
                    usize::try_from(len)
                        .map_err(|_| ApiError::BadRequest("CBOR value too large".to_string()))?,
                )?;
                Ok(())
            }
            4 => {
                for _ in 0..len {
                    self.skip()?;
                }
                Ok(())
            }
            5 => {
                for _ in 0..len {
                    self.skip()?;
                    self.skip()?;
                }
                Ok(())
            }
            6 => self.skip(),
            7 => Ok(()),
            _ => Err(ApiError::BadRequest("Unsupported CBOR value".to_string())),
        }
    }
}

fn extract_auth_data_from_attestation(attestation_object: &[u8]) -> Result<Vec<u8>, ApiError> {
    let mut reader = CborReader::new(attestation_object);
    let entries = reader.read_map_len()?;
    let mut auth_data = None;

    for _ in 0..entries {
        let key = reader.read_text()?;
        if key == "authData" {
            auth_data = Some(reader.read_bytes()?.to_vec());
        } else {
            reader.skip()?;
        }
    }

    auth_data.ok_or_else(|| ApiError::BadRequest("Missing WebAuthn authData".to_string()))
}

fn parse_cose_es256_public_key(cose_key: &[u8]) -> Result<Vec<u8>, ApiError> {
    let mut reader = CborReader::new(cose_key);
    let entries = reader.read_map_len()?;
    let mut kty = None;
    let mut alg = None;
    let mut crv = None;
    let mut x = None;
    let mut y = None;

    for _ in 0..entries {
        let key = reader.read_int()?;
        match key {
            1 => kty = Some(reader.read_int()?),
            3 => alg = Some(reader.read_int()?),
            -1 => crv = Some(reader.read_int()?),
            -2 => x = Some(reader.read_bytes()?.to_vec()),
            -3 => y = Some(reader.read_bytes()?.to_vec()),
            _ => reader.skip()?,
        }
    }

    if kty != Some(2) || alg != Some(-7) || crv != Some(1) {
        return Err(ApiError::BadRequest(
            "Only ES256 passkeys are supported".to_string(),
        ));
    }

    let x = x.ok_or_else(|| ApiError::BadRequest("Missing passkey public key x".to_string()))?;
    let y = y.ok_or_else(|| ApiError::BadRequest("Missing passkey public key y".to_string()))?;
    if x.len() != 32 || y.len() != 32 {
        return Err(ApiError::BadRequest(
            "Invalid passkey public key length".to_string(),
        ));
    }

    let mut public_key = Vec::with_capacity(65);
    public_key.push(0x04);
    public_key.extend_from_slice(&x);
    public_key.extend_from_slice(&y);
    Ok(public_key)
}

fn validate_auth_data_prefix(
    auth_data: &[u8],
    rp_id: &str,
    require_attested: bool,
) -> Result<u32, ApiError> {
    if auth_data.len() < 37 {
        return Err(ApiError::BadRequest(
            "Invalid WebAuthn authenticator data".to_string(),
        ));
    }

    let expected_rp_hash = Sha256::digest(rp_id.as_bytes());
    if auth_data[..32] != expected_rp_hash[..] {
        return Err(ApiError::Unauthorized(
            "WebAuthn RP ID hash mismatch".to_string(),
        ));
    }

    let flags = auth_data[32];
    if flags & 0x01 == 0 || flags & 0x04 == 0 {
        return Err(ApiError::Unauthorized(
            "Passkey user presence and verification are required".to_string(),
        ));
    }
    if require_attested && flags & 0x40 == 0 {
        return Err(ApiError::BadRequest(
            "Missing passkey attested credential data".to_string(),
        ));
    }

    Ok(u32::from_be_bytes([
        auth_data[33],
        auth_data[34],
        auth_data[35],
        auth_data[36],
    ]))
}

fn parse_attested_credential(
    auth_data: &[u8],
    rp_id: &str,
) -> Result<(Vec<u8>, Vec<u8>, u32), ApiError> {
    let counter = validate_auth_data_prefix(auth_data, rp_id, true)?;
    let mut pos = 37usize;

    pos += 16; // AAGUID
    if auth_data.len() < pos + 2 {
        return Err(ApiError::BadRequest(
            "Invalid passkey credential data".to_string(),
        ));
    }

    let credential_len = u16::from_be_bytes([auth_data[pos], auth_data[pos + 1]]) as usize;
    pos += 2;
    let credential_end = pos
        .checked_add(credential_len)
        .ok_or_else(|| ApiError::BadRequest("Invalid passkey credential length".to_string()))?;
    if credential_len == 0 || auth_data.len() <= credential_end {
        return Err(ApiError::BadRequest(
            "Invalid passkey credential data".to_string(),
        ));
    }

    let credential_id = auth_data[pos..credential_end].to_vec();
    let public_key = parse_cose_es256_public_key(&auth_data[credential_end..])?;
    Ok((credential_id, public_key, counter))
}

pub async fn list_passkeys_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<PasskeyInfo>>, ApiError> {
    // Manually query and construct PasskeyInfo with base64url-encoded credential_id
    let rows = sqlx::query(
        r#"
        SELECT id, credential_id, device_name, created_at, last_used_at
        FROM passkeys
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut passkeys: Vec<PasskeyInfo> = Vec::new();

    for row in rows {
        use sqlx::Row;

        // Safely get credential_id bytes
        let credential_id_bytes: Vec<u8> = match row.try_get("credential_id") {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("Failed to get credential_id: {}", e);
                continue;
            }
        };

        // Encode credential_id as base64url for frontend
        let credential_id_b64url = general_purpose::STANDARD
            .encode(&credential_id_bytes)
            .replace('+', "-")
            .replace('/', "_")
            .trim_end_matches('=')
            .to_string();

        passkeys.push(PasskeyInfo {
            id: row
                .try_get("id")
                .map_err(|e| ApiError::Database(e.to_string()))?,
            credential_id: credential_id_b64url,
            device_name: row.try_get("device_name").ok(),
            created_at: row
                .try_get("created_at")
                .map_err(|e| ApiError::Database(e.to_string()))?,
            last_used_at: row.try_get("last_used_at").ok(),
        });
    }

    Ok(Json(passkeys))
}

pub async fn delete_passkey_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query("DELETE FROM passkeys WHERE id = $1 AND user_id = $2")
        .bind(passkey_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Passkey not found".to_string()));
    }

    Ok(Json(
        serde_json::json!({"message": "Passkey deleted successfully"}),
    ))
}

pub async fn update_passkey_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
    Json(input): Json<PasskeyUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query("UPDATE passkeys SET device_name = $1 WHERE id = $2 AND user_id = $3")
        .bind(&input.device_name)
        .bind(passkey_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Passkey not found".to_string()));
    }

    Ok(Json(
        serde_json::json!({"message": "Passkey updated successfully"}),
    ))
}

pub async fn passkey_register_start_handler(
    State(pool): State<DbPool>,
    Extension(authenticated_user_id): Extension<i64>,
    Json(req): Json<PasskeyRegistrationStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND username = $2 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(authenticated_user_id)
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Forbidden("Cannot register a passkey for another user".to_string()))?;

    // Check passkey limit (max 10)
    let passkey_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM passkeys WHERE user_id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if passkey_count >= 10 {
        return Err(ApiError::BadRequest(
            "Maximum of 10 passkeys allowed per user".to_string(),
        ));
    }

    // Generate challenge (32 random bytes)
    let challenge_bytes: [u8; 32] = {
        let mut rng = rand::rng();
        rand::Rng::random(&mut rng)
    };
    let challenge_b64 = general_purpose::STANDARD.encode(challenge_bytes);

    // Store challenge temporarily (expires in 5 minutes)
    sqlx::query(
        r#"
        INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user.id)
    .bind(&challenge_bytes[..]) // Bind as bytea
    .bind("registration")
    // Expiry computed in Rust so the query stays portable across PostgreSQL
    // and SQLite (no CURRENT_TIMESTAMP + INTERVAL).
    .bind(chrono::Utc::now() + chrono::Duration::minutes(5))
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "challenge": challenge_b64,
        "rp": {
            "name": "Hotel Management System",
            "id": rp_id(),
        },
        "user": {
            "id": general_purpose::STANDARD.encode(user.id.to_string()),
            "name": user.username,
            "displayName": user.full_name.as_ref().unwrap_or(&user.username),
        }
    })))
}

pub async fn passkey_register_finish_handler(
    State(pool): State<DbPool>,
    Extension(authenticated_user_id): Extension<i64>,
    Json(req): Json<PasskeyRegistrationFinish>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND username = $2 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(authenticated_user_id)
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Forbidden("Cannot register a passkey for another user".to_string()))?;

    let expected_challenge = decode_standard_b64(&req.challenge, "challenge")?;
    let challenge_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND challenge_type = 'registration' AND expires_at > CURRENT_TIMESTAMP AND used_at IS NULL)"
    )
    .bind(user.id)
    .bind(&expected_challenge)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !challenge_exists {
        return Err(ApiError::Unauthorized(
            "Invalid or expired challenge".to_string(),
        ));
    }

    let credential: serde_json::Value = serde_json::from_str(&req.credential)
        .map_err(|_| ApiError::BadRequest("Invalid credential format".to_string()))?;

    let credential_id_str = credential["id"]
        .as_str()
        .ok_or_else(|| ApiError::BadRequest("Missing credential ID".to_string()))?;
    let credential_id_from_json = decode_base64url(credential_id_str)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    let response = credential
        .get("response")
        .ok_or_else(|| ApiError::BadRequest("Missing credential response".to_string()))?;
    let client_data_json = json_byte_array(
        response
            .get("clientDataJSON")
            .ok_or_else(|| ApiError::BadRequest("Missing clientDataJSON".to_string()))?,
        "clientDataJSON",
    )?;
    let attestation_object = json_byte_array(
        response
            .get("attestationObject")
            .ok_or_else(|| ApiError::BadRequest("Missing attestationObject".to_string()))?,
        "attestationObject",
    )?;

    let rp_id = rp_id();
    verify_client_data(
        &client_data_json,
        "webauthn.create",
        &expected_challenge,
        &rp_id,
    )?;
    let auth_data = extract_auth_data_from_attestation(&attestation_object)?;
    let (credential_id_bytes, public_key, counter) = parse_attested_credential(&auth_data, &rp_id)?;
    if credential_id_bytes != credential_id_from_json {
        return Err(ApiError::BadRequest(
            "Credential ID does not match attestation data".to_string(),
        ));
    }

    // Store passkey
    let device_name = req
        .device_name
        .clone()
        .unwrap_or_else(|| format!("Passkey {}", chrono::Utc::now().format("%Y-%m-%d")));

    sqlx::query(
        r#"
        INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_name)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(user.id)
    .bind(&credential_id_bytes[..])
    .bind(&public_key)
    .bind(i64::from(counter))
    .bind(device_name)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete used challenge
    sqlx::query(
        "UPDATE passkey_challenges SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND challenge = $2",
    )
    .bind(user.id)
    .bind(&expected_challenge)
    .execute(&pool)
    .await
    .ok();

    Ok(Json(
        serde_json::json!({"message": "Passkey registered successfully"}),
    ))
}

pub async fn passkey_login_start_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyLoginStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user by username
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get user's passkeys
    let passkeys = sqlx::query_as::<_, Passkey>(
        "SELECT * FROM passkeys WHERE user_id = $1 AND is_active = true",
    )
    .bind(user.id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if passkeys.is_empty() {
        return Err(ApiError::NotFound(
            "No passkeys found for this user".to_string(),
        ));
    }

    // Generate challenge (32 random bytes)
    let challenge_bytes: [u8; 32] = {
        let mut rng = rand::rng();
        rand::Rng::random(&mut rng)
    };
    let challenge_b64 = general_purpose::STANDARD.encode(challenge_bytes);

    // Store challenge
    sqlx::query(
        r#"
        INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user.id)
    .bind(&challenge_bytes[..]) // Bind as bytea
    .bind("authentication")
    // Expiry computed in Rust so the query stays portable across PostgreSQL
    // and SQLite (no CURRENT_TIMESTAMP + INTERVAL).
    .bind(chrono::Utc::now() + chrono::Duration::minutes(5))
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let allow_credentials: Vec<serde_json::Value> = passkeys
        .iter()
        .map(|pk| {
            serde_json::json!({
                "id": base64url_encode(&pk.credential_id),
                "type": "public-key"
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "challenge": challenge_b64,
        "allowCredentials": allow_credentials
    })))
}

pub async fn passkey_login_finish_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyLoginFinish>,
) -> Result<Json<AuthResponse>, ApiError> {
    // Get user
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    let expected_challenge = decode_standard_b64(&req.challenge, "challenge")?;
    let challenge_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND challenge_type = 'authentication' AND expires_at > CURRENT_TIMESTAMP AND used_at IS NULL)"
    )
    .bind(user.id)
    .bind(&expected_challenge)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !challenge_exists {
        return Err(ApiError::Unauthorized(
            "Invalid or expired challenge".to_string(),
        ));
    }

    // Decode credential_id from base64url (WebAuthn uses URL-safe base64) to bytes for BYTEA lookup
    let credential_id_bytes = decode_base64url(&req.credential_id)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    let passkey = sqlx::query_as::<_, Passkey>(
        "SELECT * FROM passkeys WHERE user_id = $1 AND credential_id = $2 AND is_active = true",
    )
    .bind(user.id)
    .bind(&credential_id_bytes[..])
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Unauthorized("Invalid passkey".to_string()))?;

    let client_data_json = decode_standard_b64(&req.client_data_json, "clientDataJSON")?;
    let authenticator_data = decode_standard_b64(&req.authenticator_data, "authenticatorData")?;
    let signature_bytes = decode_standard_b64(&req.signature, "signature")?;
    let rp_id = rp_id();
    let client_data_hash = verify_client_data(
        &client_data_json,
        "webauthn.get",
        &expected_challenge,
        &rp_id,
    )?;
    let counter = validate_auth_data_prefix(&authenticator_data, &rp_id, false)?;

    if passkey.counter > 0 && i64::from(counter) <= passkey.counter {
        return Err(ApiError::Unauthorized(
            "Passkey sign counter did not advance".to_string(),
        ));
    }

    let mut signed_data = Vec::with_capacity(authenticator_data.len() + client_data_hash.len());
    signed_data.extend_from_slice(&authenticator_data);
    signed_data.extend_from_slice(&client_data_hash);

    signature::UnparsedPublicKey::new(&signature::ECDSA_P256_SHA256_ASN1, &passkey.public_key)
        .verify(&signed_data, &signature_bytes)
        .map_err(|_| ApiError::Unauthorized("Invalid passkey signature".to_string()))?;

    // Update last used
    sqlx::query("UPDATE passkeys SET last_used_at = CURRENT_TIMESTAMP, counter = $1 WHERE id = $2")
        .bind(i64::from(counter))
        .bind(passkey.id)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        "UPDATE passkey_challenges SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND challenge = $2",
    )
    .bind(user.id)
    .bind(&expected_challenge)
    .execute(&pool)
    .await
    .ok();

    // Get roles and permissions
    let roles = AuthService::get_user_roles(&pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(&pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate tokens
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    let refresh_token = AuthService::generate_refresh_token();

    // Check if this is the first login
    let is_first_login: bool =
        sqlx::query_scalar("SELECT last_login_at IS NULL FROM users WHERE id = $1")
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap_or(false);

    // Store refresh token
    AuthService::store_refresh_token(&pool, user.id, &refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: UserResponse::from(user),
        roles,
        permissions,
        is_first_login,
    }))
}
