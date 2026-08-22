//! Passkey/WebAuthn business workflows.

use crate::core::auth::AuthService;
use crate::core::config;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::AuditEvent;
use crate::models::{
    AuthResponse, PasskeyInfo, PasskeyLoginFinish, PasskeyLoginStart, PasskeyRegistrationFinish,
    PasskeyRegistrationStart, PasskeyUpdateInput, UserResponse,
};
use crate::repositories::auth::AuthRepository;
use crate::repositories::passkey::PasskeyRepository;
use crate::repositories::rbac::RbacRepository;
use crate::services::audit::AuditLog;
use base64::Engine;
use base64::engine::general_purpose;
use rand::RngExt;
use ring::signature;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub async fn list_passkeys(pool: &DbPool, user_id: i64) -> Result<Vec<PasskeyInfo>, ApiError> {
    Ok(PasskeyRepository::list_passkeys(pool, user_id)
        .await?
        .into_iter()
        .map(|row| PasskeyInfo {
            id: row.id,
            credential_id: base64url_encode(&row.credential_id),
            device_name: row.device_name,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
        })
        .collect())
}

pub async fn delete_passkey(
    pool: &DbPool,
    user_id: i64,
    passkey_id: uuid::Uuid,
) -> Result<(), ApiError> {
    if PasskeyRepository::delete_passkey(pool, user_id, passkey_id).await? {
        Ok(())
    } else {
        Err(ApiError::NotFound("Passkey not found".to_string()))
    }
}

pub async fn update_passkey(
    pool: &DbPool,
    user_id: i64,
    passkey_id: uuid::Uuid,
    input: PasskeyUpdateInput,
) -> Result<(), ApiError> {
    if PasskeyRepository::update_device_name(pool, user_id, passkey_id, &input.device_name).await? {
        Ok(())
    } else {
        Err(ApiError::NotFound("Passkey not found".to_string()))
    }
}

pub async fn register_start(
    pool: &DbPool,
    authenticated_user_id: i64,
    req: PasskeyRegistrationStart,
) -> Result<serde_json::Value, ApiError> {
    let user = PasskeyRepository::find_active_user_by_id_and_username(
        pool,
        authenticated_user_id,
        &req.username,
    )
    .await?
    .ok_or_else(|| ApiError::Forbidden("Cannot register a passkey for another user".to_string()))?;

    // A passkey satisfies 2FA on its own, so registering one is a step-up
    // operation — a live session alone must not be enough to mint one.
    crate::services::auth::ensure_step_up(
        pool,
        user.id,
        req.password.as_deref(),
        req.totp_code.as_deref(),
    )
    .await?;

    let passkey_count = PasskeyRepository::passkey_count(pool, user.id).await?;
    if passkey_count >= 10 {
        return Err(ApiError::BadRequest(
            "Maximum of 10 passkeys allowed per user".to_string(),
        ));
    }

    let challenge_bytes: [u8; 32] = rand::rng().random();
    let challenge_b64 = general_purpose::STANDARD.encode(challenge_bytes);

    PasskeyRepository::insert_challenge(
        pool,
        user.id,
        &challenge_bytes,
        "registration",
        chrono::Utc::now() + chrono::Duration::minutes(5),
    )
    .await?;

    let rp_name = settings_cache::get_string(
        pool,
        "passkey_relying_party_name",
        "Hotel Management System",
    )
    .await;

    Ok(json!({
        "challenge": challenge_b64,
        "rp": {
            "name": rp_name,
            "id": rp_id(),
        },
        "user": {
            "id": general_purpose::STANDARD.encode(user.id.to_string()),
            "name": user.username,
            "displayName": user.full_name.as_ref().unwrap_or(&user.username),
        }
    }))
}

pub async fn register_finish(
    pool: &DbPool,
    authenticated_user_id: i64,
    req: PasskeyRegistrationFinish,
) -> Result<(), ApiError> {
    let user = PasskeyRepository::find_active_user_by_id_and_username(
        pool,
        authenticated_user_id,
        &req.username,
    )
    .await?
    .ok_or_else(|| ApiError::Forbidden("Cannot register a passkey for another user".to_string()))?;

    let expected_challenge = decode_standard_b64(&req.challenge, "challenge")?;
    let challenge_exists =
        PasskeyRepository::challenge_exists(pool, user.id, &expected_challenge, "registration")
            .await?;
    if !challenge_exists {
        return Err(ApiError::Unauthorized(
            "Invalid or expired challenge".to_string(),
        ));
    }

    let credential: Value = serde_json::from_str(&req.credential)
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

    let device_name = req
        .device_name
        .clone()
        .unwrap_or_else(|| format!("Passkey {}", chrono::Utc::now().format("%Y-%m-%d")));

    PasskeyRepository::insert_passkey(
        pool,
        user.id,
        &credential_id_bytes,
        &public_key,
        i64::from(counter),
        &device_name,
    )
    .await?;

    let _ = PasskeyRepository::mark_challenge_used(pool, user.id, &expected_challenge).await;

    // Enrollment is the step that turns a stolen session into permanent
    // access, so it must be on the record even though nothing else in this
    // file used to be.
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user.id),
            action: "passkey_registered",
            resource_type: "user",
            resource_id: Some(user.id),
            details: Some(json!({ "device_name": device_name })),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

pub async fn login_start(
    pool: &DbPool,
    req: PasskeyLoginStart,
) -> Result<serde_json::Value, ApiError> {
    let user = PasskeyRepository::find_active_user_by_username(pool, &req.username)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    let passkeys = PasskeyRepository::active_passkeys(pool, user.id).await?;
    if passkeys.is_empty() {
        return Err(ApiError::NotFound(
            "No passkeys found for this user".to_string(),
        ));
    }

    let challenge_bytes: [u8; 32] = rand::rng().random();
    let challenge_b64 = general_purpose::STANDARD.encode(challenge_bytes);

    PasskeyRepository::insert_challenge(
        pool,
        user.id,
        &challenge_bytes,
        "authentication",
        chrono::Utc::now() + chrono::Duration::minutes(5),
    )
    .await?;

    let allow_credentials: Vec<serde_json::Value> = passkeys
        .iter()
        .map(|passkey| {
            json!({
                "id": base64url_encode(&passkey.credential_id),
                "type": "public-key"
            })
        })
        .collect();

    Ok(json!({
        "challenge": challenge_b64,
        "allowCredentials": allow_credentials
    }))
}

/// Completes a passkey login. Like the password `login`, returns the
/// `AuthResponse` plus the refresh token as a separate `String` so the route
/// handler can set it on an `HttpOnly` cookie instead of the JSON body.
pub async fn login_finish(
    pool: &DbPool,
    req: PasskeyLoginFinish,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
) -> Result<(AuthResponse, String), ApiError> {
    let user = PasskeyRepository::find_active_user_by_username(pool, &req.username)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Account lockout applies to every login door, not just the password one.
    crate::services::auth::ensure_not_locked(pool, user.id, &req.username, ip_address, user_agent)
        .await?;

    let expected_challenge = decode_standard_b64(&req.challenge, "challenge")?;
    let challenge_exists =
        PasskeyRepository::challenge_exists(pool, user.id, &expected_challenge, "authentication")
            .await?;
    if !challenge_exists {
        let _ = AuditLog::log_login_failure(
            pool,
            &req.username,
            "Invalid or expired passkey challenge",
            ip_address.map(str::to_string),
            user_agent.map(str::to_string),
        )
        .await;
        return Err(ApiError::Unauthorized(
            "Invalid or expired challenge".to_string(),
        ));
    }

    let credential_id_bytes = decode_base64url(&req.credential_id)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    let passkey = match PasskeyRepository::find_active_passkey_by_credential(
        pool,
        user.id,
        &credential_id_bytes,
    )
    .await?
    {
        Some(passkey) => passkey,
        None => {
            let _ = AuditLog::log_login_failure(
                pool,
                &req.username,
                "Unknown passkey credential",
                ip_address.map(str::to_string),
                user_agent.map(str::to_string),
            )
            .await;
            return Err(ApiError::Unauthorized("Invalid passkey".to_string()));
        }
    };

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

    let _ = PasskeyRepository::update_last_used(pool, passkey.id, i64::from(counter)).await;
    let _ = PasskeyRepository::mark_challenge_used(pool, user.id, &expected_challenge).await;

    // Passkey logins were completely invisible (no audit row on success or
    // failure), unlike password logins. Mirror the password path.
    let _ = AuditLog::log_login_success(
        pool,
        user.id,
        "passkey",
        ip_address.map(str::to_string),
        user_agent.map(str::to_string),
    )
    .await;

    let roles = AuthService::get_user_roles(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let route_policies = RbacRepository::find_all_route_access_policies(pool).await?;
    let refresh_token = AuthService::generate_refresh_token();
    let is_first_login = AuthRepository::is_first_login(pool, user.id)
        .await
        .unwrap_or(false);

    let session_id =
        AuthService::store_refresh_token(pool, user.id, &refresh_token, 30, ip_address, user_agent)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;
    let access_token = AuthService::generate_session_jwt(
        user.id,
        user.username.clone(),
        roles.clone(),
        session_id,
    )
    .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;
    let _ = AuthRepository::update_last_login(pool, user.id).await;

    let profile_completion = crate::services::profile::completion_for_user(pool, user.id).await?;

    Ok((
        AuthResponse {
            access_token,
            user: UserResponse::from(user),
            roles,
            permissions,
            route_policies,
            is_first_login,
            recovery_codes_remaining: None,
            profile_complete: profile_completion.complete,
            missing_profile_fields: profile_completion
                .missing_fields
                .into_iter()
                .map(str::to_string)
                .collect(),
        },
        refresh_token,
    ))
}

fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    let standard_b64 = input.replace('-', "+").replace('_', "/");
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
    config::get().passkey_rp_id.clone()
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

    pos += 16;
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
