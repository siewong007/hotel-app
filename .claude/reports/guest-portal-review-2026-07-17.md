# Guest Portal Review — 2026-07-17

Multi-agent review (7 haiku dimension reviewers → opus adjudication → sonnet re-checks →
completeness critic), synthesized by the commander session. 21 candidate findings: 20
confirmed, 1 refuted, 1 duplicate. Commander independently re-verified the four
highest-impact items (marked ✓cmd below).

Scope reviewed: routes/handlers/services/repositories for guest_portal, modules/
{guest_booking,support,promotions}, core/rate_limiter.rs, both database DDLs + seeds,
frontend features/guestPortal + auth/promotions portal surfaces, WebSocket hub, wiring.

## P0 — fix now

1. **PII: real ID-document scans tracked in git** ✓cmd
   `git ls-files hotel-app-be/uploads/ekyc/` returns 3 JPGs (1002__1765632578_*.jpg,
   ~1.2–1.4 MB each), first added in commit be37c5394. Both .gitignore entries exclude
   `uploads/` going forward but do not untrack committed files. Anyone cloning the repo
   gets these documents regardless of the runtime ACL on the ekyc endpoints.
   Action: `git rm --cached` + commit; DECIDE (user): history rewrite (filter-repo) since
   the images remain in history; verify current uploads land in `private_uploads/ekyc`
   (modules/ekyc/validation.rs:16) so this is stale data, not a live misconfiguration.

2. **CI lint breaker: banned date pattern** ✓cmd
   hotel-web-fe/src/features/onlineInventory/OnlineInventoryPage.tsx:22
   `new Date().toISOString().slice(0, 10)` — exactly matches the no-restricted-syntax
   ban (eslint.config.js:46). Fails `bun run lint` / CI. Fix: `formatLocalDate()` from
   src/utils/date.ts (also fixes the UTC previous-day shift the rule exists for).

3. **No audit logging on portal mutations** ✓cmd (adjudicated should-fix)
   services/guest_portal.rs — only `create_authenticated_guest_portal_session` (line 201)
   calls AuditLog. `verify_guest_booking` (:50, mints pre-checkin token),
   `submit_precheckin_update` (:98, mutates guest PII + booking) and auto-checkin have no
   audit calls, violating the repo invariant "every mutating handler calls services/audit.rs".

4. **Dual-DB convention: literal `$1` in shared SQL** ✓cmd
   repositories/guest_portal.rs:20,34,43,65,100 — `format!`-built strings with literal
   `$1` passed to plain `sqlx::query`, not cfg-gated and not via param!/sql_query!
   (line 52 shows the file otherwise uses sql_query!). Runtime works on both DBs ($N is
   valid SQLite syntax per lessons.md 2026-07-10), but it violates 00-diagnosis Leak #2
   and invites copy-paste of genuinely divergent syntax. Wrap with param!/sql_query!.

## Security hardening (adjudicated: real gaps, defense-in-depth — none exploitable today)

5. **No server-side logout/revocation** — routes/guest_portal.rs has no logout route;
   guest_portal_session repo has no delete/revoke method. A compromised portal token
   lives the full 24 h SESSION_TTL. Add POST /guest-portal/logout → DELETE by token_hash.
6. **Pre-checkin tokens reusable until 48 h expiry** — submit_precheckin_update
   (services/guest_portal.rs:98-121) never invalidates the token. Clear
   pre_checkin_token on successful submission (or reject when already completed).
7. **Rate-limiter coverage is token-endpoints-only** — /guest-portal/me/* (routes
   :32-49), search_handler/quote_handler (guest_booking/handlers.rs:29-45), and the WS
   upgrade (:138-149) have no limiter; all require a guest session (so not anonymous
   DoS), but a valid session can hammer them. Token-based endpoints are limited.
8. **Pre-checkin token entropy** — Uuid::new_v4() (122-bit) at services/guest_portal.rs:79
   vs 256-bit generate_session_token() used for sessions. Rate limits make brute force
   infeasible; unify on generate_session_token() for consistency.
9. **Staff user IDs leak in guest promotion responses** — PROMOTION_COLUMNS
   (promotions/repository.rs:36) includes created_by/updated_by and list_public uses it.
   Surrogate integer IDs only, low impact; add a public struct without them.

## Product decisions needed (rubric #3 — business, not code)

10. **No forgot-password/reset flow** — routes/auth.rs route list has no reset/forgot
    route; self-registered guests who forget their password have no self-service
    recovery. Decide: staff-mediated recovery is acceptable, or build reset-by-email.
11. **No max advance-booking window** — guest_booking/validation.rs:26 checks past
    dates and nights ≤ 30, but a guest can book years ahead. Typical online-booking
    policy is 180–730 days; decide and enforce.

## Robustness / quality suggestions

12. **Dead duplicate ekyc route file** — src/routes/ekyc.rs (193 ln) is never merged
    (routes/mod.rs only merges modules::ekyc::routes at :167) and its handler bodies are
    stale (weaker upload validation than the live module). Delete it before an agent or
    developer edits the wrong file.
13. **Test gaps**: (a) no concurrent-booking race test (the overbooking claim was
    refuted — protection exists — but nothing pins it); (b) support/promotions/
    guest_booking/online_inventory integration tests are cfg-gated to the SQLite harness
    only — zero PG runtime coverage for portal modules; (c) PortalBookingPage (567 ln)
    and PortalDashboardPage (582 ln) have no component tests.
14. **WebSocket niceties**: Lagged broadcast events dropped silently
    (availability.rs:67 — log a warn / signal the client); FE reconnect is a fixed 2 s
    with no backoff/jitter (useAvailabilitySocket.ts:38); FE client doesn't honor
    Retry-After on 429 (api/client.ts:169).
15. **Timezone**: booking validation derives "today" from UTC, not the hotel's
    system_settings.timezone — a guest just after midnight local time can hit
    date-boundary artifacts. Use the configured timezone for local-day math.

## Verified-clean highlights (coverage, not exhaustive)

- Booking concurrency: the claimed SQLite overbooking race was REFUTED by verification —
  availability check + insert protection held up under adversarial re-read.
- Payment-outside-booking-transaction is an intentional deferred-payment pattern
  (bookings start `unpaid`); adjudicated acceptable, documented here for the record.
- SQL/dual-DDL column parity: the dedicated sql-dualdb reviewer found no missing
  columns/tables in portal SQL (notable given repo history); the $1 convention issue
  (item 4) was the only carve-out.
- No raw fetch(), console.log, println!, or unwrap-on-fallible in portal scope
  (commander-run floor checks); portal token isolated in sessionStorage, separate from
  staff tokens.
- Support conversations IDOR checks passed (guest-scoped WHERE clauses confirmed by the
  reviewer + adjudicator).

## Follow-up recommended

The completeness critic's biggest structural point: the ACTUAL gatekeeper into the
portal is the general auth stack (/auth/register, /auth/login, /auth/verify-email →
POST /guest-portal/session), which was outside this review's surface. A focused pass
over routes/auth.rs + services/auth.rs::register + handlers/auth.rs (same checklist:
token strength, rate limits, enumeration, verification bypass) is the highest-value
next review.

Raw agent output: /private/tmp/claude-501/.../tasks/wgeeymw1o.output (session-local);
workflow journal under the session subagents dir.
