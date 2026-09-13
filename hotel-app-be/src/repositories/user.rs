//! User repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    StaffDirectoryEntry, StaffDirectoryQuery, User, UserCreateInput, UserProfile, UserUpdateInput,
};
use crate::param;

const UNCONFIGURED_EMAIL_PATTERN: &str = "%@no-email.invalid";

/// Column list backing every query that decodes a [`User`]. Kept in one place so
/// the struct and its queries cannot drift apart. Columns after
/// `two_factor_recovery_codes` are administration state; the model marks them
/// `#[sqlx(default)]` so narrower projections still decode.
const USER_COLUMNS: &str = "id, username, email, full_name, phone, is_active, is_verified, \
     user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, \
     created_at, updated_at, last_login_at, is_locked, locked_until, \
     failed_login_attempts, is_super_admin";

pub struct UserRepository;

impl UserRepository {
    /// Find a user by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "SELECT {USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL"
        )))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// List every non-deleted *staff* user, for administration screens.
    /// Guest-portal accounts share the `users` table (`user_type = 'guest'`)
    /// and must never appear in staff administration lists.
    pub async fn list_all(pool: &DbPool) -> Result<Vec<User>, ApiError> {
        sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "SELECT {USER_COLUMNS} FROM users \
             WHERE deleted_at IS NULL AND user_type = 'staff' ORDER BY username"
        )))
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Paginated staff directory: search across identity columns, filter by
    /// account status or role name, whitelist-sorted. `status` accepts
    /// `active` | `suspended` | `locked`.
    pub async fn list_staff_directory(
        pool: &DbPool,
        query: &StaffDirectoryQuery,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<StaffDirectoryEntry>), ApiError> {
        let search = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{}%", value.to_lowercase()));
        let status = query
            .status
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let role = query
            .role
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        let sort_column = match query.sort_by.as_deref() {
            Some("email") => "u.email",
            Some("full_name") => "u.full_name",
            Some("last_login_at") => "u.last_login_at",
            Some("created_at") => "u.created_at",
            Some("is_active") => "u.is_active",
            _ => "u.username",
        };
        let sort_order = if query
            .sort_order
            .as_deref()
            .is_some_and(|order| order.eq_ignore_ascii_case("desc"))
        {
            "DESC"
        } else {
            "ASC"
        };

        // Filtered set of staff ids first (count + page), then a second read
        // joins roles for just the page — one round trip, no row bloat.
        let ids_sql = format!(
            "SELECT u.id FROM users u \
             WHERE u.deleted_at IS NULL AND u.user_type = 'staff' \
               AND ($1::text IS NULL OR ( \
                    lower(u.username) LIKE $1 OR lower(u.email) LIKE $1 \
                    OR lower(COALESCE(u.full_name, '')) LIKE $1 \
                    OR lower(COALESCE(u.phone, '')) LIKE $1)) \
               AND ($2::text IS NULL OR ( \
                    ($2 = 'active' AND u.is_active AND NOT u.is_locked) OR \
                    ($2 = 'suspended' AND NOT u.is_active) OR \
                    ($2 = 'locked' AND u.is_locked))) \
               AND ($3::text IS NULL OR EXISTS ( \
                    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id \
                    WHERE ur.user_id = u.id AND r.name = $3)) \
             ORDER BY {sort_column} {sort_order}, u.id \
             LIMIT $4 OFFSET $5"
        );

        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users u \
             WHERE u.deleted_at IS NULL AND u.user_type = 'staff' \
               AND ($1::text IS NULL OR ( \
                    lower(u.username) LIKE $1 OR lower(u.email) LIKE $1 \
                    OR lower(COALESCE(u.full_name, '')) LIKE $1 \
                    OR lower(COALESCE(u.phone, '')) LIKE $1)) \
               AND ($2::text IS NULL OR ( \
                    ($2 = 'active' AND u.is_active AND NOT u.is_locked) OR \
                    ($2 = 'suspended' AND NOT u.is_active) OR \
                    ($2 = 'locked' AND u.is_locked))) \
               AND ($3::text IS NULL OR EXISTS ( \
                    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id \
                    WHERE ur.user_id = u.id AND r.name = $3))",
        )
        .bind(search.as_deref())
        .bind(status)
        .bind(role)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let rows = sqlx::query_as::<_, StaffDirectoryEntry>(sqlx::AssertSqlSafe(format!(
            "SELECT u.id, u.username, u.email, u.full_name, u.phone, \
                    u.is_active, u.is_verified, u.is_locked, u.is_super_admin, \
                    u.last_login_at, u.created_at, u.updated_at, \
                    COALESCE(array_agg(r.name ORDER BY r.name) \
                             FILTER (WHERE r.name IS NOT NULL), '{{}}') AS roles \
             FROM users u \
             LEFT JOIN user_roles ur ON ur.user_id = u.id \
             LEFT JOIN roles r ON r.id = ur.role_id \
             WHERE u.id IN ({ids_sql}) \
             GROUP BY u.id \
             ORDER BY {sort_column} {sort_order}, u.id"
        )))
        .bind(search.as_deref())
        .bind(status)
        .bind(role)
        .bind(page_size)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok((total, rows))
    }

    /// The linked guest record for a user, if any. `Ok(None)` covers both "no
    /// such active user" and "user exists but is not a guest account" — callers
    /// that need the profile-completion verdict treat both the same way (a
    /// non-guest account has nothing to complete).
    pub async fn guest_id_for_user(pool: &DbPool, user_id: i64) -> Result<Option<i64>, ApiError> {
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT guest_id FROM users WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map(|value| value.flatten())
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Whether a non-deleted user with this id exists.
    pub async fn exists(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        let id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL")
                .bind(user_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(id.is_some())
    }

    /// Whether the username or email is already taken by a *different* user.
    pub async fn username_or_email_exists_for_other(
        pool: &DbPool,
        user_id: i64,
        username: Option<&str>,
        email: Option<&str>,
    ) -> Result<bool, ApiError> {
        let id: Option<i64> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM users
            WHERE deleted_at IS NULL
              AND id != $1
              AND (
                ($2::text IS NOT NULL AND username = $2)
                OR ($3::text IS NOT NULL AND email = $3)
              )
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .bind(username)
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(id.is_some())
    }

    /// Create a user and assign its initial roles in one transaction.
    pub async fn create_with_roles(
        pool: &DbPool,
        input: &UserCreateInput,
        password_hash: &str,
        role_ids: &[i64],
    ) -> Result<User, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let user = sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "INSERT INTO users (username, email, password_hash, full_name, phone, is_active, is_verified) \
             VALUES ($1, $2, $3, $4, $5, true, true) \
             RETURNING {USER_COLUMNS}"
        )))
        .bind(&input.username)
        .bind(&input.email)
        .bind(password_hash)
        .bind(&input.full_name)
        .bind(&input.phone)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        for role_id in role_ids {
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(user.id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(user)
    }

    /// Apply an administrative partial update. `None` fields are left untouched.
    pub async fn admin_update(
        pool: &DbPool,
        user_id: i64,
        input: &UserUpdateInput,
        password_hash: Option<&str>,
    ) -> Result<User, ApiError> {
        sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "UPDATE users \
             SET username = COALESCE($2, username), \
                 email = COALESCE($3, email), \
                 full_name = COALESCE($4, full_name), \
                 phone = COALESCE($5, phone), \
                 is_active = COALESCE($6, is_active), \
                 password_hash = COALESCE($7, password_hash), \
                 updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING {USER_COLUMNS}"
        )))
        .bind(user_id)
        .bind(input.username.as_deref())
        .bind(input.email.as_deref())
        .bind(input.full_name.as_deref())
        .bind(input.phone.as_deref())
        .bind(input.is_active)
        .bind(password_hash)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))
    }

    /// Soft-delete a user and drop its role assignments in one transaction.
    pub async fn soft_delete(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let result = sqlx::query(
            r#"
            UPDATE users
            SET is_active = false,
                deleted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(result.rows_affected() > 0)
    }

    /// Get user profile
    pub async fn get_profile(pool: &DbPool, user_id: i64) -> Result<Option<UserProfile>, ApiError> {
        let query = r#"
                SELECT id, username,
                       CASE WHEN email LIKE '%@no-email.invalid' THEN '' ELSE email END AS email,
                       CASE WHEN email LIKE '%@no-email.invalid' THEN false ELSE true END AS email_configured,
                       is_verified, user_type, full_name, phone, avatar_url,
                       created_at, updated_at, last_login_at
                FROM users
                WHERE id = $1 AND is_active = true AND deleted_at IS NULL
            "#;
        sqlx::query_as::<_, UserProfile>(query)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn email_exists_for_other_user(
        pool: &DbPool,
        user_id: i64,
        email: &str,
    ) -> Result<bool, ApiError> {
        let query = format!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email) = LOWER({}) AND id <> {})",
            param!(1),
            param!(2)
        );
        sqlx::query_scalar(sqlx::AssertSqlSafe(&*query))
            .bind(email)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Configure a guest account's first real email and mirror it to the linked
    /// guest record. The placeholder guard makes this a one-time transition.
    ///
    /// Deliberately writes NO verification token. It used to store the RAW
    /// token while `AuthService::verify_email_token` matches on the SHA-256
    /// hash, so the stored value could never match and the address could never
    /// be verified — on top of which nothing ever sent the guest a link. The
    /// caller now hands the account to `services::account_emails`, which mints,
    /// hashes and mails the token in one step; the columns are cleared here so
    /// no unusable token outlives this call.
    pub async fn configure_guest_email(
        pool: &DbPool,
        user_id: i64,
        email: &str,
    ) -> Result<bool, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let update_user = format!(
            "UPDATE users SET email = {}, is_verified = false, email_verification_token = NULL, \
             email_token_expires_at = NULL, updated_at = CURRENT_TIMESTAMP \
             WHERE id = {} AND user_type = 'guest' AND email LIKE {}",
            param!(1),
            param!(2),
            param!(3)
        );
        let result = sqlx::query(sqlx::AssertSqlSafe(&*update_user))
            .bind(email)
            .bind(user_id)
            .bind(UNCONFIGURED_EMAIL_PATTERN)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Ok(false);
        }

        let update_guest = format!(
            "UPDATE guests SET email = {}, updated_at = CURRENT_TIMESTAMP \
             WHERE id = (SELECT guest_id FROM users WHERE id = {})",
            param!(1),
            param!(2)
        );
        sqlx::query(sqlx::AssertSqlSafe(&*update_guest))
            .bind(email)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        tx.commit().await.map_err(ApiError::from)?;
        Ok(true)
    }

    /// Flip `is_active` for a staff account. Returns the updated user.
    pub async fn set_active(
        pool: &DbPool,
        user_id: i64,
        is_active: bool,
    ) -> Result<User, ApiError> {
        sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "UPDATE users SET is_active = $2, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL AND user_type = 'staff' \
             RETURNING {USER_COLUMNS}"
        )))
        .bind(user_id)
        .bind(is_active)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Staff user not found".to_string()))
    }

    /// Clear the login lockout state (`is_locked`, `locked_until`,
    /// `failed_login_attempts`) without touching any other account field.
    pub async fn clear_lockout(pool: &DbPool, user_id: i64) -> Result<User, ApiError> {
        sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "UPDATE users SET is_locked = false, locked_until = NULL, \
                    failed_login_attempts = 0, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL AND user_type = 'staff' \
             RETURNING {USER_COLUMNS}"
        )))
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Staff user not found".to_string()))
    }

    /// How many active super-admins exist — the last one must not be
    /// suspendable or the permission catalogue becomes unmanageable.
    pub async fn count_active_super_admins(pool: &DbPool) -> Result<i64, ApiError> {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM users \
             WHERE is_super_admin AND is_active AND deleted_at IS NULL \
               AND user_type = 'staff'",
        )
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create an invited staff account: no password yet, unverified, active.
    /// The invite token is minted separately by the service layer so the two
    /// writes stay in this transaction's commit boundary.
    pub async fn create_invited_with_roles(
        pool: &DbPool,
        invite: &NewInvite<'_>,
    ) -> Result<User, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let user = sqlx::query_as::<_, User>(sqlx::AssertSqlSafe(format!(
            "INSERT INTO users (username, email, password_hash, full_name, phone, \
                    is_active, is_verified, user_type, email_verification_token, \
                    email_token_expires_at) \
             VALUES ($1, $2, NULL, $3, $4, true, false, 'staff', $5, $6) \
             RETURNING {USER_COLUMNS}"
        )))
        .bind(invite.username)
        .bind(invite.email)
        .bind(invite.full_name)
        .bind(invite.phone)
        .bind(invite.token_hash)
        .bind(invite.token_expires_at)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        for role_id in invite.role_ids {
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(user.id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(user)
    }

    /// Whether a *staff* account still has a pending invitation (password not
    /// yet set). Used to decide whether a resend is meaningful.
    pub async fn invitation_pending(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND user_type = 'staff' \
             AND deleted_at IS NULL AND password_hash IS NULL)",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Accept an invitation: the hashed token must match a staff account whose
    /// password is still NULL and whose token has not expired. Sets the first
    /// password, marks the account verified and clears the token in one update.
    /// Returns the user id on success.
    pub async fn accept_invitation(
        pool: &DbPool,
        token_hash: &str,
        password_hash: &str,
    ) -> Result<Option<i64>, ApiError> {
        sqlx::query_scalar(
            "UPDATE users SET password_hash = $2, is_verified = true, \
                    email_verification_token = NULL, email_token_expires_at = NULL, \
                    password_changed_at = CURRENT_TIMESTAMP, \
                    updated_at = CURRENT_TIMESTAMP \
             WHERE email_verification_token = $1 \
               AND email_token_expires_at > CURRENT_TIMESTAMP \
               AND password_hash IS NULL AND user_type = 'staff' \
               AND deleted_at IS NULL \
             RETURNING id",
        )
        .bind(token_hash)
        .bind(password_hash)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Re-mint an invite token for a still-passwordless staff account.
    pub async fn refresh_invite_token(
        pool: &DbPool,
        user_id: i64,
        token_hash: &str,
        token_expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query(
            "UPDATE users SET email_verification_token = $2, email_token_expires_at = $3, \
                    updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND user_type = 'staff' AND password_hash IS NULL \
               AND deleted_at IS NULL",
        )
        .bind(user_id)
        .bind(token_hash)
        .bind(token_expires_at)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
        Ok(result.rows_affected() == 1)
    }

    /// Get password hash for a user
    pub async fn get_password_hash(pool: &DbPool, user_id: i64) -> Result<String, ApiError> {
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn update_full_name(
        pool: &DbPool,
        user_id: i64,
        full_name: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(full_name)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_email(pool: &DbPool, user_id: i64, email: &str) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(email)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_phone(pool: &DbPool, user_id: i64, phone: &str) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET phone = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(phone)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_avatar_url(
        pool: &DbPool,
        user_id: i64,
        avatar_url: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(avatar_url)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_password_hash(
        pool: &DbPool,
        user_id: i64,
        password_hash: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE users
            SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            "#,
        )
        .bind(password_hash)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_two_factor_secret(
        pool: &DbPool,
        user_id: i64,
        secret: &str,
    ) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET two_factor_secret = $1 WHERE id = $2")
            .bind(secret)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }
}

/// Everything needed to insert an invited (passwordless) staff account in one
/// transaction. The token is already hashed — the raw value never reaches the
/// repository.
pub struct NewInvite<'a> {
    pub username: &'a str,
    pub email: &'a str,
    pub full_name: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub role_ids: &'a [i64],
    pub token_hash: &'a str,
    pub token_expires_at: chrono::DateTime<chrono::Utc>,
}
