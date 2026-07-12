# Implementation Plan — Guest Communications (Email-first) for hotel-app-be

Prepared 2026-07-12 (read-only research pass). Every claim below is grep/read-verified with `file:line`. **Concurrency caveat:** `services/bookings.rs` and `services/payments.rs` are being edited by another session right now — their line numbers are **approximate** and must be re-grepped at build time. `hotel-web-fe/**` is frozen by a third session — all FE items below are **spec-only**, do not edit FE this session.

## What exists today (research findings)

**1. Guest email is captured-when-present but NEVER required.** `guest.email` is `Option<String>` at every layer (`models/guest.rs:14`; booking-join field `guest_email: Option<String>` at `models/booking.rs:290`). Guest create only format-normalizes it if supplied, never enforces presence (`services/guests.rs:89` `normalize_guest_email`, def at `:523`). Email *is* a real, load-bearing field though — the guest portal verifies identity on it (`services/guest_portal.rs:56-59` `guest_email_matches`). Net: any notification path must **skip-and-log when email is absent**, and coverage will be partial until capture is tightened (out of scope for v1).

**2. Lifecycle hookpoints (where sends would fire):**
- Booking created → `handlers/bookings.rs:62` `create_booking_handler` → create path in `services/bookings.rs` (approx).
- Check-in → route `/bookings/{id}/checkin` (`routes/bookings.rs:45`) → `services/bookings.rs:153` `manual_checkin` / `:192` `checkin_booking_flow`.
- Check-out → **no clearly-named checkout service fn found**; only the side-effect hook `services/housekeeping.rs:279` `ensure_checkout_cleaning_task` fires on checkout. The actual status transition likely rides a booking status-update path — **must be located at build time** (grep `CheckedOut`/status write in `bookings.rs`).
- Payment/receipt → `services/payments.rs:48` `create_payment`, `:104` `record_payment` (approx, concurrently edited).
- **No password-reset email flow exists.** `bin/fix_password.rs` is a SQL-generator utility, not a mailer. Setting `enable_email_verification=true` is seeded (`data.sql:745`) but **dormant — nothing backs it.** So there is no existing outbound-mail code to reuse or pattern-match.

**3. Cargo deps:** No `lettre`/`sendgrid`/`twilio`/`smtp` anywhere. `reqwest = "0.12"` is present **but only under `[dev-dependencies]` (`Cargo.toml:64`)**, used solely by `tests/router_integration.rs` — **not linkable from the binary.** A transactional-API backend therefore requires promoting `reqwest` to `[dependencies]`; an SMTP backend requires adding `lettre`. No `notification`/`email`/`mailer` module exists in `src`.

**4. Templating:** No engine (no `askama`/`tera`/`handlebars`/`minijinja`) — all string building is `format!`. A dormant `email_templates` table exists in Postgres (`schema.sql:448-459`: `code/subject/body_html/body_text/variables JSONB`) **but it is Postgres-only (absent from every file in `sqlite_migrations/`) and is referenced in Rust only by the generic data-transfer export/import (`services/data_transfer.rs:24,224`), never rendered.** Treat it as aspirational scaffolding, not usable infra.

**5. `system_settings`** is the config home. DDL `schema.sql:429-442` (`key,value,value_type,category,description,is_public,is_encrypted,validation_pattern`). **Dual-DB divergence:** the SQLite DDL (`sqlite_migrations/001_initial_schema.sql:130`) has **`is_sensitive`** instead of `is_public`/`is_encrypted`. Seed pattern: Postgres `data.sql:728+` `INSERT ... (key,value,value_type,category,description,is_public)`; SQLite migrations `INSERT OR IGNORE ... (…,is_sensitive)` (e.g. `002_night_audit_auto_settings.sql`). New keys must be seeded in **both** with each side's column set. Read path is `core/settings_cache.rs` (`get_string`/`get_i32`/`get_decimal`/`get_positive_i32`). The `night_audit_auto_enabled` flag is the exact enable/disable precedent.
   - **SECURITY BLOCKER for credential storage:** the settings GET query returns `value` for **all** keys with **no `is_public`/`is_sensitive` filter and no masking** (`modules/settings/repository.rs:15,32,48`). Storing an SMTP password or provider API key here would expose it in plaintext to any `settings:read` user, and there is **no value-encryption implemented** (grep for `encrypt`/`is_encrypted` in `modules/settings/` and `settings_cache.rs` → empty). Masking-on-GET must be built before any secret lands in settings.
   - Settings SQL uses bare `$1`/`$2` and is dual-DB-safe (per `lessons.md 2026-07-10`, `$N` is valid SQLite syntax — precedent `repositories/audit.rs`). Fine to follow for simple inserts; use `sql_query!` only where functions diverge.

**6. FE settings pattern to extend (spec-only):** `hotel-web-fe/src/features/user/components/SettingsPage.tsx` (1117 lines) + `hooks/useSettingsQueries.ts`; API via `src/api/admin.service.ts`. Backend module `src/modules/settings/` (handlers/routes/service/repository), merged at `routes/mod.rs:163`, gated on `settings:update` / `settings:manage`.

**Two facts that change the recommendation:**
- **A background-job pattern already exists:** `services/night_audit_scheduler.rs` — a `tokio::spawn` 60s poll-loop, opt-in via a settings flag, reading `settings_cache` (spawned at `main.rs:189`). There is **no cron crate**, but scheduled reminders + a retry worker can reuse this exact pattern. So "defer reminders" is a *scope* choice, not a *missing-infra* blocker.
- **The fire-and-forget-in-transaction pattern is already documented:** `services/rooms.rs:225-248` uses `SAVEPOINT sp_room_event` / `RELEASE` / `ROLLBACK TO SAVEPOINT`, and `lessons.md 2026-07-10b` records **why `let _ = sqlx::query(...)` inside a Postgres tx is unsafe** (a failed statement poisons the whole tx). This directly governs the notification failure semantics below.

---

## 1. Scope decisions needed from the user

**(a) Email-only v1 vs email+SMS.** **Recommendation: email-only for v1.** SMS = a paid provider (Twilio/etc.), per-message cost, E.164 phone normalization, and explicit opt-in/consent tracking (regulatory) — none of which exist today. Add SMS later behind the same `Channel` abstraction. *(Recommendation, not a hard call.)*

**(b) Delivery mechanism.** **Recommendation: a transactional email API (Resend or Postmark) as the default backend, behind a `Mailer` trait so SMTP is a drop-in later.** Rationale: (i) deliverability — mail sent directly via SMTP from a PMS/desktop host lands in spam without SPF/DKIM/DMARC alignment that a small hotel can't easily configure; a transactional API solves this; (ii) `reqwest` is already in the tree (promote to `[dependencies]`), no `lettre` needed; (iii) no SMTP relay to run/secure. Trade-off: a new vendor + an API key to store (and mask — see §3). The alternative — `lettre`/SMTP self-config — lets a hotel reuse an existing Office365/Gmail mailbox (no new vendor) but has worse deliverability and forces plaintext-credential storage. The `Mailer` trait means this choice is **not** load-bearing on the rest of the design. *(Recommendation; provider identity is an open question — see §7.)*

## 2. v1 trigger list (recommend narrow)

**Recommended v1:** (1) **booking confirmation** (fires from the create path after the booking tx commits, when `guest.email` is present) and (2) **checkout receipt / folio summary** (fires on checkout completion, or on the balance-settling payment — a business choice, see §7).

**Defer:** pre-arrival reminders and the pre-checkin-invite email. Note: the pre-checkin token is generated but **never emailed today** (`services/guest_portal.rs:93` writes the token; no send exists) — so "email the pre-arrival self-check-in link" is a high-value fast-follow, and the booking-confirmation email is its natural vehicle. **Confirmed: the repo has a reusable scheduler pattern (`night_audit_scheduler.rs`) but no generic job scheduler** — reminders are a Phase-6 fast-follow on that pattern, not a rebuild.

## 3. Data model

**`notification_log` (new table, dual-DB — the retry/visibility backbone):**

| column | Postgres | SQLite | notes |
|---|---|---|---|
| id | `BIGINT PK DEFAULT nextval(seq)` | `INTEGER PK AUTOINCREMENT` | follow existing seq/autoincrement split |
| channel | `VARCHAR(20)` | `TEXT` | `'email'` (future `'sms'`) |
| trigger_code | `VARCHAR(50)` | `TEXT` | `'booking_confirmation'` / `'checkout_receipt'` |
| booking_id | `BIGINT NULL REFERENCES bookings(id)` | `INTEGER NULL` | nullable |
| guest_id | `BIGINT NULL REFERENCES guests(id)` | `INTEGER NULL` | nullable |
| recipient | `TEXT NULL` | `TEXT NULL` | resolved email; null when skipped |
| subject | `TEXT` | `TEXT` | |
| status | `VARCHAR(20)` | `TEXT` | `pending`/`sent`/`failed`/`skipped` |
| provider_message_id | `TEXT NULL` | `TEXT NULL` | for support/debug |
| error | `TEXT NULL` | `TEXT NULL` | last failure reason |
| attempts | `INT DEFAULT 0` | `INTEGER DEFAULT 0` | retry visibility |
| created_at / sent_at / updated_at | `TIMESTAMPTZ` (`sent_at` NULL) | `TEXT` | timestamps |

Add to **both** `database/schema.sql` (with an `email_notification_log_id_seq` sequence, matching the `system_settings`/`email_templates` idiom) and a **new** `database/sqlite_migrations/02X_notification_log.sql`. Verify every column against both DDLs before claiming done (`lessons.md 2026-07-07`, `2026-07-10b`).

**Settings keys (seed in `data.sql` with `is_public=false` AND in the new SQLite migration with `is_sensitive`):**
`notifications_enabled` (boolean), `notifications_provider` (`resend`|`postmark`|`smtp`), `notifications_from_address`, `notifications_from_name`, `notifications_provider_api_key` (**sensitive** — `is_public=false`/`is_sensitive=1`; requires mask-on-GET), `notifications_booking_confirmation_enabled` (boolean), `notifications_checkout_receipt_enabled` (boolean). If SMTP is chosen: add `smtp_host`/`smtp_port`/`smtp_username`/`smtp_password` (password sensitive).

**`guest.email` nullability:** resolve the recipient at fire time; if `None`/blank → insert a `notification_log` row with `status='skipped'`, `recipient=NULL`, and return early. Never error the caller.

## 4. Backend module shape

**`src/services/notifications.rs`** (new): a `Mailer` trait (`async fn send(&self, msg: &OutboundEmail) -> Result<String /*provider_message_id*/, MailError>`) with one impl for the chosen provider (or an SMTP impl). Plus in-code `format!` templates for v1 (`fn render_booking_confirmation(...) -> OutboundEmail`, `fn render_checkout_receipt(...)`), reading hotel name/from-address from `settings_cache`. Defer DB-backed `email_templates` (it's Postgres-only anyway — see §finding 4).

**Failure semantics (hard requirement — must never poison the booking/payment tx):**
- **Fire strictly AFTER the business transaction commits.** The trigger caller commits the booking/payment tx first, then calls `notifications::fire(...)`. Do **not** put the send — or even a best-effort `let _ = sqlx::query(...)` — inside the business tx (`lessons.md 2026-07-10b`: a failed statement aborts the whole Postgres tx and resurfaces as an unrelated 500 on the next statement).
- `notifications::fire` uses its **own** connection: INSERT the log row (`pending`), then perform the HTTP/SMTP send. Run the actual send in a `tokio::spawn` (same pattern as `night_audit_scheduler.rs:33`) so the network call never blocks the API response; update the row to `sent`/`failed` on completion. A send failure only writes `status='failed'`+`error` — it never touches the money/booking row.
- If any log write must happen inside a shared tx (avoid if possible), wrap it in a `SAVEPOINT` per `services/rooms.rs:225-248`.
- **Retry visibility:** `failed`/`pending` rows carry `attempts`+`error`. v1 leaves them queryable; a Phase-6 scheduler tick (reuse `night_audit_scheduler`) can retry. No user-facing resend in v1.

## 5. FE v1 (spec-only; FE frozen this session)

Extend `SettingsPage.tsx` with a **Notifications** panel: master enable toggle, provider select, from-address + from-name text fields, API-key field (**write-only / masked** — depends on backend masking from §3), and the two per-trigger toggles. Wire through the existing `modules/settings` update endpoint (`settings:manage`). No new page/route needed (reuses the settings surface). A read-only `notification_log` viewer is a nice-to-have, defer.

## 6. Effort + phases + verification gates

Follows the `plan-remove-sqlite-2026-07-08.md` phase/gate style. Per-phase gate baseline (from the task's VERIFICATION BAR): `cargo check --all-features` **AND** `cargo check --features sqlite --no-default-features` **AND** `cargo clippy --all-features -- -D warnings` **AND** `cargo test --features sqlite --no-default-features` for touched test targets.

- **Phase 0 — Scope lock (S, user).** Resolve §1 (a)(b), §7. No code.
- **Phase 1 — Data model + settings seeds (M).** `notification_log` DDL in `schema.sql` + new `sqlite_migrations/02X`; settings keys in `data.sql` + same migration. *Gate:* apply `schema.sql` to a live Postgres; replay **all** sqlite migrations in order on a scratch `sqlite3` DB; confirm every column in both DDLs; `cargo check` both feature sets.
- **Phase 2 — `notifications.rs` service + `Mailer` trait + one provider impl (M/L).** Promote `reqwest` to `[dependencies]` (or add `lettre`). In-code templates. *Gate:* unit test template render + a mocked/stubbed send (no live network in CI); both checks + clippy.
- **Phase 3 — Wire the two triggers (M).** Booking-confirmation at the create path (post-commit); checkout-receipt at the checkout transition (**locate it first**) or balance-settling payment. *Gate:* `cargo test --features sqlite` for both flows; **live smoke** — booking with a guest email → log row `sent`/`failed`; booking with no email → `skipped`; **and prove tx isolation**: force a send failure and confirm the booking/payment still committed.
- **Phase 4 — Settings mask-on-GET + `notification_log` read endpoint (S/M).** Mask sensitive keys in `modules/settings/repository.rs` GET (BLOCKER before any secret is stored); optional `notifications:read` list endpoint. *Gate:* both checks + a curl showing the API key is masked.
- **Phase 5 — FE Notifications settings panel (M, separate session — FE frozen now).**
- **Phase 6 — Deferred: reminders + retry worker (L).** Reuse `night_audit_scheduler.rs` pattern; opt-in settings flag; idempotency via `notification_log` (a `UNIQUE(booking_id, trigger_code)` or a pre-send existence check).

Suggested commit breakdown = one commit per phase; Phases 1 and 4 touch dual-DB SQL so isolate them for review.

## 7. Open questions for the user

1. **Provider:** Resend vs Postmark vs SES vs self-hosted SMTP? (Drives Phase 2's one impl.) Recommendation: transactional API for deliverability.
2. **SMS in v1?** Recommend out (paid + opt-in/consent complexity).
3. **Confirm the v1 trigger list:** booking confirmation + checkout receipt only? Include the pre-checkin self-check-in link inside the confirmation email (the token exists but is never emailed today)?
4. **Checkout receipt timing:** fire on the checkout status transition, or on the payment that settles the balance? Different guest experience — a hotel-operations decision.
5. **Reminders in/out of v1?** Infra exists (`night_audit_scheduler` pattern); recommend out for v1, fast-follow in Phase 6.
6. **Credential storage:** confirm mask-on-GET (Phase 4) is acceptable, or should provider secrets live in an env var instead of `system_settings`? (Current settings GET leaks all values in plaintext — must be resolved before shipping an API key.)