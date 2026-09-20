//! Extra auth/RBAC fixtures (new coverage — staging.sql had no 2FA user).
//!
//! 800019 `twofa_stg` has two-factor enabled with a deterministic TOTP secret
//! (base32 `JBSWY3DPEHPK3PXP` — the canonical "Hello!" test vector) and two
//! known recovery codes: `stg-rc-0001`, `stg-rc-0002`. The secret goes through
//! `AuthService::encrypt_stored_totp_secret`, so it lands encrypted when
//! `TOTP_ENCRYPTION_KEY` is configured and as plaintext otherwise — matching
//! what the app reads back. Recovery codes are stored as the app's
//! sha256(uppercase(code)) hashes, computed in SQL.

use hotel_app_be::AuthService;

use crate::engine::Tx;

/// Fixed base32 TOTP seed — a well-known test vector, never a real secret.
const TEST_TOTP_SECRET: &str = "JBSWY3DPEHPK3PXP";

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;

    // Same dev password as the other seed users; role 'staff' + explicit
    // bookings:read so the account can exercise the 2FA login flow end to end.
    sqlx::query(
        "UPDATE public.users SET two_factor_enabled = true, two_factor_secret = $2 \
         WHERE id = 800019",
    )
    .bind(800019_i64)
    .bind(AuthService::encrypt_stored_totp_secret(TEST_TOTP_SECRET))
    .execute(&mut **tx)
    .await?;

    sqlx::query("UPDATE public.users SET two_factor_recovery_codes = $2 WHERE id = 800019")
        .bind(800019_i64)
        .bind(vec![
            // hash_recovery_code uppercases the code, then sha256-hexes it.
            hex_sha256_upper("stg-rc-0001"),
            hex_sha256_upper("stg-rc-0002"),
        ])
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// hex(sha256(upper(code))) — the app's recovery-code storage form.
fn hex_sha256_upper(code: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(code.trim().to_uppercase().as_bytes());
    hex::encode(h.finalize())
}

const SQL: &str = r#"
INSERT INTO public.users (
    id, username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_locked, failed_login_attempts,
    is_super_admin, last_login_at, created_at
)
OVERRIDING SYSTEM VALUE VALUES
    -- 2FA-enabled staff login: HotelStaging2026! + TOTP (or a recovery code).
    (800019, 'twofa_stg', 'twofa.stg@staging.hotel-app.test', '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Two-Factor Seed', '+60-12-555-0117', 'staff', true, true, false, 0, false, CURRENT_TIMESTAMP - interval '1 day', CURRENT_TIMESTAMP - interval '30 days'),
    -- Timed lockout still in force (is_locked=false but locked_until future).
    (800020, 'locked_timed', 'locked.timed@staging.hotel-app.test', '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Timed Lockout Seed', '+60-12-555-0118', 'staff', true, true, false, 5, false, NULL, CURRENT_TIMESTAMP - interval '10 days');

UPDATE public.users SET locked_until = CURRENT_TIMESTAMP + interval '25 minutes' WHERE id = 800020;

-- Pending email-verification token on the unverified account (800014),
-- matching the registration flow's stored token shape.
UPDATE public.users
SET email_verification_token = 'stg-verify-' || id::text,
    email_token_expires_at = CURRENT_TIMESTAMP + interval '20 hours'
WHERE id = 800014;

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id FROM (VALUES (800019, 'staff'), (800020, 'staff')) AS m(user_id, role_name)
JOIN public.users u ON u.id = m.user_id
JOIN public.roles r ON r.name = m.role_name;
"#;
