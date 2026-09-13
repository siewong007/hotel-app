//! Authentication repository for database operations.

use crate::constants::UserType;
use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::{Guest, RegisterRequest, User};
use crate::modules::consent::models::{ConsentAcceptance, ConsentSource};
use crate::modules::consent::service::{self as consent_service, ConsentContext, ConsentSubject};
use crate::modules::consent::validation as consent_validation;
use crate::services::google_identity::{
    GoogleIdentity, google_identity_fingerprint, google_username,
};
use chrono::{DateTime, Utc};

pub struct AuthRepository;

/// Consent evidence required to insert a new Google guest account.
pub struct NewGoogleAccountConsent<'a> {
    pub consents: &'a [ConsentAcceptance],
    pub context: &'a ConsentContext,
    pub language_preference: &'a str,
}

/// Outcome of resolving a Google identity to a guest user.
#[derive(Debug)]
pub struct GoogleGuestResolution {
    pub user: User,
    /// True when this call inserted the guest and user rows.
    pub created: bool,
    pub guest_id: Option<i64>,
}

/// The portal account attached to a guest profile, as the claim path needs to
/// judge it: whether it can still be claimed, or whether the guest already has
/// a real login and should be told to sign in instead.
#[derive(Debug, sqlx::FromRow)]
pub struct GuestAccountRow {
    pub id: i64,
    pub is_active: bool,
    /// False for the login-disabled anchor account front-desk eKYC provisions,
    /// which exists only to satisfy `ekyc_verifications.user_id`.
    pub has_password: bool,
    pub is_deleted: bool,
}

/// Column values for [`AuthRepository::claim_guest_account`].
pub struct ClaimGuestAccountValues<'a> {
    /// Set to upgrade an existing anchor account in place; `None` inserts one.
    pub existing_user_id: Option<i64>,
    pub guest_id: i64,
    pub username: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub full_name: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub is_verified: bool,
}

fn existing_google_user(user: User) -> GoogleGuestResolution {
    GoogleGuestResolution {
        user,
        created: false,
        guest_id: None,
    }
}

/// Upper bound on internal retries inside `resolve_google_guest` when a
/// concurrent insert/update loses a race on a unique constraint. Bounded so a
/// pathological row (e.g. a soft-deleted user still holding the target
/// `google_subject` or email under a partial unique index that excludes
/// `deleted_at IS NULL`) cannot force unbounded recursion and hang the request.
const MAX_GOOGLE_RESOLVE_ATTEMPTS: u8 = 3;

pub(crate) fn is_guest_name_unique_violation(error: &sqlx::Error) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };

    let is_unique_violation = database_error.code().as_deref() == Some("23505")
        || database_error
            .message()
            .contains("UNIQUE constraint failed");
    let is_guest_name_constraint = database_error.constraint()
        == Some("idx_guests_nick_name_unique")
        || database_error
            .message()
            .contains("idx_guests_nick_name_unique");

    is_unique_violation && is_guest_name_constraint
}

fn is_google_subject_unique_violation(error: &sqlx::Error) -> bool {
    is_user_unique_violation(error, "uq_users_google_subject")
}

fn is_user_email_unique_violation(error: &sqlx::Error) -> bool {
    is_user_unique_violation(error, "users_email_key")
}

fn is_user_unique_violation(error: &sqlx::Error, constraint: &str) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };

    (database_error.code().as_deref() == Some("23505")
        || database_error
            .message()
            .contains("UNIQUE constraint failed"))
        && (database_error.constraint() == Some(constraint)
            || database_error.message().contains(constraint))
}

impl AuthRepository {
    pub async fn find_user_by_login(
        pool: &DbPool,
        username_or_email: &str,
    ) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE (username = $1 OR email = $1) AND deleted_at IS NULL"
        )
        .bind(username_or_email)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn find_user_by_id(pool: &DbPool, user_id: i64) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn find_user_by_email(pool: &DbPool, email: &str) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE email = $1 AND deleted_at IS NULL"
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn login_lock_state(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(Option<bool>, Option<DateTime<Utc>>, Option<i32>), ApiError> {
        sqlx::query_as(
            "SELECT is_locked, locked_until, failed_login_attempts FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn unlock_user(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET is_locked = false, locked_until = NULL, failed_login_attempts = 0 WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn password_hash(pool: &DbPool, user_id: i64) -> Result<String, ApiError> {
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn max_login_attempts(pool: &DbPool) -> i32 {
        settings_cache::get_positive_i32(pool, "max_login_attempts", 5).await
    }

    /// Atomically count one failed login and lock the account when the
    /// configured maximum is reached. The increment and the lock decision must
    /// share one statement: as separate read-then-write calls, N concurrent
    /// guesses each read the same counter and wrote value+1, so a burst of B
    /// requests cost ONE increment — roughly max_attempts × B guesses before
    /// lockout instead of max_attempts.
    ///
    /// Every `SET`/`CASE` reference sees the pre-update row, so the three
    /// `failed_login_attempts + 1` terms agree; `RETURNING` exposes new values.
    pub async fn register_failed_login(
        pool: &DbPool,
        user_id: i64,
        max_attempts: i32,
        locked_until: DateTime<Utc>,
    ) -> Result<(i32, bool), ApiError> {
        sqlx::query_as(
            "UPDATE users SET \
                 failed_login_attempts = failed_login_attempts + 1, \
                 is_locked = (failed_login_attempts + 1 >= $1), \
                 locked_until = CASE WHEN failed_login_attempts + 1 >= $1 THEN $2 ELSE locked_until END \
             WHERE id = $3 \
             RETURNING failed_login_attempts, is_locked",
        )
        .bind(max_attempts)
        .bind(locked_until)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn two_factor_state(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(Option<bool>, Option<String>), ApiError> {
        sqlx::query_as("SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn reset_login_attempts(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET failed_login_attempts = 0, is_locked = false, locked_until = NULL WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn is_first_login(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar("SELECT last_login_at IS NULL FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn update_last_login(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn username_or_email_exists(
        pool: &DbPool,
        username: &str,
        email: Option<&str>,
    ) -> Result<bool, ApiError> {
        let existing = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM users WHERE username = $1 OR ($2 IS NOT NULL AND email = $2) LIMIT 1",
        )
        .bind(username)
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(existing.is_some())
    }

    pub async fn register_guest_user(
        tx: &mut DbTransaction<'_>,
        req: &RegisterRequest,
        password_hash: &str,
        language_preference: &str,
    ) -> Result<(Guest, User), ApiError> {
        let full_name = format!("{} {}", req.first_name, req.last_name);
        let guest_query = r#"
                INSERT INTO guests (
                    first_name, last_name, nick_name, email, phone, address_line_1,
                    is_active, guest_type, language_preference, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, true, 'non_member', $7, CURRENT_TIMESTAMP)
                RETURNING id, nick_name, first_name, last_name, email, phone, ic_number, nationality,
                          address_line_1 AS address_line1, city, state AS state_province,
                          postal_code, country, title, alt_phone, is_active, guest_type,
                          tourism_type, COALESCE(discount_percentage, 0) AS discount_percentage,
                          company_name,
                          COALESCE(complimentary_nights_credit, 0) AS complimentary_nights_credit,
                          created_at, updated_at,
                          NULL::BIGINT AS bookings_count,
                          NULL::DATE AS last_stay_date
            "#;

        let guest: Guest = sqlx::query_as(guest_query)
            .bind(&req.first_name)
            .bind(&req.last_name)
            .bind(&full_name)
            .bind(&req.email)
            .bind(&req.phone)
            .bind(&req.address_line1)
            .bind(language_preference)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| {
                if is_guest_name_unique_violation(&error) {
                    ApiError::Conflict(
                        "A guest profile with this name already exists. Please sign in with your existing account or contact the hotel for help."
                            .to_string(),
                    )
                } else {
                    ApiError::from(error)
                }
            })?;

        // The users table historically requires an email. Keep that internal
        // contract without exposing a fake address or triggering verification
        // by using a reserved, non-deliverable domain when email is omitted.
        let account_email = req
            .email
            .clone()
            .unwrap_or_else(|| format!("{}@no-email.invalid", req.username));
        let is_verified = req.email.is_none();
        let user_uuid = crate::core::db::generate_uuid();
        let user_query = r#"
                INSERT INTO users (
                    uuid, username, email, password_hash, full_name, phone,
                    user_type, guest_id, is_active, is_verified, created_at
                )
                VALUES ($8::uuid, $1, $2, $3, $4, $5, 'guest', $6, true, $7, CURRENT_TIMESTAMP)
                RETURNING id, username, email, full_name, phone, is_active, is_verified,
                          user_type, two_factor_enabled, two_factor_secret,
                          two_factor_recovery_codes, created_at, updated_at
            "#;

        let user = sqlx::query_as::<_, User>(user_query)
            .bind(&req.username)
            .bind(account_email)
            .bind(password_hash)
            .bind(&full_name)
            .bind(&req.phone)
            .bind(guest.id)
            .bind(is_verified)
            .bind(user_uuid)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)?;

        Self::grant_guest_role(tx, user.id).await?;

        Ok((guest, user))
    }

    /// Grant the `guest` role to a portal account.
    ///
    /// Shared by registration and by `claim_guest_account` so the two paths
    /// cannot drift on what a guest account is allowed to do. `ON CONFLICT DO
    /// NOTHING` because a claimed anchor account provisioned by front-desk
    /// eKYC may already hold the role.
    async fn grant_guest_role(tx: &mut DbTransaction<'_>, user_id: i64) -> Result<(), ApiError> {
        let guest_role_id: i64 =
            sqlx::query_scalar("SELECT id FROM roles WHERE name = 'guest' LIMIT 1")
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| ApiError::Database(format!("Guest role not found: {}", e)))?;

        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(user_id)
        .bind(guest_role_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;

        Ok(())
    }

    /// Serialize concurrent claims for one guest.
    ///
    /// Two claim requests arriving together would each see "no account yet" and
    /// each insert one, and `find_guest_user`/`find_guest_user_id` both resolve
    /// `ORDER BY id LIMIT 1` — so the loser's account would be permanently
    /// shadowed, including for the eKYC `user_id` it is the anchor for. The
    /// row lock makes the second claim observe the first one's account and fail
    /// the already-claimed check instead.
    pub async fn lock_guest_for_claim(
        tx: &mut DbTransaction<'_>,
        guest_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query("SELECT id FROM guests WHERE id = $1 FOR UPDATE")
            .bind(guest_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    /// The portal account currently attached to a guest profile, if any.
    ///
    /// Mirrors `EkycRepository::find_guest_user`'s `ORDER BY id LIMIT 1` so the
    /// claim decides about the same row eKYC would later resolve. Soft-deleted
    /// accounts are returned rather than skipped: a claim must refuse them, not
    /// silently mint a second account beside one someone deactivated.
    pub async fn find_guest_account(
        tx: &mut DbTransaction<'_>,
        guest_id: i64,
    ) -> Result<Option<GuestAccountRow>, ApiError> {
        sqlx::query_as::<_, GuestAccountRow>(
            "SELECT id, is_active, (password_hash IS NOT NULL) AS has_password, \
             (deleted_at IS NOT NULL) AS is_deleted \
             FROM users WHERE guest_id = $1 AND user_type::text = 'guest' ORDER BY id LIMIT 1",
        )
        .bind(guest_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    /// Bind a login-capable portal account to an EXISTING guest profile.
    ///
    /// Never touches `guests`: the profile already exists (the booking created
    /// it), and inserting another would both duplicate the guest and trip
    /// `idx_guests_full_name_unique`.
    ///
    /// When `existing_user_id` is set, the row is upgraded in place. That row is
    /// the login-disabled anchor `EkycRepository::provision_guest_user` creates
    /// for a front-desk eKYC — inserting a second account beside it would
    /// shadow it for every `ORDER BY id LIMIT 1` lookup, orphaning the eKYC
    /// verification that points at it.
    pub async fn claim_guest_account(
        tx: &mut DbTransaction<'_>,
        values: ClaimGuestAccountValues<'_>,
    ) -> Result<User, ApiError> {
        let ClaimGuestAccountValues {
            existing_user_id,
            guest_id,
            username,
            email,
            password_hash,
            full_name,
            phone,
            is_verified,
        } = values;

        const RETURNING: &str = "RETURNING id, username, email, full_name, phone, is_active, \
             is_verified, user_type, two_factor_enabled, two_factor_secret, \
             two_factor_recovery_codes, created_at, updated_at";

        let user = match existing_user_id {
            Some(user_id) => sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
                "UPDATE users SET username = $1, email = $2, password_hash = $3, \
                     full_name = COALESCE($4, full_name), phone = COALESCE($5, phone), \
                     is_active = true, is_verified = $6, \
                     password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP \
                     WHERE id = $7 {RETURNING}"
            )))
            .bind(username)
            .bind(email)
            .bind(password_hash)
            .bind(full_name)
            .bind(phone)
            .bind(is_verified)
            .bind(user_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)?,
            None => sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
                "INSERT INTO users (username, email, password_hash, full_name, phone, \
                     user_type, guest_id, is_active, is_verified, created_at) \
                     VALUES ($1, $2, $3, $4, $5, 'guest', $6, true, $7, CURRENT_TIMESTAMP) \
                     {RETURNING}"
            )))
            .bind(username)
            .bind(email)
            .bind(password_hash)
            .bind(full_name)
            .bind(phone)
            .bind(guest_id)
            .bind(is_verified)
            .fetch_one(&mut **tx)
            .await
            .map_err(ApiError::from)?,
        };

        Self::grant_guest_role(tx, user.id).await?;

        Ok(user)
    }

    /// Resolves a verified Google identity to an active guest account. The
    /// Google subject is the durable identity; email is used only to link an
    /// unlinked guest during the first successful Google sign-in.
    pub async fn resolve_google_guest(
        pool: &DbPool,
        identity: &GoogleIdentity,
        new_account: Option<&NewGoogleAccountConsent<'_>>,
    ) -> Result<GoogleGuestResolution, ApiError> {
        Self::resolve_google_guest_attempt(pool, identity, 0, new_account).await
    }

    /// Bounded-retry implementation backing `resolve_google_guest`. `attempt`
    /// counts prior retries after losing a unique-constraint race; see
    /// `MAX_GOOGLE_RESOLVE_ATTEMPTS`.
    async fn resolve_google_guest_attempt(
        pool: &DbPool,
        identity: &GoogleIdentity,
        attempt: u8,
        new_account: Option<&NewGoogleAccountConsent<'_>>,
    ) -> Result<GoogleGuestResolution, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        if let Some(user) = sqlx::query_as::<_, User>(
            "SELECT id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE google_subject = $1 AND deleted_at IS NULL FOR UPDATE",
        )
        .bind(&identity.subject)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)? {
            ensure_active_google_guest(&user)?;
            tx.commit().await.map_err(ApiError::from)?;
            return Ok(existing_google_user(user));
        }

        let email_match = sqlx::query_as::<_, User>(
            "SELECT id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE",
        )
        .bind(&identity.email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        if let Some(user) = email_match {
            ensure_active_google_guest(&user)?;
            match user.google_subject.as_deref() {
                Some(subject) if subject == identity.subject => {
                    tx.commit().await.map_err(ApiError::from)?;
                    return Ok(existing_google_user(user));
                }
                Some(_) => {
                    return Err(ApiError::Conflict(
                        "This guest account is already linked to a different sign-in method."
                            .to_string(),
                    ));
                }
                None => {}
            }

            sqlx::query("SAVEPOINT google_subject_link")
                .execute(&mut *tx)
                .await
                .map_err(ApiError::from)?;
            let linked = sqlx::query_as::<_, User>(
                "UPDATE users SET google_subject = $1, is_verified = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND google_subject IS NULL RETURNING id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at",
            )
            .bind(&identity.subject)
            .bind(user.id)
            .fetch_one(&mut *tx)
            .await;

            let linked = match linked {
                Ok(user) => {
                    sqlx::query("RELEASE SAVEPOINT google_subject_link")
                        .execute(&mut *tx)
                        .await
                        .map_err(ApiError::from)?;
                    user
                }
                Err(error) if is_google_subject_unique_violation(&error) => {
                    sqlx::query("ROLLBACK TO SAVEPOINT google_subject_link")
                        .execute(&mut *tx)
                        .await
                        .map_err(ApiError::from)?;
                    sqlx::query("RELEASE SAVEPOINT google_subject_link")
                        .execute(&mut *tx)
                        .await
                        .map_err(ApiError::from)?;
                    let winner = sqlx::query_as::<_, User>(
                        "SELECT id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE google_subject = $1 AND deleted_at IS NULL FOR UPDATE",
                    )
                    .bind(&identity.subject)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(ApiError::from)?
                    .ok_or_else(|| {
                        ApiError::Conflict(
                            "This Google account is already linked to another guest account."
                                .to_string(),
                        )
                    })?;
                    ensure_active_google_guest(&winner)?;
                    tx.commit().await.map_err(ApiError::from)?;
                    return Ok(existing_google_user(winner));
                }
                Err(error) => return Err(ApiError::from(error)),
            };

            tx.commit().await.map_err(ApiError::from)?;
            return Ok(existing_google_user(linked));
        }

        let email_is_already_reserved =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)")
                .bind(&identity.email)
                .fetch_one(&mut *tx)
                .await
                .map_err(ApiError::from)?;
        if email_is_already_reserved {
            // A concurrent first-time sign-in for the same identity can commit
            // between the two lookups above and this one. Those ran on earlier
            // statement snapshots and saw nothing; READ COMMITTED gives this
            // statement a fresh snapshot that does see the winner's row, so
            // the loser rejected an address the winning request had just
            // claimed for this very identity. Resolve it the way every other
            // lost race in this function is resolved -- hand back the winner.
            if let Some(winner) = sqlx::query_as::<_, User>(
                "SELECT id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE google_subject = $1 AND deleted_at IS NULL FOR UPDATE",
            )
            .bind(&identity.subject)
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)?
            {
                ensure_active_google_guest(&winner)?;
                tx.commit().await.map_err(ApiError::from)?;
                return Ok(existing_google_user(winner));
            }

            // Nothing holds this Google subject, so the address genuinely
            // belongs to an account this identity may not take over. A
            // soft-deleted row still occupies users_email_key, which is why
            // this check looks wider than the `deleted_at IS NULL` ones above.
            return Err(ApiError::Conflict(
                "This guest account cannot be linked to Google sign-in.".to_string(),
            ));
        }

        let consent = new_account.ok_or_else(|| {
            ApiError::BadRequest(
                "Consent to the Booking Terms and Conditions is required before this request can be accepted"
                    .to_string(),
            )
        })?;
        consent_validation::validate_locales(consent.consents)?;
        consent_validation::require_consents(
            consent.consents,
            consent_validation::REGISTRATION_REQUIRED,
        )?;

        sqlx::query("SAVEPOINT google_guest_create")
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        let guest_full_name = google_guest_full_name(identity, attempt);
        let display_name = google_display_name(identity);
        let guest_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO guests (first_name, last_name, nick_name, email, is_active, guest_type, language_preference, created_at) VALUES ($1, $2, $3, $4, true, 'non_member', $5, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING RETURNING id",
        )
        .bind(identity.given_name.as_deref())
        .bind(identity.family_name.as_deref())
        .bind(&guest_full_name)
        .bind(&identity.email)
        .bind(consent.language_preference)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        let Some(guest_id) = guest_id else {
            sqlx::query("ROLLBACK TO SAVEPOINT google_guest_create")
                .execute(&mut *tx)
                .await
                .map_err(ApiError::from)?;
            sqlx::query("RELEASE SAVEPOINT google_guest_create")
                .execute(&mut *tx)
                .await
                .map_err(ApiError::from)?;
            if let Some(winner) = sqlx::query_as::<_, User>(
                "SELECT id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE google_subject = $1 AND deleted_at IS NULL FOR UPDATE",
            )
            .bind(&identity.subject)
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)? {
                ensure_active_google_guest(&winner)?;
                tx.commit().await.map_err(ApiError::from)?;
                return Ok(existing_google_user(winner));
            }

            tx.rollback().await.map_err(ApiError::from)?;
            if attempt + 1 >= MAX_GOOGLE_RESOLVE_ATTEMPTS {
                return Err(ApiError::Conflict(
                    "This Google account could not be linked to a guest account. Please try again."
                        .to_string(),
                ));
            }
            return Box::pin(Self::resolve_google_guest_attempt(
                pool,
                identity,
                attempt + 1,
                new_account,
            ))
            .await;
        };

        let username = google_username_for_attempt(identity, attempt);
        let user = sqlx::query_as::<_, User>(
            "INSERT INTO users (uuid, username, email, full_name, user_type, guest_id, is_active, is_verified, google_subject, created_at) VALUES ($1::uuid, $2, $3, $4, 'guest', $5, true, true, $6, CURRENT_TIMESTAMP) ON CONFLICT (username) DO NOTHING RETURNING id, username, email, google_subject, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at",
        )
        .bind(crate::core::db::generate_uuid())
        .bind(&username)
        .bind(&identity.email)
        .bind(&display_name)
        .bind(guest_id)
        .bind(&identity.subject)
        .fetch_optional(&mut *tx)
        .await;

        let user = match user {
            Ok(Some(user)) => {
                sqlx::query("RELEASE SAVEPOINT google_guest_create")
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::from)?;
                user
            }
            Ok(None) => {
                sqlx::query("ROLLBACK TO SAVEPOINT google_guest_create")
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::from)?;
                sqlx::query("RELEASE SAVEPOINT google_guest_create")
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::from)?;
                tx.rollback().await.map_err(ApiError::from)?;
                if attempt + 1 >= MAX_GOOGLE_RESOLVE_ATTEMPTS {
                    return Err(ApiError::Conflict(
                        "This Google account could not be linked to a guest account. Please try again."
                            .to_string(),
                    ));
                }
                return Box::pin(Self::resolve_google_guest_attempt(
                    pool,
                    identity,
                    attempt + 1,
                    new_account,
                ))
                .await;
            }
            Err(error)
                if is_google_subject_unique_violation(&error)
                    || is_user_email_unique_violation(&error) =>
            {
                sqlx::query("ROLLBACK TO SAVEPOINT google_guest_create")
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::from)?;
                sqlx::query("RELEASE SAVEPOINT google_guest_create")
                    .execute(&mut *tx)
                    .await
                    .map_err(ApiError::from)?;
                tx.rollback().await.map_err(ApiError::from)?;
                if attempt + 1 >= MAX_GOOGLE_RESOLVE_ATTEMPTS {
                    return Err(ApiError::Conflict(
                        "This Google account could not be linked to a guest account. Please try again."
                            .to_string(),
                    ));
                }
                return Box::pin(Self::resolve_google_guest_attempt(
                    pool,
                    identity,
                    attempt + 1,
                    new_account,
                ))
                .await;
            }
            Err(error) => return Err(ApiError::from(error)),
        };

        let guest_role_id =
            sqlx::query_scalar::<_, i64>("SELECT id FROM roles WHERE name = 'guest' LIMIT 1")
                .fetch_one(&mut *tx)
                .await
                .map_err(|error| ApiError::Database(format!("Guest role not found: {error}")))?;
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(user.id)
        .bind(guest_role_id)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        consent_service::record_tx(
            &mut tx,
            ConsentSubject::user(user.id).with_guest(guest_id),
            consent.consents,
            ConsentSource::Registration,
            consent.context,
        )
        .await?;

        tx.commit().await.map_err(ApiError::from)?;
        Ok(GoogleGuestResolution {
            user,
            created: true,
            guest_id: Some(guest_id),
        })
    }
}

fn ensure_active_google_guest(user: &User) -> Result<(), ApiError> {
    if user.is_active && user.user_type == Some(UserType::Guest) {
        Ok(())
    } else {
        Err(ApiError::Conflict(
            "Google sign-in is available only for active guest accounts.".to_string(),
        ))
    }
}

fn google_display_name(identity: &GoogleIdentity) -> String {
    let full_name = [
        identity.given_name.as_deref(),
        identity.family_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    let full_name = if full_name.is_empty() {
        "Google guest".to_string()
    } else {
        full_name
    };

    full_name.chars().take(255).collect()
}

fn google_guest_full_name(identity: &GoogleIdentity, attempt: u8) -> String {
    let suffix = if attempt == 0 {
        google_identity_fingerprint(&identity.email, &identity.subject)
    } else {
        crate::core::db::generate_uuid().replace('-', "")
    };
    let suffix = format!(" (Google {suffix})");
    let max_display_len = 255usize.saturating_sub(suffix.len());
    let display_name = google_display_name(identity);

    format!(
        "{}{}",
        display_name
            .chars()
            .take(max_display_len)
            .collect::<String>(),
        suffix
    )
}

fn google_username_for_attempt(identity: &GoogleIdentity, attempt: u8) -> String {
    if attempt == 0 {
        google_username(&identity.email, &identity.subject)
    } else {
        format!(
            "google_{}",
            crate::core::db::generate_uuid().replace('-', "")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_GOOGLE_RESOLVE_ATTEMPTS, ensure_active_google_guest, google_guest_full_name};
    use crate::constants::UserType;
    use crate::models::User;
    use crate::services::google_identity::GoogleIdentity;
    use chrono::Utc;

    #[test]
    fn bounds_google_guest_resolve_retries() {
        assert!((1..=5).contains(&MAX_GOOGLE_RESOLVE_ATTEMPTS));
    }

    fn user(user_type: Option<UserType>, is_active: bool) -> User {
        User {
            id: 1,
            username: "aisha".to_string(),
            email: "aisha.rahman@example.com".to_string(),
            google_subject: None,
            full_name: Some("Aisha Rahman".to_string()),
            phone: Some("+60123456789".to_string()),
            is_active,
            is_verified: true,
            user_type,
            two_factor_enabled: None,
            two_factor_secret: None,
            two_factor_recovery_codes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_login_at: None,
            is_locked: false,
            locked_until: None,
            failed_login_attempts: 0,
            is_super_admin: false,
        }
    }

    #[test]
    fn permits_linking_an_active_guest_account() {
        assert!(ensure_active_google_guest(&user(Some(UserType::Guest), true)).is_ok());
    }

    #[test]
    fn rejects_linking_a_google_identity_to_a_staff_account() {
        assert!(ensure_active_google_guest(&user(Some(UserType::Staff), true)).is_err());
    }

    #[test]
    fn rejects_linking_a_google_identity_to_an_inactive_guest_account() {
        assert!(ensure_active_google_guest(&user(Some(UserType::Guest), false)).is_err());
    }

    #[test]
    fn guest_profile_names_are_distinct_for_unrelated_google_subjects_with_the_same_display_name() {
        let first = GoogleIdentity {
            subject: "google-subject-one".to_string(),
            email: "first@example.com".to_string(),
            email_verified: true,
            given_name: Some("Aisha".to_string()),
            family_name: Some("Rahman".to_string()),
        };
        let second = GoogleIdentity {
            subject: "google-subject-two".to_string(),
            email: "second@example.com".to_string(),
            email_verified: true,
            given_name: Some("Aisha".to_string()),
            family_name: Some("Rahman".to_string()),
        };

        assert_ne!(
            google_guest_full_name(&first, 0),
            google_guest_full_name(&second, 0)
        );
    }
}
