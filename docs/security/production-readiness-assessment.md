# Production Readiness Assessment

Assessment date: 2026-09-15, with a second review pass on 2026-09-16 against
`master` (`46ce8b88d`) that added backlog items 17–19 and the config/env/doc
fixes listed in §12. Reviewed against `master` (`ea5d738e3`) plus
uncommitted frontend bookings changes present in the worktree (not assessed;
concurrent feature work).

This is a **hardening review, not a certification**. It states what the
repository evidence supports. "Existing" means implemented and verified in the
current tree; "Partial" means implemented with a gap; "Missing" means absent.

## 1. Executive summary

The application demonstrates substantial application-layer security and
deployment engineering. A prior internal security evaluation
(`.claude/reports/security-eval-2026-07-27/`) found 8 HIGH and 18 MEDIUM/LOW
issues; **every verified item from that report has been remediated** in the
current tree (see §12). The remaining exposure is concentrated in operations:
the production database runs a pre-release PostgreSQL, backups never leave the
VPS, the app still connects as a superuser pending a documented role cutover,
nothing external consumes the failure signals the system already produces, and
no retention enforcement or restore evidence exists.

**Verdict: Ready with conditions.** The codebase and deploy pipeline are in
good shape for the current single-VPS deployment. It should not be described
as "fully production-ready" until the P1 items in §11 are closed and the
external validations in §14 are done.

## 2. Architecture and deployment overview

- **Backend**: Rust 2024 / Axum 0.8 / SQLx (runtime-checked queries, not
  compile-time macros) / PostgreSQL. Domain modules under
  `hotel-app-be/src/modules/<domain>/` (38 merged routers); cross-cutting
  auth, middleware, rate limiting, metrics in `src/core/`.
- **Frontend**: React 19 / TS / Vite / MUI / TanStack / ky. All HTTP through
  `src/api/client.ts`; access token in memory only, refresh via HttpOnly
  cookie. Sourcemaps disabled for the web build (`vite.config.ts:101`).
- **Desktop**: Tauri 2, backend sidecar + embedded PostgreSQL.
- **Production**: single AIC VPS. Cloudflare TLS edge → host Caddy (80/443) →
  loopback-only backend `127.0.0.1:3030` and frontend `127.0.0.1:8081`.
  PostgreSQL on an internal Docker network, not published to the host.
  Staging coexists on the same host as a separate compose project
  (`/opt/saliminn-staging`, ports 3031/8083).
- **Deploy**: CI green → `deploy.yml` builds images, assembles a release
  bundle with `SHA256SUMS`, ships over SSH, and runs `deploy.sh` (flock-locked,
  checksum-verified, arch-checked, pre-deploy verified dump, DB patches before
  app start, localhost + public health checks, image-tag rollback on failure).
  No `workflow_dispatch` on the prod workflow by design — production revisions
  enter only through green CI on master.

## 3. Security audit

### Authentication — mostly strong

| Control | Status | Evidence |
|---|---|---|
| Password hashing | Existing | bcrypt (cost 12) |
| JWT secret | Existing | No fallback; `:?` required in every compose file; placeholder prefixes (`CHANGE_ME` etc.) refused at startup |
| Access tokens | Existing | 30 min TTL (web); session-bound |
| Refresh tokens | Existing | 30 d, HttpOnly `Secure`+`SameSite=Lax` cookie scoped to `/api/auth`, SHA-256 at rest, atomic rotation, per-session revocation |
| Global session enforcement | Existing | every request checks session row + `is_active`/`is_locked`/`deleted_at` (`routes/mod.rs`) |
| Lockout | Existing | atomic `failed_login_attempts = failed_login_attempts + 1 … RETURNING`; 5 attempts / 30 min |
| Google login | Existing | JWKS pinned to `googleapis.com`, issuer allow-list; credentials never persisted |
| 2FA | Existing | TOTP secrets encrypted at rest (`TOTP_ENCRYPTION_KEY`); recovery codes hashed; **role-based enforced enrollment with grace deadline** (`auth/service.rs`) |
| Passkeys | Existing | step-up re-auth required to enroll; audit rows on register/authenticate |
| Login audit | Existing | IP + user-agent recorded on success and failure |
| Email verification | Existing | hashed, expiring, single-use tokens; `resend_verification` rate-limited |
| Rate limiting | Existing | per-IP ceilings on all unauthenticated auth routes; X-Forwarded-For parsed right-to-left **and** Caddy overwrites the header (`header_up X-Forwarded-For {remote_host}`) |

Residual auth risks: in-memory rate limiter is single-instance only
(documented); bcrypt runs on worker threads (acceptable at hotel login volume);
refresh-cookie restoration does not work in desktop webview (accepted
limitation, documented).

### Authorization — strong

- Central `check_permission`/`require_permission_helper` middleware;
  `<resource>:manage` implies every action. All 38 domain routers mount
  through it. Room-read endpoints that previously leaked guest/financial
  fields to housekeeping logins are now `rooms:read`/`bookings:read`-gated.
- Object-level checks in domain services (guest-portal IDOR tests exist:
  `tests/guest_portal_idor.rs`, `guest_booking_isolation.rs`).
- Role/permission *definition* mutations are audited (7 `AuditLog` sites in
  `modules/rbac/service.rs`); actor-priority checks prevent self-escalation.
- Data-transfer export/import requires `data_transfer:*` permissions plus a
  step-up token; every transfer writes an audit row (`data_transfer/handlers.rs`).
- WebSocket upgrades verify `is_session_active` before `.on_upgrade()`
  (loyalty, realtime, support) — a deactivated account can no longer hold a
  socket.
- Denied (401/403) responses are logged at WARN and counted in metrics.

### Application security

- **Injection**: all SQL parameterized; dynamic identifiers allow-listed in
  data-transfer. eKYC/audit CSV exports pass through an OWASP formula-injection
  guard (`utils/sanitization.rs:125`); `username` has a character-class rule.
- **Uploads**: eKYC + room images use magic-byte validation (JPEG/PNG/WebP),
  10 MB cap, UUID filenames, per-user path-prefix validation, private storage
  under `private_uploads/`; per-route body limits applied correctly.
- **XSS**: one `dangerouslySetInnerHTML` (campaign preview) — its body is now
  sanitized server-side (`communications/service.rs:202`); stored HTML kept
  for SMTP. Guest-supplied values escaped.
- **Headers**: CSP/HSTS/nosniff/frame-deny/Referrer-Policy at backend; nginx
  CSP includes the exact PayPal/Cloudflare/Google origins the app needs.
- **CORS**: explicit origin list in production; `TRUST_PROXY_HEADERS` defaults
  off and is only correct because Caddy overwrites XFF.
- **SSRF**: outbound calls pinned (Google JWKS, PayPal API, Cloudflare
  siteverify, SMTP); no user-controlled URLs fetched.
- **Secrets**: none in source; gitleaks in CI; `.env` files gitignored.
- **Error handling**: generic client messages, details logged server-side;
  5xx counted and logged at WARN.

### Sensitive data

Guest PII, IC/passport numbers, eKYC images, payment records and audit logs
are handled with: private filesystem storage for identity documents,
`ekyc_document_downloaded` audit events, soft-delete + `PII_REDACTED`
scrubbing on guest deletion, hashed tokens everywhere tokens exist, and a
business-data-only `hotel-backup` v3 format that excludes credentials,
sessions and eKYC evidence.

## 4. Compliance and privacy readiness

**Malaysia PDPA likely applies** (hotel in Malaysia processing Malaysian
guests' personal data). This section is technical readiness only — legal
review is still required.

| Area | Status | Evidence / gap |
|---|---|---|
| Purpose limitation + consent capture | Existing | `consent` module records versioned consent per user/guest/anonymous booking with IP/UA and locale (`consent_gate.rs`, `consent_records.rs` tests) |
| Privacy notice / terms / eKYC consent / payment terms | Existing | `features/legal/` — versioned documents, locale-aware, linked at consent points |
| Access/export (data subject) | Existing | data-transfer export is permission- + step-up-gated and audited |
| Correction/deletion | Partial | guest soft-delete + PII redaction exists; no self-service correction flow for guests |
| Retention | **Missing** | no automated retention/purge for audit logs, eKYC images, sessions, exports, or logs; PDPA requires a documented schedule and enforcement |
| Breach response | Partial | documented in `production-operations.md`; no drill evidence |
| Auditability | Existing | comprehensive audit trail incl. eKYC doc access and transfers |
| Cookies/tracking | Existing | only the refresh cookie; no trackers found |
| Third-party processors | Partial | PayPal (disabled by default), Google, Cloudflare Turnstile, SMTP — no processor inventory/DPA documentation |
| Data residency | Partial | single Malaysian-serving VPS; residency statement not documented |

## 5. Deployment hardening

Strong: checksum-verified bundles, 40-char SHA enforcement, deploy lock,
arch check, `:?` required secrets, pre-deploy verified dump, loopback-only
bindings, internal DB network, `no-new-privileges`, PID/mem/cpu limits,
health checks, graceful stops, Caddy config validate+reload-rollback,
image-tag rollback, pinned Action SHAs, `permissions:` blocks on all
workflows, Dependabot covering backend/frontend/desktop/Actions.

Gaps and notes:

- **Rollback does not revert database patches** — patches apply before the
  app starts and are forward-only; a failed release leaves old app + new
  schema (safe while patches stay additive; documented as "mixed state").
- **Staging deploy wrote prod paths** — the staging backup systemd unit ran
  `/opt/saliminn/database-backup.sh` (backing up the prod DB a second time
  while staging's own DB got nothing) and logrotate targeted
  `/opt/saliminn/logs/*.log` under the prod filename. **Fixed this session.**
- Staging shares the production VPS — acceptable for cost, but a staging
  incident can consume prod resources (bounded by container limits).
- No maintenance mode; deploys cause a brief restart window.
- Desktop packaging is **not** gated by CI (`cargo check` with placeholder
  resources only); desktop artifacts ship unsigned with an unconfigured
  updater (`REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`).

## 6. Database and data integrity

- Single V1 baseline + checksum-verified patch catalog (`patches/manifest.tsv`,
  enforced by `tests/postgres_patch_catalog.rs`/`postgres_patch_lifecycle.rs`);
  additive-only convention, `pg_dump` schema-diff convergence requirement.
- **Overbooking is prevented by a real exclusion constraint**, not app code.
- Connection pool bounded (5), `statement_timeout=120s` per connection,
  `idle_in_transaction_session_timeout=300s`, server-side slow log at 500 ms,
  `pg_stat_statements` preloaded, tuned `work_mem`/`effective_cache_size`.
- Money as `numeric`; decimal round-trip and invoice-total characterization
  tests exist. Booking status transitions and night-audit idempotency covered
  by PG-backed tests.
- **`postgres:19beta3` in production** — pre-release engine (P1, §11).
- Runtime role is still the `hotel_admin` superuser; `deploy/db-least-privilege.sql`
  (DML-only `hotel_app` role) exists but is an unapplied operator step (P1).

## 7. Reliability and observability

- `/health` endpoints; compose healthchecks; `system/health` + `system/jobs/failures`
  admin surfaces (`settings:manage`-gated) backed by a `job_runs` table.
- Request metrics counted in `core/metrics` (status + latency); rate-limit
  rejections, permission denials, audit-write failures and 5xx all have
  counters/logs. TraceLayer spans emit at DEBUG under `RUST_LOG=warn` — 4xx
  traffic is invisible in logs but counted in metrics.
- Email outbox worker: leased, exponential backoff (2^n min, capped 60),
  permanent-failure marking; campaign scheduler, night audit, receipt expiry
  and unpaid-hold release follow the same pattern.
- Caddy access log redacts booking tokens; logs rotated via logrotate.
- **No external alert consumer** — `check-backup-health.sh` writes a failure
  marker and exits 1, but nothing (no `OnFailure=` unit, no uptime probe, no
  webhook) reads it. In-app staff notifications require someone to log in.
  If SMTP is unset, even that path can't reach email (P1).

## 8. Backup and disaster recovery

- Nightly `pg_dump` custom-format, verified with `pg_restore --list` before
  being kept; per-class retention (14 nightly / 5 predeploy); mode-0600 dumps;
  machine-readable `backup-status.json` + health-check timer.
- **Now covered (this session):** nightly tar.gz of `uploads/` +
  `private_uploads/` with own retention class — previously eKYC identity
  documents and payment receipts had **no** backup at all.
- **No off-host copies** (`offsite: false` is deliberately reported); age,
  rclone and aws exist on the host but no hotel-owned destination is
  configured. RPO = last nightly; the script documents a measured loss window
  (4 bookings / 10 payments / 3 invoices / 47 audit rows on 2026-09-15).
- **No PITR** (`archive_mode` off).
- Restore procedure + quarterly drill documented in
  `docs/security/backup-restore.md`; **no evidence a restore has ever been
  executed**. Per this repo's own standard, the backup policy is therefore
  unvalidated (P1).

## 9. Testing and quality gates

- 50 backend test files incl. live-PG suites in CI (auth sessions, consent
  gates, guest-portal IDOR, payment characterization, rate limiter, security
  headers, patch catalog/lifecycle, eKYC review queue). Skip-without-DB
  semantics are documented.
- 235 frontend Vitest files; four independent gates (typecheck /
  lint:strict / test / build). `openapi_drift` keeps the spec honest.
- Security workflow: gitleaks, CodeQL, cargo-audit, dependency review.
- **Gaps:** no browser E2E suite, no load/performance tests, no automated
  restore test, desktop `tauri build` not exercised in CI.

## 10. Dependencies and supply chain

- Lockfiles committed (Cargo, bun.lock); base images pinned
  (`rust:1.95.0-bookworm`, `oven/bun:1.3.14-alpine`, `nginx:1.28-alpine`);
  Actions SHA-pinned; Dependabot weekly incl. desktop; cargo-audit in CI.
- `dependabot.yml` ignores **all** sqlx updates, including patches — narrow
  it to `version-update:semver-major` or accept the manual-review burden.
- No SBOM/provenance attestation on release artifacts (SHA256SUMS only);
  acceptable at this scale, note for later.

## 11. Prioritized remediation backlog

| # | Sev | Area | Finding | Status | Validation |
|---|---|---|---|---|---|
| 1 | P1 | Database | `postgres:19beta3` (pre-release) in prod; no supported upgrade path to GA | Existing | `pg_dump`+`pg_restore` rehearsal to PG18/19-GA on staging |
| 2 | P1 | Backup | No off-site/encrypted copies; host-held dumps only | **Partial** (this session) — env-gated `age`+`rclone copy`+`rclone check` ship now in `database-backup.sh`; destination, recipients file and bucket ACLs remain operator-owned | set `SALIMINN_OFFSITE_REMOTE`+`SALIMINN_AGE_RECIPIENTS_FILE` on the backup unit, confirm `offsite:true` in `backup-status.json` + a remote restore |
| 3 | P1 | Database | Runtime uses `hotel_admin` superuser; `hotel_app` role unapplied | Partial | `SELECT current_user` on backend conn + patch-runbook update |
| 4 | P1 | Observability | Failure signals have no external consumer (backup-health marker, job failures, audit-write failures) | **Partial** (this session) — `check-backup-health.sh` POSTs transition-deduped alerts + recovery to `SALIMINN_ALERT_WEBHOOK` (`/opt/saliminn/backup-alert.env`); job/audit failure alerting still in-app only; no external uptime probe | set the webhook env file, trigger a forced failure, confirm the POST arrives |
| 5 | P1 | Compliance | No retention schedule/enforcement for audit logs, eKYC images, sessions, exports, logs | **Partial** (this session) | `docs/security/data-retention-policy-draft.md` proposes schedules — legal sign-off required, then purge jobs; not enforced yet |
| 6 | P1 | DR | No restore has ever been demonstrated | Missing | quarterly drill record per `backup-restore.md` |
| 7 | P2 | Staging | backup timer ran prod script; logrotate wrote prod file/path | **Fixed** (this session) | `bash -n`; next staging deploy writes correct units |
| 8 | P2 | Backup | uploads/private_uploads unprotected | **Fixed** (this session) | container test: archive created, verified, pruned, failure alerts (below) |
| 9 | P2 | Desktop | unsigned artifacts; updater unconfigured | Partial | codesign/notarize + updater pubkey before desktop distribution |
| 10 | P2 | Testing | no E2E, load, or automated restore tests | Partial — CI now runs a `pg_dump`→`pg_restore` schema round-trip; E2E/load still missing | one happy-path E2E + annual load baseline |
| 11 | P2 | Deploy | rollback doesn't revert DB patches (additive-only convention) | Existing (documented) | keep patches additive; restore-drill covers destructive case |
| 12 | P2 | Compliance | no processor inventory/DPA register (PayPal, Google, Cloudflare, SMTP, host) | Missing | documented register + legal review |
| 13 | P3 | Ops | no maintenance mode; brief deploy downtime | **Fixed** (this session) | `MAINTENANCE_MODE=on` env gate in `deploy/Caddyfile` + host runbook step in `production-operations.md`; `caddy validate` passes with both values |
| 14 | P3 | Supply chain | Dependabot ignores all sqlx incl. patches | **Fixed** (this session) | ignore now scoped to `version-update:semver-major`; minor/patch advisories flow again |
| 15 | P3 | CSP | `connect-src 'self' https:` is broad | **Fixed** (this session) — enumerated: `*.paypal.com`, `*.paypalobjects.com`, `*.venmo.com`, `challenges.cloudflare.com`, `accounts.google.com`, `*.googleapis.com` | browser smoke of login/PayPal/Turnstile flows after next deploy |
| 16 | P3 | Docs | no payment-reconciliation or maintenance runbook | **Fixed** (this session) | `production-operations.md` gained Maintenance mode, Payment reconciliation, and Data-breach response sections |
| 17 | P3 | Deploy | `PAYPAL_API_BASE` sandbox default uncoupled from `PAYPAL_ENABLED` + creds | **Fixed** (this session) | `config::tests::production_rejects_sandbox_paypal_base` — prod boot refuses a credentialed sandbox base |
| 18 | P3 | Docs | `deployment.md` drift: `SameSite=Strict` (code: `Lax`), daily-rotated `backend-YYYY-MM-DD.log` (now fixed `backend.log`+logrotate), "newest 7 dumps" (now 14/5 per class), Prometheus `/metrics` scrape (no such endpoint) | **Fixed** (this session) | `check-doc-links.py`; grep vs `handlers.rs:41`, `database-backup.sh:45-46` |
| 19 | P3 | Deps | `bun audit` is manual-only; JS advisories rely on Dependabot + dependency-review alone | **Fixed** (this session) | `js-advisories` job added to `security.yml`; both lockfiles currently clean (`bun audit` 0 findings locally) |

No P0 items found. P1 items 2, 3, 4, 6 are operator/host actions — they
cannot be completed from this repository alone.

## 12. Changes implemented in this review

| Change | Files | Validation performed |
|---|---|---|
| Staging backup unit now runs the **staging** script | `deploy/deploy-staging.sh` | `bash -n`; verified bundle renames `database-backup-staging.sh`→`database-backup.sh` under `/opt/saliminn-staging` |
| Staging logrotate writes `/etc/logrotate.d/saliminn-staging` for `/opt/saliminn-staging/logs/*.log` | `deploy/deploy-staging.sh` | `bash -n`; previously clobbered/duplicated prod's file and never rotated staging logs |
| Nightly backup now archives `uploads/` + `private_uploads/` (mode 0600, own 7-copy retention, failure marks status `uploads_failed` while keeping `last_success` fresh) | `deploy/database-backup.sh`, `deploy/database-backup-staging.sh` | Linux-container run: happy path creates and verifies archive; missing-dir path exits 1 with `status:error` + fresh `last_success`; retention keeps newest 7 |
| Production boot guard: a credentialed PayPal integration pointing at `api-m.sandbox.paypal.com` now refuses startup under `ENVIRONMENT=production` | `hotel-app-be/src/core/config.rs` | `cargo test --all-features config::tests` — 11/11 pass incl. new `production_rejects_sandbox_paypal_base` |
| `deployment.md` corrections: `SameSite=Lax`, fixed `backend.log` + logrotate, 14-nightly/5-predeploy retention, removed nonexistent Prometheus `/metrics` scrape config | `docs/guides/deployment.md` | `check-doc-links.py` 130 files OK; verified against `auth/handlers.rs` (SameSite::Lax), `database-backup.sh` retention vars, `system/routes.rs` |
| `.env.example` notes: production `PAYPAL_API_BASE` requirement documented next to the sandbox default | `.env.example`, `hotel-app-be/.env.example` | — |
| Dependabot sqlx ignore narrowed to `semver-major` only — minor/patch (incl. security) updates flow again | `.github/dependabot.yml` | YAML parse |
| `js-advisories` job: `bun audit` on both bun workspaces | `.github/workflows/security.yml` | `bun audit` 0 findings on both lockfiles locally |
| Opt-in alert channel: `SALIMINN_ALERT_WEBHOOK` (via `/opt/saliminn/backup-alert.env`) fires a `{"text":…}` POST on new/changed failure and a RECOVERED message on return to healthy; transition-deduped | `deploy/check-backup-health.sh` | live exercise: first failure POSTs, repeat does not, recovery POSTs once, marker removed |
| Maintenance mode: `MAINTENANCE_MODE=on` env gate (503s all but `/health`) for the container path + host-site runbook steps | `deploy/Caddyfile`, `docker-compose.yml`, `docs/security/production-operations.md` | `caddy validate` clean with `MAINTENANCE_MODE` both `off` and `on` |
| Ops runbook additions: maintenance mode, payment reconciliation, data-breach response | `docs/security/production-operations.md` | `check-doc-links.py` |
| Data-retention policy draft (proposed schedules, explicitly unapproved) | `docs/security/data-retention-policy-draft.md` | `check-doc-links.py` |
| Off-site backup shipping, env-gated: `age` encrypt → `rclone copy` → `rclone check`, per-artifact, reports `offsite:true` only when verified; failure marks run `error`/`offsite_failed` while `last_success` stays fresh | `deploy/database-backup.sh`, `deploy/database-backup-staging.sh` | container run: unconfigured → `offsite:false`, zero ship; configured-but-incomplete → `offsite_failed` alert path; tools absent → same alert path |
| CI `pg_dump`→`pg_restore` schema round-trip on the seeded baseline | `.github/workflows/ci.yml` | runs in the PG job; `diff` of `pg_dump --schema-only` on source vs restored |
| `connect-src` tightened from `'self' https:` to enumerated origins (PayPal/Cloudflare/Google) in all 3 nginx CSP blocks | `hotel-web-fe/nginx.conf` | grep count; browser smoke of login/PayPal/Turnstile still required post-deploy |
| This assessment | `docs/security/production-readiness-assessment.md` | `check-doc-links.py` |

Verification commands run: `cargo check --all-features` (clean),
`tsc --noEmit` (clean), `python3 scripts/check-doc-links.py` (127 files OK),
`docker compose -f docker-compose.prod.yml config -q` (valid), `bash -n` on
all touched scripts, and the container exercise above. Full test suites were
not re-run; CI covers them and the worktree carries unrelated user changes.

## 13. Prior-audit remediation record

Verified against the 2026-07-27 evaluation — all eight HIGH items are fixed
(pre-checkin route removed; guest column aliases; `:?` secrets + placeholder
blocklist; right-to-left XFF + Caddy `header_up`; request telemetry +
Caddy logging; audited step-up export; room-endpoint permission gates;
portal-limiter key validation), as are the MEDIUM items checked here
(atomic lockout, passkey step-up + audit, login IP/UA, RBAC-change audits,
429/403 logging + counters, SMTP configurable in prod, pg_stat_statements
preloaded, superuser-role script shipped-but-unapplied, CSV formula guard,
scheduled backups, campaign-HTML sanitization, WebSocket session check,
eKYC shared IP extractor, desktop password file 0600, Dependabot desktop
coverage, audit-write-failure counter, statement_timeout, resend-verification
limit, TOTP encryption, hashed verification tokens, nginx CSP for PayPal,
loopback dev DB, SHA-pinned Actions, `permissions:` blocks, per-route body
limits, rotated fixed-name logs, pinned nginx, 0600 dump files).

## 14. Remaining risks and external validation required

1. **Off-site backup destination** — needs a hotel-owned bucket + access list,
   then wire rclone/age and flip `offsite:true` in the health contract.
2. **Least-privilege cutover** — run `deploy/db-least-privilege.sql`, repoint
   `DATABASE_URL`, keep `hotel_admin` for `apply-patches.sh`/seed only.
3. **PG19 GA migration** — plan dump/restore to GA (or PG18) once released;
   rehearse on staging first.
4. **Alert consumer** — `check-backup-health.sh` now supports
   `SALIMINN_ALERT_WEBHOOK` (drop it in `/opt/saliminn/backup-alert.env`):
   POSTs on new/changed failures and on recovery. Still needed: choose a real
   destination, and add an external uptime probe on
   `https://saliminn.my/health`.
5. **Restore drill** — execute `backup-restore.md` once and record RTO; set
   an explicit RPO target (≤24 h implied by nightly).
6. **Penetration test** — authenticated web/API test after material auth,
   payment, or eKYC changes (`production-operations.md` already requires it).
7. **Legal/compliance review** — PDPA applicability, retention schedule,
   privacy-notice sufficiency, processor DPAs. Not determinable from code.
8. **Cloudflare/WAF rules, DNS, host firewall/SSH hardening, GitHub
   `production` environment reviewers** — outside repository automation.
9. **Retention enforcement** — `docs/security/data-retention-policy-draft.md`
   proposes schedules per data class; needs legal sign-off, then purge jobs
   per approved row.

## 15. Final verdict

**Ready with conditions.** Application security, authorization, deployment
integrity and code quality are solid and verified. Production go/no-go now
depends on operator-owned work — off-site encrypted backups with a proven
restore, the least-privilege DB cutover, an alert path for existing failure
signals, a retention policy, and the PG19-GA migration — plus the legal
review items in §14. The system should not be presented as "fully
production-ready" until every P1 in §11 has evidence behind it.
