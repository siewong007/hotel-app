# Auth / Session / Credential / Account-Safety Audit

Scope: `hotel-app-be/src/core/auth.rs`, `services/auth.rs`, `handlers/auth.rs`,
`routes/auth.rs`, `services/two_factor.rs`, `services/passkey.rs`,
`services/profile.rs`, `repositories/auth.rs`, plus supporting files read to
trace call chains (`core/middleware.rs`, `routes/mod.rs`, `services/users.rs`,
`core/rbac_cache.rs`, `core/rate_limiter.rs`, `routes/profile.rs`,
`routes/two_factor.rs`, `routes/passkey.rs`, `repositories/passkey.rs`,
`models/auth.rs`, `models/user.rs`, `utils/sanitization.rs`).

All line numbers below were read directly this session (see the Bash/Read
transcript); none are copied from memory or from prior reports.

---

## 1. Brute-force protection on login

Two independent layers, both real:

- **Per-IP rate limiter** — `routes/auth.rs:66-76`: `limiters.auth.check_with_retry(ip)`
  before the login handler even runs. Configured at
  `core/rate_limiter.rs:227`: `RateLimiter::new(RateLimitConfig::new(5, 60))`
  — 5 requests / 60s per IP (`extract_client_ip`, `routes/mod.rs:56-73`, honors
  `X-Forwarded-For`/`X-Real-Ip` only when `trust_proxy_headers` is set).
- **Per-account lockout** — keyed by `users.id`, not username text and not IP:
  - `services/auth.rs:48-49` reads `(is_locked, locked_until, failed_login_attempts)`
    via `repositories/auth.rs:63-74` (`login_lock_state`).
  - `services/auth.rs:81-121`: on a wrong password, `failed_login_attempts` is
    incremented (`repositories/auth.rs:115-127`); at `max_login_attempts`
    (`repositories/auth.rs:93-95`, `settings_cache` key `max_login_attempts`,
    default **5**) the account is locked for **30 minutes**
    (`services/auth.rs:85-97`, `Utc::now() + Duration::minutes(30)`) and
    `AuthService::revoke_all_user_tokens` is called so any already-issued
    sessions die immediately (`services/auth.rs:93-97`).
  - Reset: `services/auth.rs:212`, `reset_login_attempts`
    (`repositories/auth.rs:140-147`) runs only after a **complete** successful
    login (password + 2FA if enabled). Auto-unlock when `locked_until` has
    passed: `services/auth.rs:63` / `refresh_token`'s copy at
    `services/auth.rs:327`.
  - `refresh_token` (`services/auth.rs:289-361`) re-checks `is_locked` on every
    refresh (lines 310-328), so a lock applied mid-session still blocks token
    renewal.

**Finding: 2FA code guesses do not count against the account lockout at all.**
The invalid-TOTP / invalid-recovery-code branch (`services/auth.rs:196-207`)
only logs an audit failure and returns `Unauthorized` — it never calls
`update_failed_login_attempts` or `lock_user_after_failure`. An attacker who
already has a valid username+password can attempt unlimited 6-digit TOTP
guesses against the account with the only defense being the generic 5/min
**per-IP** limiter, which a distributed attacker (botnet / IP rotation)
routes around. See Finding AUTH-06.

**Finding: passkey login checks neither the lockout state nor 2FA.** See §5.

## 2. Password hashing, policy, change/reset paths

- Hashing: `bcrypt` crate v0.19.2 (`Cargo.lock`), `DEFAULT_COST = 12`
  (verified in the crate source,
  `~/.cargo/registry/.../bcrypt-0.19.2/src/lib.rs:28`).
  `core/auth.rs:204-210` (`hash_password`/`verify_password`) call the plain
  `bcrypt::hash`/`verify` (not the `err_on_truncation` variants), so inputs
  over 72 bytes are **silently truncated** by bcrypt itself
  (`bcrypt-0.19.2/src/lib.rs:164-177`).
- Policy (`core/auth.rs:213-257`, `validate_password`): min 8 / max 128 chars,
  needs upper+lower+digit+special (regexes at `core/auth.rs:88-109`), and
  rejects 10 hardcoded weak substrings (`core/auth.rs:111-122`). Since the
  policy allows up to 128 chars but bcrypt truncates at 72 bytes, passwords in
  the 73-128 char range lose effective entropy beyond byte 72 (low severity,
  standard bcrypt gotcha — see AUTH-11).
- Enforcement points, all confirmed live:
  - Register: `services/auth.rs:393`.
  - Admin create user: `services/users.rs:47`.
  - Admin reset a user's password: `services/users.rs:120`.
  - Self-service change: `services/profile.rs:107`.
  So policy IS enforced uniformly on create/change/reset. ✅
- **Current-password requirement**: self-service `update_password`
  (`services/profile.rs:99-136`) requires and verifies
  `input.current_password` (line 110-118) before allowing a change. ✅ Admin
  reset (`services/users.rs`, `UserUpdateInput.password`) does **not** need the
  admin's own password (expected — it's an admin operation gated by
  `check_permission`, not a self-service one).
- **Password reuse / history**: `grep -rln "password_history|previous_password|password_reuse" src/ database/`
  returned **no hits** — there is no reuse/history table or check anywhere in
  the backend. A user (or admin resetting a user) can set the exact same
  password back immediately. Gap, not a hole (AUTH-10, medium).
- Any successful password change revokes **all** existing sessions for that
  user: self-service (`services/profile.rs:125-131`), admin reset
  (`services/users.rs:133-139`), admin deactivate (`services/users.rs:144-152`),
  admin delete (`services/users.rs:185-189`), 2FA disable
  (`services/two_factor.rs:182-184`). All confirmed by reading each call site.
  ✅ Good practice, consistently applied.
- `LoginRequest.password` (`models/auth.rs:14-19`) has **no max-length
  validation** (only `min = 1`), unlike `validate_password`'s 128-char cap used
  on create/change paths. No `DefaultBodyLimit` override exists for the
  `/auth/*` routes (`grep -rn "DefaultBodyLimit" src/` only shows overrides on
  `data_transfer.rs:22` and `guest_portal.rs:29`), so the login endpoint relies
  entirely on axum 0.8.9's implicit default body-size ceiling rather than an
  explicit, intentional cap on the password field itself (AUTH-12, low,
  partially UNVERIFIED — did not independently confirm axum's default-limit
  behavior in this exact router configuration, only that no explicit override
  exists for `/auth`).
- `LoginRequest` derives `Debug` (`models/auth.rs:13`) over a struct that holds
  the raw plaintext `password` field with no redaction. `grep` across
  `handlers/auth.rs`, `routes/auth.rs`, `services/auth.rs` for any
  `{:?}`/`debug!` print of the request found **no active call site** this
  session — this is a dormant risk (a future `log::debug!("{:?}", req)` or a
  generic body-log middleware would leak plaintext passwords), not a
  confirmed leak today (AUTH-13, nit).

## 3. Tokens, refresh cookie, session revocation

- **Access token**: `core/auth.rs:165-193` (`generate_session_jwt`). Claims
  (`core/auth.rs:15-29`): `sub` (user id), `username`, `iss`, `aud`, `exp`
  (omitted entirely in desktop mode — `access_token_expiration`,
  `core/auth.rs:62-68`, returns `None` when `desktop_mode`), `iat`, `roles`,
  and `sid` (the refresh-session id). TTL in non-desktop mode: **30 minutes**
  (`ACCESS_TOKEN_TTL_MINUTES = 30`, `core/auth.rs:43`). `roles` in the JWT is
  informational only — `grep -rn "claims\.roles" src/` returned **zero**
  hits outside the struct definition, so no authorization decision anywhere
  reads the JWT's roles; every permission check goes through
  `AuthService::check_permission` → `rbac_cache::has_permission`
  (`core/auth.rs:489-495`), a live DB-backed (cached) lookup. ✅
- **Session-bound enforcement on every request**:
  `routes/mod.rs:79-122` (`enforce_active_session`) is installed as a global
  middleware on the entire `/api` router (`routes/mod.rs:241-244`,
  `.layer(axum::middleware::from_fn_with_state(pool.clone(), enforce_active_session))`
  applied after merging every domain router including `auth`, `users`, `rbac`,
  `profile`, etc.). For every request carrying a `Bearer` token, it:
  1. Extracts claims (`core/auth.rs:195-202` `verify_jwt`).
  2. Requires `claims.sid` to be present, else `401 "Session-bound
     authentication is required"` (`routes/mod.rs:100-105`).
  3. Calls `AuthService::is_session_active(pool, user_id, session_id)`
     (`core/auth.rs:425-448`), whose SQL requires the refresh-token row to be
     unexpired/unrevoked **AND** `account.is_active = true AND
     account.is_locked = false AND account.deleted_at IS NULL`
     (`core/auth.rs:434-440`).
  So an admin deactivating (`services/users.rs:144-152`), soft-deleting
  (`services/users.rs:171-210`), or the system auto-locking
  (`services/auth.rs:85-97`) a user takes effect on the **very next request**
  from that user, not just at next login/refresh — confirmed by reading the
  exact SQL predicate. ✅ This is a solid, unusual (in a good way) design:
  most JWT-only systems can't do this.
- Refresh flow separately re-checks `is_active`/`is_locked` at
  `services/auth.rs:301-328` and rotates the refresh token atomically
  (`rotate_refresh_token`, `core/auth.rs:331-355`, single-use: the `UPDATE …
  WHERE token_hash = $4` only succeeds once per stored hash, so replay of an
  already-rotated refresh token is rejected — `rotated` false path at
  `services/auth.rs:344-348`).
- **Refresh cookie**: `handlers/auth.rs:36-44` — `HttpOnly=true`,
  `Secure` only outside debug builds and outside desktop mode
  (`refresh_cookie_is_secure`, `handlers/auth.rs:21-23`), `SameSite=Lax`,
  `Path=/api/auth`, `Max-Age=30 days`. (Matches the documented 2026-07-19/2026-07-26
  lessons on SameSite=Lax for Safari; not re-litigated here.)
- **Role/permission revocation latency**: role/permission mutations call
  `crate::core::rbac_cache::invalidate_all()` (confirmed call sites:
  `services/users.rs:166,207`; `services/rbac.rs:94,107,118,130,147,177,212,239,263,289`)
  which the cache module documents as making revocation apply "immediately
  rather than after the TTL" (`core/rbac_cache.rs:11-12`, TTL default 30s,
  `core/rbac_cache.rs:30-34`). So role changes are enforced on the next
  permission check, effectively immediately. ✅
- **Gap noted**: `AuthService::generate_jwt` (`core/auth.rs:133-162`,
  `#[allow(dead_code)]`) mints a token with `sid: None`. `grep -rn
  "generate_jwt(" src/` (excluding its own definition file) returns **no
  callers** — every real login path (`services/auth.rs:231,349`,
  `services/passkey.rs:316`) uses `generate_session_jwt`. So the
  `enforce_active_session` sid-required rejection is not currently reachable
  by any production login flow; the doc-comment on `Claims.sid`
  (`core/auth.rs:25-26`, "Tokens minted before session management
  deliberately omit it and remain valid until their normal expiry") is now
  **inconsistent with the enforcement code**, which rejects a missing `sid`
  outright rather than letting it ride to expiry (AUTH-14, low/doc-only —
  stricter-than-documented, not a vulnerability).

## 4. `is_active` / deletion checked per-request?

Yes, both, on **every** authenticated API call — see §3's
`enforce_active_session` walkthrough (`routes/mod.rs:79-122`,
`core/auth.rs:425-448`: `account.is_active = true … account.deleted_at IS
NULL`). Also re-checked explicitly at login (`services/auth.rs:33-46`), at
`/auth/access` (`services/auth.rs:269-272`, and it proactively revokes tokens
if it finds a stale-active token for a since-deactivated user), and at
`/auth/refresh` (`services/auth.rs:305-308`). No gap found in the files read
this session for the **password/JWT** path. **Passkey login is the
exception** — see §5.

## 5. 2FA enforcement and recovery codes

- **Password login**: enforced. `services/auth.rs:123-210` — if
  `two_factor_enabled`, a `totp_code` is required
  (line 129-141, else `401 "2FA required..."`), verified via
  `AuthService::verify_totp_code` (`core/auth.rs:670-703`, SHA1/6-digit/30s
  step, ±1 window skew tolerance) with a recovery-code fallback
  (`services/auth.rs:156-208`).
- **Refresh**: N/A by design — refresh doesn't re-authenticate, it renews an
  existing session that already passed 2FA at login.
- **Passkey login: 2FA is completely bypassed.**
  `services/passkey.rs:243-338` (`login_finish`) never reads
  `two_factor_enabled`/`two_factor_secret`, never calls
  `verify_totp_code`/`check_recovery_code`, and `grep -n
  "two_factor" src/services/passkey.rs` returns **zero hits**. A user who
  enabled 2FA specifically for stronger protection is fully logged in by
  passkey possession alone. (AUTH-01, high — arguable by design since a
  passkey is itself a strong possession+biometric factor, but it is
  undocumented and inconsistent with every other login path, and combined
  with AUTH-02 below it also skips the account-lockout state.)
- **Passkey login also ignores account lockout.**
  `repositories/passkey.rs:77-88` (`find_active_user_by_username`) filters
  only `is_active = true AND deleted_at IS NULL` — it does **not** filter or
  check `is_locked`/`locked_until` at all, and `services/passkey.rs:243-338`
  never queries `login_lock_state`. An account locked out by repeated failed
  *password* attempts can still be logged into via a registered passkey with
  no additional check. (AUTH-02, high.)
- **Passkey login is never audited.** `grep -n "AuditLog" src/services/passkey.rs`
  returns **zero hits** in the entire 723-line file — no `log_login_success`,
  no `log_login_failure` for a bad signature/expired challenge, no event for
  passkey registration (`register_finish`, lines 114-195) or deletion
  (`delete_passkey`, line 36-47, not read line-by-line but grep confirms no
  `AuditLog` token exists anywhere in the file). Every other login path logs
  success/failure; passkey silently doesn't. (AUTH-03, high — see also §8.)
- **Recovery codes**: hashed at rest via SHA-256
  (`core/auth.rs:639-641,655-667`, reusing `hash_refresh_token`'s hex-SHA256),
  single-use via an atomically-guarded `array_remove`
  (`core/auth.rs:870-890`: `UPDATE … SET two_factor_recovery_codes =
  array_remove(..., $2) WHERE id=$1 AND $2 = ANY(...) RETURNING
  array_length(...)` — a concurrent second use of the same code loses the
  race because the row no longer matches `$2 = ANY(...)`). Comparison is
  constant-time (`constant_time_eq::constant_time_eq`,
  `core/auth.rs:706-728`). ✅ Matches the 2026-07-26p lesson's "fixed" status;
  confirmed independently this session by reading the current file, not by
  trusting the lesson log.
- **2FA brute-force**: no account-level counter (see §1); only the generic
  5/min-per-IP `auth` limiter applies since the TOTP code is submitted as
  part of the same `/auth/login` POST (`models/auth.rs:19`,
  `LoginRequest.totp_code`). (Rolled into AUTH-06.)

## 6. User enumeration (message + timing)

`services/auth.rs:23-121` (`login`) gives **different, distinguishable**
responses depending on account state, all before or independent of a correct
password:

| Case | Code path | Response | Reveals |
|---|---|---|---|
| No such user | `services/auth.rs:41-45` | `401 "Invalid credentials"` | nothing (baseline) |
| User exists, `is_active=false` | `services/auth.rs:34-40` | `401 "Account is inactive"` | account exists + disabled |
| User exists, currently locked | `services/auth.rs:50-62` | `429 "Account is locked... Try again in N minute(s)."` | account exists + locked (+ exact unlock time) |
| User exists, active, unverified email | `services/auth.rs:66-72` | `401 "Please verify your email address..."` | account exists — **and this check runs before the password is even fetched/verified (`password_hash` fetch is at line 74)**, so any string in the password field reaches this branch |
| User exists, wrong password | `services/auth.rs:113-120` | `401 "Invalid credentials. {N} attempt(s) remaining before account lockout."` | account exists (via the presence of the attempts-remaining suffix, contrast with the flat "Invalid credentials" for a nonexistent user) |

**AUTH-04 (blocker): message-based enumeration.** The "wrong password" message
literally differs in text from the "no such user" message (one has an
attempts-remaining suffix, the other doesn't) even though both are nominally
"invalid credentials" — a scripted attacker can distinguish valid from
invalid usernames purely from response body. The unverified-email and
inactive-account branches make it worse by naming the exact reason.

**AUTH-05 (blocker): timing-based enumeration.** For a nonexistent user or an
inactive user, `login()` returns at line 39/44 **before** `password_hash`
(line 74) or `verify_password` (bcrypt cost-12, `core/auth.rs:208-210`) ever
run. For a real, active, verified user with the wrong password, a full bcrypt
verification executes. bcrypt at cost 12 is deliberately slow (tens of
milliseconds), which is trivially distinguishable from a single-digit-ms DB
lookup-and-return over a network timing measurement, independent of the
message content in AUTH-04. No dummy/constant-time hash comparison is
performed for the not-found/inactive paths.

**Contrast — done correctly**: `resend_verification`
(`services/auth.rs:466-488`) returns the exact same
`generic_verification_response()` (`services/auth.rs:490-494`) whether the
user doesn't exist (line 475-477), is already verified (line 479-481), or
really gets a new token (line 483-487) — this is the right pattern and shows
the team already knows how to do it; login just doesn't follow it. There is
**no separate forgot-password/reset-password flow** in this backend at all
(`grep -rln "forgot_password|reset_password|password_reset" src/` returned no
hits) — Q6's reset-flow sub-question doesn't apply; only the admin-reset path
in `services/users.rs` exists, which is permission-gated, not
self-service/unauthenticated.

**AUTH-07 (low)**: `resend_verification`'s not-found/already-verified branches
return immediately while the real case does an extra async DB write
(`create_email_verification_token`), a residual timing side-channel smaller
than AUTH-05 but present.

**AUTH-08 (low)**: passkey `login_start` (`services/passkey.rs:197-238`)
returns `404 "User not found"` for both a nonexistent username and — because
`find_active_user_by_username` filters `is_active=true`
(`repositories/passkey.rs:82`) — a deactivated one (no differentiation there,
good), but a **different** `404 "No passkeys found for this user"`
(`services/passkey.rs:206-209`) when the account is real, active, and has no
registered passkey, which is itself a (weaker) existence oracle.

## 7. Unsanitized user input reaching SQL / logs / errors

- All SQL in the audited files uses bound parameters (`$1`, `$2`, ...) — no
  string interpolation into query text found in
  `core/auth.rs`/`services/auth.rs`/`repositories/auth.rs`/`services/two_factor.rs`/
  `services/passkey.rs`/`services/profile.rs`. Confirmed by reading every
  `sqlx::query`/`query_as`/`query_scalar` call in these files.
- `AuditRepository::insert_event`/`insert_event_tx`
  (`repositories/audit.rs:17-51`) bind every field including `details`
  (JSONB) and `ip_address` (`$6::inet`) — parameterized, no injection risk.
- `Sanitizer` (`utils/sanitization.rs`) IS applied to free text on: register
  (`services/auth.rs:379-392`: email/phone/address/first+last name), admin
  user create/update (`services/users.rs:38-44,227-231`), and self-service
  profile update (`services/profile.rs:29-38`: full_name/email/phone/avatar_url).
- **Gap (AUTH-09, low/medium)**: `req.username` in `login()` is passed
  **unsanitized** into the audit-log `details` JSON at all 7
  `log_login_failure` call sites (`services/auth.rs:37,42,56,99,116,130,198`
  each pass `&req.username` straight through) and the raw username is also
  what the audit log stores for a failed attempt. Since it's bound as a JSONB
  parameter this is not a SQL-injection risk, but it is exactly the kind of
  free text `Sanitizer::sanitize_text`/`sanitize_html` exists to clean before
  it is later rendered in an admin-facing audit-log UI — a
  `<script>`-containing "username" in a failed login attempt is stored
  verbatim. Did not verify the frontend audit-log viewer's rendering
  (out of scope for this backend-focused pass) — labeled **UNVERIFIED**
  whether this is exploitable as stored XSS downstream, but the raw storage
  itself is confirmed.
- **Confirmed missing forensic data (AUTH-15, traceability, high)**: every one
  of the 8 `log_login_failure`/`log_login_success` call sites in
  `services/auth.rs` (lines 37, 42, 56, 99, 116, 130, 198, 248) passes literal
  `None, None` for `ip_address`/`user_agent`, **even though `login()` receives
  both as real parameters** (`services/auth.rs:26-27`) and the caller
  (`handlers/auth.rs:58-69`, `routes/auth.rs:58-89`) does extract a real
  client IP and User-Agent — they are used **only** for
  `store_refresh_token` (`services/auth.rs:228`), never forwarded to the
  audit trail. Every login success/failure row in `audit_logs` is therefore
  IP-less and UA-less, which materially weakens brute-force forensics (can't
  tell if failures cluster on one IP or came from a botnet) and incident
  response ("was this login from the usual device?").

## 8. Self-service danger: what can a user do to their own account?

| Action | Route | Re-auth required? | Audited? |
|---|---|---|---|
| Change full_name/email/phone/avatar_url | `PATCH /profile` → `services/profile.rs:23-97` | **No** — `UserProfileUpdate` (`models/user.rs:118-131`) has no current-password/2FA field at all | **No** — `grep -n "AuditLog" src/services/profile.rs` shows it only appears in `update_password` (line 133) and `revoke_session` (line 169); `update_user_profile` (lines 23-97) has zero `AuditLog` calls |
| Change password | `POST /profile/password` → `services/profile.rs:99-136` | Yes, current password verified (line 110-118) | Yes, `log_password_changed` (line 133) |
| List/revoke own sessions | `GET/DELETE /profile/sessions[/{id}]` → `services/profile.rs:138-183` | Implicit (valid session required) | Revoke is audited (`session_revoked`, line 169-180); listing is read-only |
| Register a new passkey | `POST /auth/passkey/register/{start,finish}` → `services/passkey.rs:61-195` | Only the existing access token (`require_auth`, `routes/passkey.rs:46,69`) — no password/2FA step-up | **No** — zero `AuditLog` calls in the file |
| Delete/update a passkey | `handlers::passkey` (routed, not read line-by-line this session) | Only the existing access token | Not verified this session (out of scope file) |
| Enable/disable 2FA, regenerate backup codes | `services/two_factor.rs` | Enable requires a fresh TOTP+single-use setup challenge (line 84-96); disable requires TOTP-or-recovery-code (line 161-171); regenerate requires TOTP (line 266-271) | Yes — every one of these logs an `AuditLog::log_event` (lines 50-61, 100-111, 122-133, 186-197, 278-289) |

**AUTH-16 (high): self-service profile changes (including email address) are
neither re-authenticated nor audited.** `UserProfileUpdate`
(`models/user.rs:118-131`) carries no current-password/2FA field, and
`update_user_profile` (`services/profile.rs:23-97`) never calls `AuditLog`.
For a non-guest user, changing `email` (`services/profile.rs:85-87`,
`else if email_changed { UserRepository::update_email(...) }`) takes effect
**immediately with no verification token at all** — the email-verification
token path (`services/profile.rs:59-84`) is gated behind `is_guest &&
email_changed`, so it only applies to guest self-service accounts; a
non-guest (staff/admin) user's email is changed outright. Combined with
in-memory-access-token storage (per repo history/lessons: an XSS-stolen
short-lived access token would be enough), an attacker who obtains a live
access token can silently redirect the account's email (and thus any
future "forgot admin password, contact IT" recovery flow keyed off email)
with **zero audit trail** and no re-authentication challenge. This is the
single highest-value self-service gap found in this pass.

**AUTH-17 (medium): passkey registration has no step-up re-authentication.**
It's gated behind a valid access token (`require_auth`) but registering a new
persistent credential (able to fully log in later, bypassing password and —
per AUTH-01 — 2FA) should arguably require a fresh password or 2FA challenge,
the same way `enable_2fa`/`disable_2fa` require a fresh TOTP code. It
currently doesn't, and (AUTH-03) isn't audited either.

## Additional finding: duplicate, independently-rate-limited 2FA route surface

`routes/two_factor.rs:19-26` wires
`/api/auth/2fa/{setup,enable,disable,status,verify}` plus
`regenerate_backup_codes`, and `routes/profile.rs:34-39` independently wires
`/api/profile/2fa/{setup,enable,disable,status,verify}` — **both** are merged
into the live router (`routes/mod.rs:226` `.merge(profile::routes())` and
`routes/mod.rs:239` `.merge(two_factor::routes())`), so there are genuinely
two separate, fully-reachable URL paths to the exact same
`services::two_factor` functions. This is not dead code (correcting an
earlier draft of this report that misread the merge list) — it is duplicate
API surface that must be kept in sync by hand. Both wirings were re-read in
full this session and both DO apply `limiters.sensitive.check_with_retry(ip)`
consistently (`routes/two_factor.rs:40,62,84,114,136` and
`routes/profile.rs:145,167,189,219`) — no rate-limiter divergence today. The
one real asymmetry: `regenerate_backup_codes` (`services/two_factor.rs:248-295`)
is reachable **only** via `/api/auth/2fa/regenerate-backup-codes`
(`routes/two_factor.rs:26-29`) — `routes/profile.rs:22-39`'s route list has
no `/profile/2fa/regenerate-backup-codes` equivalent, so the two route
files are not a clean 1:1 duplicate, just a 5-of-6 overlap plus one
uniquely-placed endpoint. Whoever collapses these during the user-module
migration must preserve `regenerate_backup_codes` specifically, and should
verify the frontend actually calls the `/api/auth/2fa/*` prefix for that one
action (not checked this session — backend-only scope). (AUTH-18,
maintainability, medium.)

---

## Findings summary (severity-ordered)

| ID | Severity | Category | One-line |
|---|---|---|---|
| AUTH-04 | blocker | security | Login differentiates "no such user" vs "wrong password" vs "unverified"/"inactive" by response text — user enumeration |
| AUTH-05 | blocker | security | Login skips bcrypt entirely for nonexistent/inactive users, creating a timing oracle for user enumeration |
| AUTH-16 | high | security | Self-service profile update (incl. email) needs no re-auth and is never audited |
| AUTH-01 | high | security | Passkey login never checks `two_factor_enabled` — full 2FA bypass |
| AUTH-02 | high | security | Passkey login never checks `is_locked`/`locked_until` — account-lockout bypass |
| AUTH-03 | high | traceability | Passkey login/registration produces zero audit-log rows |
| AUTH-15 | high | traceability | Every login success/failure audit row has `ip_address`/`user_agent` hardcoded to `None` despite the data being available |
| AUTH-06 | medium | security | 2FA/TOTP guesses never increment the account lockout counter; only a generic per-IP limiter applies |
| AUTH-10 | medium | correctness | No password reuse/history check anywhere |
| AUTH-17 | medium | security | Passkey registration has no step-up re-auth for a persistent, 2FA-bypassing credential |
| AUTH-18 | medium | dead-code | `routes/two_factor.rs`'s `/auth/2fa/*` endpoints are built but never merged into the router |
| AUTH-09 | low/medium | security | `req.username` reaches the audit log unsanitized (stored, not executed — downstream XSS risk unverified) |
| AUTH-08 | low | security | Passkey `login_start` differentiates "no such user" from "no passkeys registered" |
| AUTH-07 | low | security | `resend_verification` has a residual timing difference between existing/non-existing accounts |
| AUTH-11 | low | correctness | bcrypt silently truncates at 72 bytes while the app's password policy allows up to 128 |
| AUTH-12 | low | correctness | Login `password` field has no max-length validation, unlike create/change paths (partially unverified re: axum body-limit default) |
| AUTH-13 | nit | maintainability | `LoginRequest` derives `Debug` over a raw plaintext password field (no active leak found, dormant risk) |
| AUTH-14 | nit | maintainability | `Claims.sid` doc-comment ("remain valid until normal expiry" for sid-less tokens) contradicts `enforce_active_session`, which rejects them outright |

Positive findings worth preserving during the module migration (do not
regress these): per-request `is_active`/`is_locked`/`deleted_at` enforcement
via `enforce_active_session`; hashed + single-use recovery codes with a
race-proof `array_remove`; RBAC cache invalidated synchronously on every
role/permission mutation; password-change/deactivate/delete/2FA-disable all
revoke every existing session; `resend_verification`'s uniform response
pattern (the template AUTH-04 should be copied from).
