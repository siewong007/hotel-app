# Deposit Restore + Cancel/Revert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore seven voided RM50 keycard deposits on production as Cash (with refund markers for the two checked-out stays), then ship a reversible deposit-cancel workflow: in-house deposit voids allowed on `payments:delete` (still blocked after checkout), a `revert-deposit-void` endpoint, and Cancel/Restore controls in the checkout modal.

**Architecture:** The `payments` ledger stays the only deposit authority. Cancel = existing `DELETE /payments/{id}` soft-void (relaxed for `deposit` rows); Revert = new `revert_deposit_void` repo/service/route flipping the newest voided deposit row back to `completed` and resyncing `bookings.deposit_*` via `sync_booking_deposit_mirror_tx`. FE changes live only in `CheckoutInvoiceModal` + `invoices.service.ts`.

**Tech Stack:** Rust/Axum/SQLx backend, React/TS (MUI, TanStack Query, ky) frontend, PostgreSQL. Spec: `docs/superpowers/specs/2026-09-14-deposit-cancel-revert-design.md`.

## Global Constraints

- PostgreSQL only: `param!(N)`/`$N` placeholders — never `?N`; no `NOW()` business-date math.
- `cargo check --all-features` must pass; `cargo clippy --all-features -- -D warnings` is the CI gate.
- Backend tests need `DATABASE_URL` (local `hotel-db` docker container: `postgres://hotel_admin:<pw>@127.0.0.1:5432/hotel_management` from `hotel-app-be/.env`); files skip silently without it — verify by run count.
- Route added → regenerate `docs/api/openapi.json` via `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift` (CI gate).
- Mutating handlers audit-log via `AuditLog::log_event`; audit action strings snake_case.
- FE: all HTTP via `src/api/client.ts` (ky `api`); never `fetch`; no `toISOString().split/slice`.
- **The main worktree is dirty with another session's PayPal-conflicts work** (`handlers/payments.rs`, `routes/payments.rs`, `services/audit.rs`, `repositories/audit.rs`, `docs/api/openapi.json`, FE paymentApprovals files). Do NOT revert those changes; do NOT commit them. Code tasks run in an isolated worktree (Task 0).
- Do not push. Commit style: `type(scope): summary` + Devin trailer.

---

### Task 0: Isolated worktree

**Files:** none (workspace setup)

- [ ] **Step 1: Create the worktree**

```bash
cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app"
git worktree add .worktrees/deposit-cancel -b feat/deposit-cancel-revert master
cd .worktrees/deposit-cancel
```

- [ ] **Step 2: Install FE deps in the worktree** (bun.lock exists; node_modules is not shared)

```bash
cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/.worktrees/deposit-cancel/hotel-web-fe"
bun install
```

- [ ] **Step 3: Sanity-check the BE compiles in the worktree**

Run: `cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/.worktrees/deposit-cancel/hotel-app-be" && cargo check --all-features 2>&1 | tail -3`
Expected: `Finished` (first build may take a while — target dir is per-worktree).

---

### Task 1: Production data fix (manual runbook — no code changes)

**Files:** none. Runs against VPS `saliminn-db` over SSH. Independent of all code tasks; restores user-visible state immediately.

**Context:** Seven deposit rows were voided 2026-09-13 on prod (all RM50, notes "Deposit received (Cash)", wrong `payment_method`). Rooms 104/202/203/204/215 are `checked_in`; rooms 107 (booking 4783) and 111 (booking 4382) are `checked_out` and their cash was physically refunded (user-confirmed).

- [ ] **Step 1: Snapshot the tables**

```bash
cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app"
ssh -i deploy/credentials/aic-vps-ed25519 -p 20049 -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=deploy/credentials/aic-known-hosts \
  root@162.19.81.122 "docker exec saliminn-db psql -U hotel_admin -d hotel_management -c \"
    CREATE TABLE IF NOT EXISTS payments_bak_20260914 AS SELECT * FROM payments;
    CREATE TABLE IF NOT EXISTS bookings_bak_20260914 AS SELECT * FROM bookings;\""
```

Expected: two `SELECT …` completion lines. Verify: `… -c "SELECT count(*) FROM payments_bak_20260914"` is non-zero.

- [ ] **Step 2: Run the restore transaction**

```bash
ssh -i deploy/credentials/aic-vps-ed25519 -p 20049 -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=deploy/credentials/aic-known-hosts \
  root@162.19.81.122 "docker exec -i saliminn-db psql -U hotel_admin -d hotel_management -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE payments
   SET status = 'completed', payment_method = 'Cash'
 WHERE id IN (5585, 5587, 5589, 5592, 5594, 5596, 5598)
   AND payment_type = 'deposit' AND status = 'void';
UPDATE bookings b
   SET deposit_paid = true,
       deposit_amount = 50.00,
       deposit_paid_at = COALESCE(b.deposit_paid_at,
           (SELECT MIN(p.created_at) FROM payments p
             WHERE p.booking_id = b.id AND p.payment_type = 'deposit'
               AND p.status = 'completed')),
       updated_at = CURRENT_TIMESTAMP
 WHERE b.id IN (4722, 4715, 4794, 4795, 4796, 4783, 4382);
INSERT INTO payments
    (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
VALUES
    (gen_uuidv7(), 4783, 50.00, 'Cash', 'refund', 'refunded', 'Keycard deposit refund', 1000),
    (gen_uuidv7(), 4382, 50.00, 'Cash', 'refund', 'refunded', 'Keycard deposit refund', 1000);
COMMIT;
SQL"
```

Expected: `UPDATE 7`, `UPDATE 7`, `INSERT 0 2`, `COMMIT`. If any count differs, the transaction aborts (ON_ERROR_STOP) — re-check the WHERE clauses before retrying.

- [ ] **Step 3: Verify**

```bash
ssh -i deploy/credentials/aic-vps-ed25519 -p 20049 -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=deploy/credentials/aic-known-hosts \
  root@162.19.81.122 "docker exec saliminn-db psql -U hotel_admin -d hotel_management -c \"
SELECT b.id, r.room_number, b.status, b.payment_status, b.deposit_paid, b.deposit_amount,
       (SELECT string_agg(p.payment_type||':'||p.status||':'||p.amount::text, ' | ')
          FROM payments p WHERE p.booking_id = b.id AND p.payment_type IN ('deposit','refund')) AS deposit_ledger
FROM bookings b JOIN rooms r ON r.id = b.room_id
WHERE b.id IN (4722,4715,4794,4795,4796,4783,4382) ORDER BY r.room_number;\""
```

Expected: every row `deposit_paid=t`, `deposit_amount=50.00`; `payment_status` unchanged (`paid`); the two checked-out bookings show `deposit:completed:50.00 | refund:refunded:50.00`; the five in-house bookings show only `deposit:completed:50.00`.

---

### Task 2: Relax the in-house deposit void (backend)

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs` (in `void_payment_tx`, ~lines 2050-2085)
- Test: `hotel-app-be/tests/payment_characterization.rs` (rewrite `delete_completed_deposit_is_refused_once_the_booking_is_in_house`, ~line 4017)

**Interfaces:**
- Consumes: existing `payments::delete_payment(pool, user_id, payment_id)` service; `void_payment_tx(tx, booking_id, payment_id, user_id, allow_completed)`.
- Produces: deposit voids on `pending|reserved|confirmed|checked_in|auto_checked_in|late_checkout` bookings succeed on the route's `payments:delete` gate; `checked_out|completed` stays refused.

- [ ] **Step 1: Rewrite the characterization test to the new rules (failing test)**

In `payment_characterization.rs`, replace the whole `delete_completed_deposit_is_refused_once_the_booking_is_in_house` test (doc comment included) with:

```rust
/// Cancelling a recorded deposit is desk work on the `payments:delete` route
/// gate — a completed deposit on a pre-checkout or in-house booking voids
/// even without `payments:manage` (collateral, reversible via
/// revert-deposit-void). Once the stay is checked out the void stays refused:
/// post-checkout deposit money only moves through refund/forfeit.
/// `deposit_forfeited` rows keep the manage gate — kept income is a revenue
/// correction, not a desk cancellation.
#[tokio::test]
async fn delete_completed_deposit_voidable_in_house_refused_after_checkout() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_960, 940_961, 940_962, 940_963, 940_964);
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "checked_in",
            check_in: "2031-08-10",
            check_out: "2031-08-12",
            base_price: d("150.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    )
    .await;

    // In-house stays: the void succeeds without a payments:manage grant and
    // the mirror drops to "no deposit collected".
    for status in ["checked_in", "auto_checked_in"] {
        sqlx::query("UPDATE bookings SET status = $2 WHERE id = $1")
            .bind(booking_id)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        let deposit_id =
            insert_completed_payment(&pool, booking_id, "deposit", d("100.00"), actor_id).await;
        let voided = payments::delete_payment(&pool, actor_id, deposit_id).await;
        let row_status = fetch_payment_status(&pool, deposit_id).await;
        let mirror: bool = sqlx::query_scalar(
            "SELECT COALESCE(deposit_paid, false) FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            voided.is_ok(),
            "in-house deposit void must succeed on {status}: {voided:?}"
        );
        assert_eq!(row_status, "void", "the row must be kept as void on {status}");
        assert!(!mirror, "the mirror must drop after the void on {status}");
    }

    // Closed stays keep the refund/forfeit resolution path.
    for status in ["checked_out", "completed"] {
        sqlx::query("UPDATE bookings SET status = $2 WHERE id = $1")
            .bind(booking_id)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        let deposit_id =
            insert_completed_payment(&pool, booking_id, "deposit", d("100.00"), actor_id).await;
        let void = payments::delete_payment(&pool, actor_id, deposit_id).await;
        match void {
            Err(ApiError::BadRequest(message)) => assert!(
                message.contains("refund") && message.contains("forfeit"),
                "the refusal must name the refund/forfeit path, got: {message}"
            ),
            other => panic!(
                "voiding a completed deposit on a {status} booking must be refused, got: {other:?}"
            ),
        }
        assert_eq!(
            fetch_payment_status(&pool, deposit_id).await,
            "completed",
            "a refused void must leave the {status} deposit row completed"
        );
    }

    // Un-forfeit stays a manage-gated void.
    sqlx::query("UPDATE bookings SET status = 'checked_in' WHERE id = $1")
        .bind(booking_id)
        .execute(&pool)
        .await
        .unwrap();
    grant_role(&pool, actor_id, "manager").await;
    let forfeit_id =
        insert_completed_payment(&pool, booking_id, "deposit_forfeited", d("25.00"), actor_id)
            .await;
    let unforfeit = payments::delete_payment(&pool, actor_id, forfeit_id).await;
    assert!(
        unforfeit.is_ok(),
        "a deposit_forfeited row must stay voidable by payments:manage: {unforfeit:?}"
    );

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
}
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd hotel-app-be && DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" cargo test --all-features --test payment_characterization delete_completed_deposit_voidable_in_house_refused_after_checkout 2>&1 | tail -15`
Expected: FAIL — the in-house void returns `BadRequest` (old guard).

- [ ] **Step 3: Change `void_payment_tx`**

In `hotel-app-be/src/repositories/payment.rs`, inside `void_payment_tx` (~line 2060), replace the in-house deposit block:

```rust
        // A held deposit on an in-house booking is money owed back to the
        // guest — it can only leave through refund or forfeit, never a void.
        if existing.payment_type.as_deref() == Some("deposit")
            && existing.payment_status.as_deref() == Some("completed")
            && matches!(
                Self::booking_status_for_payment_tx(tx, booking_id)
                    .await?
                    .as_str(),
                "checked_in"
                    | "auto_checked_in"
                    | "late_checkout"
                    | "checked_out"
                    | "completed"
            )
        {
            return Err(ApiError::BadRequest(
                "Deposit payments can't be voided after check-in — \
                 refund or forfeit the deposit instead"
                    .to_string(),
            ));
        }
        if existing.payment_status.as_deref() == Some("completed") && !allow_completed {
            return Err(ApiError::Forbidden(
                "Voiding a posted payment requires the payments:manage permission".to_string(),
            ));
        }
```

with:

```rust
        // Once the stay is closed a deposit is a settled liability — it can
        // only leave through refund or forfeit, never a void. In-house stays
        // allow the void: a deposit recorded but never collected is cancelled
        // through this path (reversible via revert-deposit-void).
        if existing.payment_type.as_deref() == Some("deposit")
            && existing.payment_status.as_deref() == Some("completed")
            && matches!(
                Self::booking_status_for_payment_tx(tx, booking_id)
                    .await?
                    .as_str(),
                "checked_out" | "completed"
            )
        {
            return Err(ApiError::BadRequest(
                "Deposit payments can't be voided after checkout — \
                 refund or forfeit the deposit instead"
                    .to_string(),
            ));
        }
        // Deposit rows ride the route's payments:delete gate even when
        // completed — cancelling collateral is desk work, unlike voiding
        // settled revenue. deposit_forfeited rows keep the manage gate.
        if existing.payment_status.as_deref() == Some("completed")
            && !allow_completed
            && existing.payment_type.as_deref() != Some("deposit")
        {
            return Err(ApiError::Forbidden(
                "Voiding a posted payment requires the payments:manage permission".to_string(),
            ));
        }
```

(The mirror-resync block for `deposit|deposit_forfeited` voids further down is unchanged — it is what makes the booking show "no deposit collected".)

- [ ] **Step 4: Run the test — expect PASS**

Same command as Step 2. Expected: `test result: ok. 1 passed`.

- [ ] **Step 5: Run the neighboring void tests**

Run: `DATABASE_URL=… cargo test --all-features --test payment_characterization delete_ 2>&1 | tail -10`
Expected: all `delete_*` tests pass (incl. `delete_payment_voids_and_requires_manage_for_completed_rows` and `delete_completed_deposit_stays_voidable_before_check_in` — unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add hotel-app-be/src/repositories/payment.rs hotel-app-be/tests/payment_characterization.rs
git commit -m "payments: allow in-house deposit voids on payments:delete, keep post-checkout refusal

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3: `revert-deposit-void` endpoint (backend)

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs` (add `revert_deposit_void` after `revert_deposit_refund`, ~line 1500)
- Modify: `hotel-app-be/src/services/payments.rs` (add `revert_deposit_void` after `revert_deposit_refund`, ~line 703)
- Modify: `hotel-app-be/src/handlers/payments.rs` (add `revert_deposit_void_handler` after `revert_deposit_refund_handler`, ~line 86)
- Modify: `hotel-app-be/src/routes/payments.rs` (route + wrapper after `revert_deposit_refund`, ~lines 53-55 and ~165-171)
- Regenerate: `docs/api/openapi.json`
- Test: `hotel-app-be/tests/payment_characterization.rs` (append)

**Interfaces:**
- Produces: `PaymentRepository::revert_deposit_void(pool: &DbPool, booking_id: i64) -> Result<i64, ApiError>`; `payments::revert_deposit_void(pool, user_id, booking_id) -> Result<serde_json::Value, ApiError>` returning `{booking_id, reverted_payment_id, deposit_restored}`; `POST /api/payments/revert-deposit-void/{booking_id}` gated `payments:delete`.

- [ ] **Step 1: Write the failing test**

Append to `payment_characterization.rs`:

```rust
/// Reverting a voided deposit flips the newest voided row back to completed
/// and re-hangs the mirror — the cancel/revert pair round-trips without
/// touching settled payments. Works on checked-out stays too, and errors
/// when nothing voided exists.
#[tokio::test]
async fn revert_deposit_void_restores_the_newest_voided_row() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_970, 940_971, 940_972, 940_973, 940_974);
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "checked_in",
            check_in: "2031-08-10",
            check_out: "2031-08-12",
            base_price: d("150.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    )
    .await;

    let older =
        insert_completed_payment(&pool, booking_id, "deposit", d("50.00"), actor_id).await;
    let newer =
        insert_completed_payment(&pool, booking_id, "deposit", d("25.00"), actor_id).await;
    for id in [older, newer] {
        sqlx::query("UPDATE payments SET status = 'void' WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
    }

    let first = payments::revert_deposit_void(&pool, actor_id, booking_id).await;
    let first_id = first
        .as_ref()
        .ok()
        .and_then(|v| v["reverted_payment_id"].as_i64());
    let mirror_first: (bool, Option<Decimal>) = sqlx::query_as(
        "SELECT COALESCE(deposit_paid, false), deposit_amount FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let second = payments::revert_deposit_void(&pool, actor_id, booking_id).await;
    let second_id = second
        .as_ref()
        .ok()
        .and_then(|v| v["reverted_payment_id"].as_i64());
    let mirror_second: Option<Decimal> = sqlx::query_scalar(
        "SELECT deposit_amount FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // A checked-out stay can still be corrected.
    sqlx::query("UPDATE bookings SET status = 'checked_out' WHERE id = $1")
        .bind(booking_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE payments SET status = 'void' WHERE id = $1")
        .bind(newer)
        .execute(&pool)
        .await
        .unwrap();
    let on_checked_out = payments::revert_deposit_void(&pool, actor_id, booking_id).await;

    let drained = payments::revert_deposit_void(&pool, actor_id, booking_id).await;
    let audit = audit_log_exists(&pool, "deposit_void_reverted", newer).await;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;

    assert_eq!(
        first_id,
        Some(newer),
        "the newest voided row restores first: {first:?}"
    );
    assert!(
        mirror_first.0 && mirror_first.1 == Some(d("25.00")),
        "the mirror must re-hang at the restored amount: {mirror_first:?}"
    );
    assert_eq!(
        second_id,
        Some(older),
        "the next call restores the older row: {second:?}"
    );
    assert_eq!(mirror_second, Some(d("75.00")));
    assert!(
        on_checked_out.is_ok(),
        "revert must work on checked-out stays: {on_checked_out:?}"
    );
    assert!(
        matches!(drained, Err(ApiError::BadRequest(_))),
        "reverting with nothing voided must fail: {drained:?}"
    );
    assert!(audit, "the revert must write a deposit_void_reverted audit row");
}
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `DATABASE_URL=… cargo test --all-features --test payment_characterization revert_deposit_void 2>&1 | tail -10`
Expected: compile error / FAIL — `revert_deposit_void` does not exist.

- [ ] **Step 3: Add `PaymentRepository::revert_deposit_void`**

In `repositories/payment.rs`, directly after `revert_deposit_refund` (~line 1500), add:

```rust
    /// Revert a voided (cancelled) keycard deposit for a booking.
    ///
    /// Flips the newest `void` deposit row back to `completed` and resyncs the
    /// booking mirror, so a deposit cancelled by mistake becomes held again.
    /// The void's `processed_at`/`processed_by` stamps are left in place as
    /// history of the void. One row per call — when several voided deposits
    /// exist they are restored newest-first, so an older intentionally-voided
    /// row is never resurrected by accident. Works on any booking status
    /// (restoring a deposit on a checked-out stay is a legitimate correction).
    /// Returns the id of the restored payment.
    pub async fn revert_deposit_void(pool: &DbPool, booking_id: i64) -> Result<i64, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        let deposit_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM payments WHERE booking_id = $1 AND payment_type = 'deposit' \
             AND status = 'void' ORDER BY id DESC LIMIT 1",
        )
        .bind(booking_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        let deposit_id = match deposit_id {
            Some(id) => id,
            None => {
                return Err(ApiError::BadRequest(
                    "No voided deposit to revert".to_string(),
                ));
            }
        };

        sqlx::query("UPDATE payments SET status = 'completed' WHERE id = $1")
            .bind(deposit_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        Self::sync_booking_deposit_mirror_tx(&mut tx, booking_id).await?;

        tx.commit().await.map_err(ApiError::from)?;

        Ok(deposit_id)
    }
```

- [ ] **Step 4: Add the service function**

In `services/payments.rs`, directly after `revert_deposit_refund` (~line 703), add:

```rust
/// Revert a voided (cancelled) deposit — the row flips back to `completed`
/// and the booking mirror shows the deposit held again.
pub async fn revert_deposit_void(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let reverted_payment_id = PaymentRepository::revert_deposit_void(pool, booking_id).await?;

    recompute_payment_status(pool, booking_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "deposit_void_reverted",
            resource_type: "payment",
            resource_id: Some(reverted_payment_id),
            details: Some(serde_json::json!({
                "booking_id": booking_id,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(serde_json::json!({
        "booking_id": booking_id,
        "reverted_payment_id": reverted_payment_id,
        "deposit_restored": true,
    }))
}
```

- [ ] **Step 5: Add the handler**

In `handlers/payments.rs`, directly after `revert_deposit_refund_handler`, add:

```rust
/// Revert a voided (cancelled) deposit for a booking
pub async fn revert_deposit_void_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        payments::revert_deposit_void(&pool, user_id, booking_id).await?,
    ))
}
```

- [ ] **Step 6: Register the route**

In `routes/payments.rs`, in `routes()` after the `revert-deposit-refund` route (~line 53), add:

```rust
        .route(
            "/payments/revert-deposit-void/{booking_id}",
            post(revert_deposit_void),
        )
```

and after the `revert_deposit_refund` wrapper (~line 171), add:

```rust
// Cancelling a deposit is desk work on payments:delete (collateral, not
// settled revenue), so reverting the cancellation rides the same gate —
// not the payments:manage gate revert-deposit-refund uses.
async fn revert_deposit_void(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_DELETE).await?;
    handlers::payments::revert_deposit_void_handler(State(pool), Extension(user_id), path).await
}
```

- [ ] **Step 7: Build + test**

Run: `cd hotel-app-be && cargo check --all-features 2>&1 | tail -3 && DATABASE_URL=… cargo test --all-features --test payment_characterization revert_deposit_void 2>&1 | tail -8`
Expected: clean check; test PASS.

- [ ] **Step 8: Regenerate the OpenAPI spec**

Run: `cd hotel-app-be && HOTEL_APP_UPDATE_OPENAPI=1 DATABASE_URL=… cargo test --all-features --test openapi_drift 2>&1 | tail -5`
Expected: pass; `docs/api/openapi.json` gains the `revert-deposit-void` path. (Run in the worktree so the diff contains only this route, not the PayPal work.)

- [ ] **Step 9: Commit**

```bash
git add hotel-app-be/src/repositories/payment.rs hotel-app-be/src/services/payments.rs \
        hotel-app-be/src/handlers/payments.rs hotel-app-be/src/routes/payments.rs \
        hotel-app-be/tests/payment_characterization.rs docs/api/openapi.json
git commit -m "payments: add revert-deposit-void endpoint for cancelled deposits

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 4: FE service method

**Files:**
- Modify: `hotel-web-fe/src/api/invoices.service.ts` (after `revertDepositRefund`, ~line 84-89)
- Test: `hotel-web-fe/src/api/invoices.service.test.ts`

**Interfaces:**
- Produces: `InvoicesService.revertDepositVoid(bookingId: string | number): Promise<any>` → `POST payments/revert-deposit-void/{bookingId}`.

- [ ] **Step 1: Failing test**

Append to `invoices.service.test.ts` (the file already mocks `./client`'s `api.post` into a module-level `post` vi.fn — reuse it directly):

```typescript
describe('InvoicesService.revertDepositVoid', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('POSTs to the revert-deposit-void endpoint for the booking', async () => {
    const responsePayload = {
      booking_id: 42,
      reverted_payment_id: 7,
      deposit_restored: true,
    };
    post.mockReturnValue({ json: () => Promise.resolve(responsePayload) });

    const result = await InvoicesService.revertDepositVoid(42);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('payments/revert-deposit-void/42');
    expect(result).toEqual(responsePayload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    const httpError = buildKyHttpError(400, { error: 'No voided deposit to revert' });
    post.mockReturnValue({ json: () => Promise.reject(httpError) });

    await expect(InvoicesService.revertDepositVoid(42)).rejects.toMatchObject({
      message: 'No voided deposit to revert',
      statusCode: 400,
    });
    await expect(InvoicesService.revertDepositVoid(42)).rejects.toBeInstanceOf(APIError);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd hotel-web-fe && bun run test -- src/api/invoices.service.test.ts 2>&1 | tail -10`
Expected: FAIL — `revertDepositVoid` is not a function.

- [ ] **Step 3: Implement**

In `invoices.service.ts` after `revertDepositRefund`:

```typescript
  static async revertDepositVoid(bookingId: string | number): Promise<any> {
    try {
      return await api.post(`payments/revert-deposit-void/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, 'Failed to restore deposit');
    }
  }
```

- [ ] **Step 4: Run — expect PASS, then commit**

```bash
cd hotel-web-fe && bun run test -- src/api/invoices.service.test.ts 2>&1 | tail -5
git add src/api/invoices.service.ts src/api/invoices.service.test.ts
git commit -m "fe(api): add revertDepositVoid service method

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 5: CheckoutInvoiceModal cancel/restore UI

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`
- Test: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx`

**Interfaces:**
- Consumes: `InvoicesService.revertDepositVoid` (Task 4), `InvoicesService.deletePayment` (existing), `useAuth().hasPermission` (`'payments:delete'`), `useConfirm` (existing), `reloadPayments`/`setPayments`/`payments`/`invalidateInvoiceState` (existing props/state).
- Produces: `voidedDepositRows` derived from `payments`; `handleCancelDeposit`, `handleRestoreDeposit`.

- [ ] **Step 1: Failing tests**

In `CheckoutInvoiceModal.test.tsx`:

1. Extend the hoisted mocks object with `revertDepositVoid: vi.fn(), deletePayment: vi.fn(), hasPermission: vi.fn()`.
2. In the `vi.mock('../../../api/invoices.service', …)` block, change `deletePayment: vi.fn()` → `deletePayment: (...args: unknown[]) => mocks.deletePayment(...args)` and add `revertDepositVoid: (...args: unknown[]) => mocks.revertDepositVoid(...args)`.
3. Add a new mock (no such mock exists today — required once the component calls `useAuth`):

```typescript
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));
```

4. Add tests to the `CheckoutInvoiceModal deposit display + forfeit` describe:

```typescript
  it('shows Cancel deposit under payments:delete and calls deletePayment for each held deposit row', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'payments:delete');
    mocks.deletePayment.mockReset().mockResolvedValue({});
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');

    // Exact names: the trigger is 'Cancel deposit (recorded but not
    // collected)', the ConfirmProvider confirm button is 'Cancel deposit'.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel deposit (recorded but not collected)' }),
    );
    const confirmButton = await screen.findByRole('button', { name: 'Cancel deposit' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.deletePayment).toHaveBeenCalledWith(depositRow.id));
    expect(mocks.reloadPayments).toHaveBeenCalled();
  });

  it('hides Cancel deposit without payments:delete', async () => {
    mocks.hasPermission.mockReturnValue(false);
    renderModal(false, { deposit_paid: true, deposit_amount: 50 });
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('button', { name: 'Cancel deposit (recorded but not collected)' }),
    ).toBeNull();
  });

  it('shows Restore deposit when a voided deposit row exists and calls revertDepositVoid', async () => {
    mocks.hasPermission.mockImplementation((p: string) => p === 'payments:delete');
    mocks.revertDepositVoid.mockReset().mockResolvedValue({ deposit_restored: true });
    mocks.reloadPayments.mockReset().mockResolvedValue(undefined);
    mocks.payments = [{ ...depositRow, payment_status: 'void' }];
    renderModal(false, { deposit_paid: false });
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /^Restore deposit$/ }));
    await waitFor(() => expect(mocks.revertDepositVoid).toHaveBeenCalled());
    expect(mocks.reloadPayments).toHaveBeenCalled();
  });
```

Also add `mocks.hasPermission.mockReset().mockReturnValue(true);` in that describe's `beforeEach` so existing tests keep passing (any new `useAuth` call must not break them), and reset `mocks.payments` to `[depositRow, billPayment]` there (it already does).

- [ ] **Step 2: Run — expect FAIL**

Run: `cd hotel-web-fe && bun run test -- src/features/invoices/components/CheckoutInvoiceModal.test.tsx 2>&1 | tail -15`
Expected: FAIL — `useAuth`/buttons don't exist.

- [ ] **Step 3: Implement in CheckoutInvoiceModal.tsx**

1. Import (top, with the other imports):

```typescript
import { useAuth } from '../../../auth/AuthContext';
```

2. Inside the component near the other hooks (~line 104, after `const confirm = useConfirm();`):

```typescript
  const { hasPermission } = useAuth();
  const canCancelDeposit = !readOnly && !isLedgerView && hasPermission('payments:delete');
```

(`isLedgerView` already exists in this component — verify the exact name before using; if it differs, use the existing ledger-view flag.)

3. State (near `waivingDeposit` ~line 166):

```typescript
  const [cancellingDeposit, setCancellingDeposit] = useState(false);
  const [restoringDeposit, setRestoringDeposit] = useState(false);
```

4. Derived rows (near `depositPayments` ~line 237):

```typescript
  // Voided deposit rows are restorable — they arrive in the all-payments
  // payload but are filtered out of every displayed group.
  const voidedDepositRows = payments.filter(
    (payment) =>
      (payment.payment_type || '').toLowerCase() === 'deposit' &&
      payment.payment_status === 'void',
  );
```

5. Handlers (after `handleRevertDepositRefund` ~line 545):

```typescript
  // Cancelling marks the deposit "not collected": the deposit payment rows
  // are kept as void (money trail + audit stay intact) and the booking
  // mirror drops — the cancellation is reversible via Restore.
  const handleCancelDeposit = async () => {
    const depositRows = depositPayments.filter(
      (p) => (p.payment_type || '').toLowerCase() === 'deposit',
    );
    if (depositRows.length === 0) return;
    const accepted = await confirm({
      title: 'Cancel deposit',
      message: 'Marks the deposit as not collected. The payment record is kept as void and the cancellation can be reverted.',
      confirmText: 'Cancel deposit',
      severity: 'warning',
    });
    if (!accepted) return;
    try {
      setCancellingDeposit(true);
      for (const row of depositRows) {
        await InvoicesService.deletePayment(row.id);
      }
      await reloadPayments();
      invalidateInvoiceState();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to cancel deposit');
    } finally {
      setCancellingDeposit(false);
    }
  };

  const handleRestoreDeposit = async () => {
    try {
      setRestoringDeposit(true);
      await InvoicesService.revertDepositVoid(booking.id);
      await reloadPayments();
      invalidateInvoiceState();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to restore deposit');
    } finally {
      setRestoringDeposit(false);
    }
  };
```

6. Cancel button — inside the forfeit block (`{!readOnly && !depositRefunded && !depositForfeited && isPositiveMoney(recordedDeposit) && (` ~line 1376), as a new last `<Grid size={12}>` inside that Grid container, after the Forfeit row:

```tsx
                      {canCancelDeposit && (
                        <Grid size={12}>
                          <Button
                            size="small"
                            variant="text"
                            color="error"
                            onClick={handleCancelDeposit}
                            disabled={cancellingDeposit}
                            startIcon={cancellingDeposit ? <CircularProgress size={14} /> : undefined}
                            sx={{ fontSize: '0.75rem' }}
                          >
                            Cancel deposit (recorded but not collected)
                          </Button>
                        </Grid>
                      )}
```

7. Restore button — in the `else` branch that renders the "No Deposit Collected" chip (~line 1468-1490): inside the outer `<Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'hidden', mb: 3 }}>`, after the inner `<Box sx={{ p: 1.5, bgcolor: '#e3f2fd' }}>…</Box>` closes:

```tsx
                {canCancelDeposit && voidedDepositRows.length > 0 && (
                  <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleRestoreDeposit}
                      disabled={restoringDeposit}
                      startIcon={restoringDeposit ? <CircularProgress size={14} /> : undefined}
                      sx={{ fontSize: '0.75rem' }}
                    >
                      Restore deposit{voidedDepositRows.length > 1 ? ` (${voidedDepositRows.length} cancelled)` : ''}
                    </Button>
                  </Box>
                )}
```

- [ ] **Step 4: Run — expect PASS, verify lint/typecheck**

Run: `cd hotel-web-fe && bun run test -- src/features/invoices/components/CheckoutInvoiceModal.test.tsx 2>&1 | tail -8 && bun run typecheck 2>&1 | tail -3 && bun run lint 2>&1 | tail -5`
Expected: tests pass; typecheck clean; lint clean.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx \
        hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx
git commit -m "fe(invoices): deposit cancel + restore controls in checkout modal

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 6: Verification sweep + spec note

**Files:** none new; commit doc tweak if the spec needs a post-implementation note.

- [ ] **Step 1: Backend gates**

Run (in worktree): `cd hotel-app-be && cargo check --all-features 2>&1 | tail -3 && cargo clippy --all-features -- -D warnings 2>&1 | tail -5`
Expected: both clean.

- [ ] **Step 2: Backend tests**

Run: `DATABASE_URL=… cargo test --all-features --test payment_characterization --test deposit_checkout_guard --test openapi_drift 2>&1 | tail -15`
Expected: all pass; confirm real run counts (not the early-return skip).

- [ ] **Step 3: Frontend gates**

Run: `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test -- src/features/invoices src/api/invoices.service.test.ts 2>&1 | tail -10`
Expected: all pass.

- [ ] **Step 4: Review the diff**

`git log --oneline master..HEAD && git diff master...HEAD --stat` — confirm: payment.rs, services/payments.rs, handlers/payments.rs, routes/payments.rs, payment_characterization.rs, openapi.json, invoices.service.ts(+test), CheckoutInvoiceModal.tsx(+test). No PayPal/conflicts hunks.

- [ ] **Step 5: Report to user** — list commits, test counts, and the state of the prod fix; ask about merging `feat/deposit-cancel-revert` into master (do not merge/push unprompted — another session owns the dirty main tree).

---

## Self-review notes

- Spec coverage: Part 1 prod fix → Task 1; Part 2 void relaxation → Task 2; Part 3 revert endpoint → Task 3; Part 4 FE → Tasks 4-5. Overpayment regression: existing modal tests must stay green (Step 5.4 + Task 6).
- The `deposit_payment_method` record-side fix is already merged on master — deliberately absent from this plan.
- Revert restores newest-first, one row per call (spec decision); checked-out bookings can be reverted but never voided.
