# Adversarial verification: AUTH findings (2026-07-27)

Scope: hotel-app-be auth/session/credential/account-safety findings AUTH-01..AUTH-18 (subset supplied).
Method: opened every cited file at the cited line myself; re-derived each claim from source; grepped for
absence claims with exact commands/output noted below.

## Per-finding verdicts

### AUTH-04 — login message enumeration
CONFIRMED as fact. Re-read services/auth.rs:33-120:
- L34/39: `Some(_) if !is_active` branch (actually line 34 match guard, return at L39) → "Account is inactive"
- L41/44: `None` branch → "Invalid credentials"
- L68-71: unverified-email branch, returns BEFORE `password_hash` fetch at L74 → "Please verify your email address..."
- L117-120: wrong-password branch → "Invalid credentials. {N} attempt(s) remaining before account lockout."
All four message shapes are textually distinguishable. Evidence is accurate.
Severity judgment: auditor said "blocker". I corrected to **medium** — this is a genuine enumeration
oracle that aids follow-on attacks, but by itself grants no access and is throttled by the existing
5-req/60s per-IP `auth` rate limiter (core/rate_limiter.rs:227, confirmed below). Reserving "blocker" for
findings that themselves yield unauthorized access or data (e.g. AUTH-01/02) keeps the severities ordered
sensibly; enumeration is high-value recon, not compromise.

### AUTH-05 — timing enumeration
CONFIRMED as fact: None/inactive branches (services/auth.rs:33-46) return before `password_hash` (L74) is
fetched or `verify_password`/bcrypt ever runs (L77-79 only reached for existing+active+verified users).
Severity judgment: corrected to **low**. This is a secondary, much harder-to-exploit vector than AUTH-04
— AUTH-04 already leaks the same information for free via response body text, so an attacker gains
nothing by resorting to statistical timing analysis over a network. Kept as a real defect (worth fixing
via a dummy-hash comparison on the None/inactive paths) but not independently "blocker".

### AUTH-16 — profile update: no reauth, no audit
CONFIRMED, fully. Verified:
- services/profile.rs: `update_user_profile` spans L23-97, zero `AuditLog::` calls inside it (only
  `update_password` L133 and `revoke_session` L169 call AuditLog in this file — confirmed by reading the
  whole 193-line file).
- models/user.rs:118-131 `UserProfileUpdate` has exactly `full_name, email, phone, avatar_url` — no
  current-password/2FA field (grep + Read confirmed).
- profile.rs L85-87: `} else if email_changed { UserRepository::update_email(...) }` — reached whenever
  `is_guest` is false (i.e. every staff/admin account), no verification token, no reauth.
- handlers/profile.rs:23-30 `update_user_profile_handler` — only extracts `user_id` from the auth
  extension, calls the service, no audit/reauth at the handler layer either.
- Repo-wide grep for `step_up|reauth|re_auth|fresh_auth` returns ONLY unrelated hits (`require_auth`
  identifier substring) — there is no step-up-auth mechanism anywhere in hotel-app-be.
Severity: confirmed as stated (**high**). No correction.

### AUTH-01 — passkey login skips 2FA
CONFIRMED, fully. `login_finish` (services/passkey.rs:243-337) has zero `two_factor` references;
`grep -n "two_factor" src/services/passkey.rs` → no matches (verified this session). Corroborating detail
not in the original evidence: `repositories/passkey.rs:77-88` (`find_active_user_by_username`) actually
SELECTs `two_factor_enabled, two_factor_secret, two_factor_recovery_codes` into the returned `User` — the
data is fetched into memory and then simply never consulted by `login_finish`. Severity: confirmed **high**.

### AUTH-02 — passkey login ignores lockout
CONFIRMED, fully. `repositories/passkey.rs:82` query WHERE clause is exactly
`WHERE username = $1 AND is_active = true AND deleted_at IS NULL` — no `is_locked`/`locked_until` filter.
`grep -n "login_lock_state\|is_locked\|locked_until" src/services/passkey.rs src/repositories/passkey.rs`
→ no matches (verified this session). Severity: confirmed **high**.

### AUTH-03 — passkey zero audit trail
CONFIRMED, fully. `grep -n "AuditLog" src/services/passkey.rs` → no matches (verified this session, whole
723-line file). Severity: confirmed **high**.

### AUTH-15 — login audit missing IP/UA
CONFIRMED, fully. All 8 call sites verified at the cited lines (37, 42, 56, 99, 116, 130, 198, 248) —
every one passes literal `None, None`. `services/audit.rs:60-65` and `:88-93` confirm
`log_login_success`/`log_login_failure` accept real `Option<String>` ip/user-agent params (so this is a
choice not to pass them, not a signature limitation). `handlers/auth.rs:58-66` confirms `login_handler`
does receive real `ip_address`/`user_agent` and threads them into `svc::login` — they are used only for
`store_refresh_token` (services/auth.rs:228), never forwarded to any audit call.
Nuance the auditor didn't note: for SUCCESSFUL logins the IP/UA are still recoverable indirectly via the
`refresh_tokens` row created in the same request (core/auth.rs `store_refresh_token` persists both), so
forensics there is degraded but not fully blind. For FAILED logins no session row is ever created, so the
IP/UA are genuinely unrecoverable anywhere in the system — the failure-path gap is the real teeth of this
finding. Severity: confirmed as stated (**high**), with that nuance noted.

### AUTH-06 — 2FA brute force, no lockout
CONFIRMED, fully. The invalid-TOTP/invalid-recovery-code branch is services/auth.rs:197-207 (`None => {`
at L197, auditor cited L196 which is the previous arm's closing brace — trivial off-by-one, region is
otherwise exactly right); it logs failure and returns, never touches
`update_failed_login_attempts`/`lock_user_after_failure`. Rate-limiter claim verified:
core/rate_limiter.rs:227 is exactly `auth: RateLimiter::new(RateLimitConfig::new(5, 60))`, and
`routes/auth.rs:67` confirms the login endpoint (which carries `totp_code` in the same request) uses
`limiters.auth`. Severity: confirmed as stated (**medium**).

### AUTH-10 — no password history
CONFIRMED. `grep -rniE "password_history|previous_password|password_reuse" src/ database/` → zero hits
(exit 1, verified this session). Also checked there is no separate admin-reset-password path that might
carry its own history check (`grep -rn "fn.*reset_password\|fn.*change_password\|fn.*update_password"
src/` → only the one path already cited). Severity: confirmed as stated (**medium**).

### AUTH-17 — passkey registration, no step-up
CONFIRMED, fully. `routes/passkey.rs:46` and `:69` are exactly `require_auth(&headers).await?` with no
further check before calling `register_start`/`register_finish`. Contrast confirmed:
`services/two_factor.rs:84-96` `enable_2fa` requires BOTH a fresh TOTP code (L84-88) AND consumption of a
single-use setup challenge (L93-96) before it takes effect. Severity: confirmed as stated (**medium**) —
arguably could be argued higher given it chains with AUTH-01 into a persistent full bypass, but I did not
find grounds to call the auditor's rating wrong, so left as-is.

### AUTH-18 — duplicate 2FA routes
PARTIAL. The route registration duplication is real and verified exactly as cited:
`routes/two_factor.rs:19-29` (6 routes under `/auth/2fa/*`) and `routes/profile.rs:22-39` (5 routes under
`/profile/2fa/*`, missing `regenerate-backup-codes`), both merged at `routes/mod.rs:226` and `:239`.
BUT: I read every wrapper function body in both files (routes/profile.rs:137-231, routes/two_factor.rs
:32-114) and every one of them — `setup_2fa`, `enable_2fa`, `disable_2fa`, `get_2fa_status`, `verify_2fa`
— does the identical thing: extract IP, check `limiters.sensitive`, `require_auth`, then delegate to the
SAME `handlers::two_factor::*_handler` function (e.g. both `setup_2fa` wrappers call
`handlers::two_factor::setup_2fa_handler`). This means the auditor's stated impact — "a rate-limit or
audit fix applied to only one of the two files silently leaves the other endpoint set unpatched" — is
**false for anything inside the handler** (business logic, audit calls, TOTP/challenge checks all live in
the shared handler and would be fixed for both routes simultaneously). The only real duplication is the
thin route-wrapper boilerplate (identical rate-limiter tier selection, copy-pasted 5 times per file), which
could theoretically drift if someone edited the tier in only one file — a narrower, lower-consequence risk
than described. `regenerate-backup-codes` genuinely is single-path (only under `/auth/2fa/`), which is the
one part of the finding that stands unweakened.
Severity corrected: **low** (down from medium) — real code-duplication/tech-debt item worth consolidating
during the user-module migration, not a security-relevant divergence risk today.

## Additional issues found (not in the auditor's list)

1. **Registration enumerates usernames/emails directly.** `services/auth.rs:395-399`:
   `if AuthRepository::username_or_email_exists(...) { return Err(BadRequest("Username or email already
   exists")) }` — an unauthenticated caller gets a direct yes/no oracle on whether a username or email is
   registered, no ambiguity at all (stronger signal than the login-side timing/message oracles). It is
   throttled by the same `auth` rate-limiter family (`core/rate_limiter.rs:251` routes `"auth:register"`
   through `self.auth.check`, i.e. 5/60s/IP) so it isn't unlimited. This is a common industry UX tradeoff
   (many products do this deliberately), so I rate it **low**, but it's a real gap the auditor's
   login-scoped AUTH-04 finding did not cover, and it means fixing AUTH-04 alone leaves a stronger
   enumeration oracle live at `/auth/register`.
   File: hotel-app-be/src/services/auth.rs:395-399.

2. **Failed-login-attempt counter is read-then-write, not atomic — a lockout-evasion race.**
   `services/auth.rs:82-83` computes `new_attempts = failed_attempts.unwrap_or(0) + 1` in Rust from a value
   read at L48-49 (`login_lock_state`), then `repositories/auth.rs:115-127`
   (`update_failed_login_attempts`) does a flat `UPDATE users SET failed_login_attempts = $1 WHERE id =
   $2` — an absolute overwrite, not `failed_login_attempts = failed_login_attempts + 1`. Two concurrent
   wrong-password requests for the same account that both read the counter before either writes will both
   compute and write the same `new_attempts`, silently losing one failed attempt from the count and
   extending the number of guesses available before lockout fires. Same pattern in `lock_user_after_failure`
   (repositories/auth.rs:97-112). Severity **low** (requires genuinely concurrent requests within one
   read-write window, itself constrained by the 5/60s per-IP rate limiter and ~100-300ms bcrypt cost per
   request narrowing but not eliminating the window; a distributed attacker across multiple IPs could still
   exploit it since the limiter is per-IP).
   Files: hotel-app-be/src/services/auth.rs:48-49,82-92; hotel-app-be/src/repositories/auth.rs:97-127.

## Commands run (for absence claims)

```
grep -n "two_factor" src/services/passkey.rs                                    → no matches
grep -n "AuditLog" src/services/passkey.rs                                      → no matches
grep -n "login_lock_state\|is_locked\|locked_until" src/services/passkey.rs src/repositories/passkey.rs → no matches
grep -rniE "password_history|previous_password|password_reuse" src/ database/  → no matches
grep -rn "step_up|reauth|re_auth|fresh_auth" src/                               → only require_auth substring hits
grep -rn "fn.*reset_password|fn.*change_password|fn.*update_password" src/     → only the one already-cited path
```
