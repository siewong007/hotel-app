# Notifications v2 (Email Triggers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship checkout-receipt and pre-arrival-reminder emails on the existing durable outbox, and fix the v1 consent gate that suppresses every transactional booking confirmation.

**Architecture:** Extend `email_deliveries` with two kinds via a checksum-verified catalog patch + baseline; enqueue the receipt in checkout's post-commit best-effort block keyed by invoice number; drive reminders from a new tick in the 60s communications scheduler gated by system settings; make the worker's eligibility recheck kind-aware so transactional kinds require only an active guest while marketing keeps subscription checks; rate-limit the public unsubscribe route.

**Tech Stack:** Existing only — sqlx, lettre outbox, settings_cache, RateLimiters tiers, psql patch framework.

## Global Constraints

Spec: `docs/superpowers/specs/2026-08-26-notifications-v2-design.md`.
- Patch rules: published versions immutable — new manifest row version **8**, name `notifications-email-triggers`; sha256 checksum of exact file bytes; identical changes mirrored into `0001_v1_baseline.sql`. Desktop picks patches up via its own applier after sync scripts run.
- Constraint names to alter (all in `email_deliveries`): `email_deliveries_kind_check`, `email_deliveries_kind_campaign_link`, `email_deliveries_topic_check`. Follow the 0004 DO-block convention (fetch `pg_get_constraintdef`, RAISE if missing/diverged, DROP+ADD only when matching old definition).
- New delivery kinds/topics: kind values `checkout_receipt`, `pre_arrival_reminder`; topic values mirror the kinds (`topic varchar(32)` fits). Both are non-campaign → must appear in the `kind_campaign_link` "campaign_id IS NULL" arm.
- Settings keys seeded idempotently: `pre_arrival_reminder_enabled` = `'false'`, `pre_arrival_reminder_hours_before` = `'48'`.
- Backend gates: `cargo check --all-features` minimum; CI command verbatim `cargo clippy --all-features -- -D warnings`; full suite without `DATABASE_URL` must stay green (~209 lib+non-gated baseline); new PG integration tests carry `#[ignore]` per repo convention.
- No route paths added/removed except none — the rider modifies handler signatures only (openapi drift guard unaffected).

---

### Task 1: Catalog patch + baseline

**Files:**
- Create: `hotel-app-be/database/postgres/patches/0008_notifications_email_triggers.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv` (append generation 1, version 8)
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql` (three CHECK constraint definitions + two settings seed rows)

- [ ] **Step 1: Write the patch** following `0004_booking_status_vocabulary.sql` verbatim structure for each of the three constraints:

```sql
DO $notifications_email_triggers$
DECLARE
    found_definition text;
    current_definition constant text := '<new pg_get_constraintdef text>';
    old_definition constant text := '<current def text>';
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO found_definition
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='email_deliveries'
      AND c.conname='<constraint_name>';
    IF found_definition IS NULL THEN RAISE EXCEPTION '...missing';
    ELSIF found_definition = old_definition THEN
        EXECUTE 'ALTER TABLE public.email_deliveries DROP CONSTRAINT <name>';
        EXECUTE $c$ ALTER TABLE public.email_deliveries ADD CONSTRAINT <name> CHECK (...) $c$;
    ELSIF found_definition <> current_definition THEN RAISE EXCEPTION '...diverged: %', found_definition;
    END IF;
END;
$notifications_email_triggers$;
```

Repeat for:
1. `email_deliveries_kind_check`: add `'checkout_receipt'::character varying, 'pre_arrival_reminder'::character varying`
2. `email_deliveries_kind_campaign_link`: extend second arm array to include both new kinds (still requiring `campaign_id IS NULL`)
3. `email_deliveries_topic_check`: add topics `'checkout_receipt', 'pre_arrival_reminder'`

Then seed settings:

```sql
INSERT INTO public.system_settings (key, value)
VALUES ('pre_arrival_reminder_enabled', 'false'),
       ('pre_arrival_reminder_hours_before', '48')
ON CONFLICT (key) DO NOTHING;
```

(Verify `system_settings` PK/uniqueness supports ON CONFLICT (key) during implementation; fall back to `WHERE NOT EXISTS` if not.)

- [ ] **Step 2: Mirror all four changes into `0001_v1_baseline.sql`** (edit the three constraint literals inline; append the same INSERT near other settings seeds).
- [ ] **Step 3: Manifest row** — compute checksum and append:

```bash
cd hotel-app-be/database/postgres/patches
shasum -a 256 0008_notifications_email_triggers.sql   # -> sha256:<hex>
printf '1\t8\tnotifications-email-triggers\tsha256:<hex>\t0008_notifications_email_triggers.sql\n' >> manifest.tsv
```

- [ ] **Step 4: Verify against live PG**

Run: `psql "$DATABASE_URL" -f database/postgres/patches/_begin.sql -f database/postgres/patches/0008_notifications_email_triggers.sql -f database/postgres/patches/_end.sql` then `make db-patch` dry expectations; confirm re-run is a no-op ("skipped").
Expected: applies once, second apply skips via catalog.

- [ ] **Step 5: Commit** — `feat(db): patch 0008 widen email delivery kinds and add reminder settings`

### Task 2: Kind-aware consent gate

**Files:**
- Modify: `hotel-app-be/src/modules/communications/repository.rs` (add `is_guest_active`)
- Modify: `hotel-app-be/src/modules/communications/models.rs` or `validation.rs` (add `TRANSACTIONAL_KINDS`)
- Modify: `hotel-app-be/src/modules/communications/worker.rs:120-140`

- [ ] **Step 1:** Add const (validation.rs):

```rust
/// Kinds that are part of the service (booking lifecycle) rather than
/// marketing: they bypass per-topic subscriptions but still honor hard
/// suppressions (bounce/complaint/manual).
pub const TRANSACTIONAL_KINDS: [&str; 6] = [
    "booking_confirmation",
    "online_room_assignment",
    "payment_receipt_request",
    "payment_rejected",
    "checkout_receipt",
    "pre_arrival_reminder",
];
```

- [ ] **Step 2:** Repository:

```rust
/// Existence + activity check used for transactional deliveries, which do
/// not require any notification_subscriptions row.
pub async fn is_guest_active(pool: &DbPool, guest_id: i64) -> Result<bool, ApiError> {
    let count: i64 = query_scalar(
        "SELECT COUNT(*) FROM guests g WHERE g.id = $1 AND g.is_active IS TRUE",
    )
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .map_err(ApiError::from)?;
    Ok(count > 0)
}
```

- [ ] **Step 3:** Worker branch (worker.rs ~124):

```rust
let deliverable =
    if crate::modules::communications::validation::TRANSACTIONAL_KINDS
        .contains(&delivery.kind.as_str())
{
    Repo::is_guest_active(pool, delivery.guest_id).await?
} else {
    Repo::is_guest_deliverable(pool, delivery.guest_id, &delivery.topic).await?
};
```

Adjust the skip reason string when `!deliverable && transactional` to `"guest inactive"`.

- [ ] **Step 4:** Unit test the classification (validation tests block): every kind inserted today outside campaigns ∈ TRANSACTIONAL_KINDS; campaign/birthday_voucher ∉.
- [ ] **Step 5:** Gates + commit — `fix(comms): transactional deliveries bypass topic subscriptions`

### Task 3: Checkout receipt

**Files:**
- Modify: `hotel-app-be/src/repositories/bookings/lifecycle.rs:1943-1950` (capture invoice number; enqueue)
- Test: `hotel-app-be/tests/booking_service.rs` (extend existing checkout coverage)

- [ ] **Step 1:** In the checked-out branch, replace the discarded-result call:

```rust
match crate::services::payments::ensure_invoice_for_booking(&pool, booking_id, user_id).await {
    Ok(invoice_number) => {
        if let Err(e) = enqueue_checkout_receipt(
            &pool, booking_id, user_id, &invoice_number,
        ).await {
            log::warn!("Failed to queue checkout receipt for booking {booking_id}: {e}");
        }
    }
    Err(e) => log::warn!(
        "Failed to create invoice for checked-out booking {}: {}", booking_id, e
    ),
}
```

- [ ] **Step 2:** Implement `enqueue_checkout_receipt(pool, booking_id, user_id, invoice_number)` beside the branch (same file or `services/communications_bridge.rs` if cleaner):
  - Load guest email + company flag: skip silently when `guests.email` null/blank or the booking is company-billed (`company_id IS NOT NULL`).
  - Pull summary data: room type/number, check-in/out dates, nights count, total amount, paid total (reuse `completed_booking_payment_total`), balance.
  - Build subject `"Your receipt for booking {number}"` + HTML mirroring the inline style of `guest_booking/service.rs:704-737` (use `html_escape`), including unsubscribe footer via the same helper scheduler uses (`unsubscribe_footer_html` — move/re-export if needed).
  - Enqueue via existing `CommunicationsRepository::insert_delivery_tx` in its own short tx with `kind/topic: "checkout_receipt"`, `idempotency_key: format!("checkout-receipt:{invoice_number}")`.

- [ ] **Step 3:** Integration test (`#[ignore]`): check out a paid booking through the existing service path → exactly one `email_deliveries` row with that key; re-run transition-safe path (call enqueue twice / re-checkout flow) → still one row. Company-billed fixture → zero rows.
- [ ] **Step 4:** Gates + commit — `feat(comms): email the checkout receipt from the durable outbox`

### Task 4: Pre-arrival reminder

**Files:**
- Modify: `hotel-app-be/src/modules/communications/repository.rs` (add `due_pre_arrival_bookings`)
- Modify: `hotel-app-be/src/modules/communications/scheduler.rs` (tick + loop registration)
- Tests: scheduler inline unit tests + `#[ignore]` integration

- [ ] **Step 1:** Pure helpers (unit-testable, in scheduler.rs):

```rust
fn reminder_window_days(hours_before: i32) -> i64 {
    ((hours_before.clamp(2, 168) as f64) / 24.0).ceil() as i64
}
fn reminder_enabled(raw_enabled: &str) -> bool { raw_enabled == "true" }
```

- [ ] **Step 2:** Repository selection (one statement, restart-safe):

```sql
SELECT b.id, b.booking_number, g.full_name, g.email, b.check_in_date, b.check_out_date, r.room_number, rt.name AS room_type
FROM bookings b
JOIN guests g ON g.id = b.guest_id
LEFT JOIN rooms r ON r.id = b.room_id
LEFT JOIN room_types rt ON rt.id = r.room_type_id
WHERE b.status IN ('confirmed','pending')
  AND b.check_in_date >= $1 AND b.check_in_date <= ($1::date + ($2 || ' days')::interval)
  AND COALESCE(g.email, '') <> ''
  AND NOT EXISTS (
      SELECT 1 FROM email_deliveries ed
      WHERE ed.idempotency_key = 'pre-arrival:' || b.id::text
  )
LIMIT 500
```

- [ ] **Step 3:** Tick:

```rust
pub async fn tick_pre_arrival_reminders(pool: &DbPool) -> Result<usize, ApiError> {
    if !reminder_enabled(&settings_cache::get_string(pool, "pre_arrival_reminder_enabled", "false").await) {
        return Ok(0);
    }
    let hours = settings_cache::get_i32(pool, "pre_arrival_reminder_hours_before", 48).await;
    let days = reminder_window_days(hours);
    let today = Repo::hotel_local_date(pool).await?;
    let due = Repo::due_pre_arrival_bookings(pool, today, days).await?;
    let mut queued = 0;
    for b in due {
        // build subject/html (stay summary + portal link), insert_delivery_tx
        // kind/topic "pre_arrival_reminder", key pre-arrival:{id}; ON CONFLICT dedupes
    }
    Ok(queued)
}
```

Register in the spawn loop after birthday tick with warn-on-error like siblings.

- [ ] **Step 4:** Unit tests: window math (2→1d? no: 2h→1d ceil, 48→2, 168→7, clamp bounds); disabled flag short-circuits (no pool hit needed beyond flag).
- [ ] **Step 5:** Integration (`#[ignore]`): confirmed booking arriving tomorrow → first tick queues one row keyed `pre-arrival:{id}`; second tick queues none; disabled setting → none.
- [ ] **Step 6:** Gates + commit — `feat(comms): pre-arrival reminder emails from the scheduler`

### Task 5: Unsubscribe route limiter

**Files:**
- Modify: `hotel-app-be/src/modules/communications/handlers.rs:383-398` (both handlers)

- [ ] **Step 1:** Add `Extension(limiters): Extension<RateLimiters>`, `ConnectInfo(peer_addr)`, `HeaderMap` extraction; `extract_client_ip` (crate::routes exposes it as pub(crate) — reuse via existing import path or make it accessible the way ekyc does, M15 pattern); call `limiters.sensitive.check_with_retry(ip)` and return `ApiError::TooManyRequestsRetryAfter` on denial (mirror auth.rs:59-77).
- [ ] **Step 2:** Unit/integration check per existing limiter test conventions (`tests/rate_limiter_tests.rs`) if the tier is already covered — otherwise assert 429 after burst via handler-level test.
- [ ] **Step 3:** Gates + commit — `fix(comms): meter the public unsubscribe endpoints`

### Task 6: Full verification

- [ ] `cargo clippy --all-features -- -D warnings`
- [ ] `unset DATABASE_URL; cargo test --all-features` → suite exits 0 at ~209-baseline + new unit tests
- [ ] With `DATABASE_URL`: run the new `#[ignore]` tests by name + full suite (expect prior max ≈706 passing plus additions)
- [ ] FE untouched: `bun run typecheck && bun run lint && bun run test` from hotel-web-fe stays green before merge
- [ ] Tracker: delete the Notifications v2 open item from `docs/ongoing-dev.md` "Decisions needed"; leave SMS noted as future spec
