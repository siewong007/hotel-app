# Anonymous Booking Nickname Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous bookers enter a unique nickname stored in `guests.nick_name` (renamed from `full_name`); a taken name returns 409 `guest_name_taken` instead of `Name (2)`; staff enter legal first/last at check-in without changing `nick_name`.

**Architecture:** Keep the unique identifier as one column on `guests`, renamed to `nick_name`. Anonymous create writes the nickname into `nick_name` and `first_name` with `last_name` NULL. Check-in patches first/last only. Guest JSON exposes `nick_name`, `first_name`, and `last_name`. Do not rename `users.full_name` or eKYC `full_name`.

**Tech Stack:** Rust/Axum/SQLx backend, PostgreSQL 19 (V1 baseline + catalog patch), React/MUI/Vitest guest portal and check-in UI, en/ms i18n.

**Spec:** `docs/superpowers/specs/2026-09-09-anonymous-booking-nickname-design.md`

## Global Constraints

- Never store `Name (2)` / `Name (N)` suffixes on guest identifier insert.
- Unique index stays case-insensitive trimmed: `lower(trim(nick_name))` where `deleted_at IS NULL`.
- Anonymous wire field remains `guest.first_name` (the nickname). Do not send `last_name`.
- 409 body for a taken nickname: `{ "error": "...", "code": "guest_name_taken" }` via `ApiError::GuestNameTaken`.
- Check-in must not UPDATE `guests.nick_name`.
- Schema: edit V1 baseline **and** add idempotent patch `0011_guest_nick_name.sql`; update baseline SHA-256 pins; sync desktop schema from backend (no hand-edit).
- Do not rename `users.full_name` or `ekyc_verifications.full_name`.
- English and Malay copy for guest-portal nickname strings.
- Work on `feature/anonymous-booking-nickname`, not `master`.

## File map

- `hotel-app-be/src/core/error.rs` — `GuestNameTaken`
- `hotel-app-be/src/modules/guest_booking/{validation,repository,service,models}.rs` — nickname validate/insert, no suffix
- `hotel-app-be/src/models/guest.rs` + `hotel-app-be/src/repositories/guest.rs` — `nick_name`, expose first/last
- `hotel-app-be/src/repositories/auth.rs` — unique-violation constraint name
- All `g.full_name` / `guests.full_name` SQL in `hotel-app-be/src` (not `users.full_name`)
- `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql` + `patches/0011_guest_nick_name.sql` + `manifest.tsv` + `_begin.sql` checksum + `seed.sql` checksum
- `deploy/deploy.sh` and `deploy/deploy-staging.sh` payload lists
- Desktop copies via existing sync, not hand-edit
- `hotel-web-fe/src/types/guest.types.ts` and `guest.full_name` consumers
- `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx` (+ anonymous test)
- `hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.tsx` (+ test)
- `hotel-web-fe/src/i18n/resources/{en,ms}/guestPortal.json`

---

### Task 1: `ApiError::GuestNameTaken`

**Files:**
- Modify: `hotel-app-be/src/core/error.rs`
- Test: same file, `#[cfg(test)]`

**Interfaces:**
- Consumes: existing `ApiError` / `IntoResponse`
- Produces: `ApiError::GuestNameTaken` → HTTP 409 `{ "error": "This nickname is already used. Please choose another.", "code": "guest_name_taken" }`

- [ ] **Step 1: Write the failing test**

Add at the bottom of `error.rs`:

```rust
#[cfg(test)]
mod guest_name_taken_tests {
    use super::ApiError;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    #[tokio::test]
    async fn guest_name_taken_is_conflict_with_stable_code() {
        let response = ApiError::GuestNameTaken.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
        assert_eq!(json["code"], "guest_name_taken");
        assert!(json["error"].as_str().unwrap().to_lowercase().contains("nickname"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd hotel-app-be && cargo test --lib guest_name_taken_is_conflict_with_stable_code -- --nocapture`

Expected: compile error `no variant named GuestNameTaken`

- [ ] **Step 3: Write minimal implementation**

Add variant `GuestNameTaken` (no payload). Display: `Conflict: nickname taken`. In `IntoResponse` status map: 409 + polished message `"This nickname is already used. Please choose another."`. After the `ProfileIncomplete` special body, handle:

```rust
if let ApiError::GuestNameTaken = &self {
    let body = Json(serde_json::json!({
        "error": message,
        "code": "guest_name_taken"
    }));
    return (status, body).into_response();
}
```

Match `GuestNameTaken` in `Display` and the status `match`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd hotel-app-be && cargo test --lib guest_name_taken_is_conflict_with_stable_code`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hotel-app-be/src/core/error.rs
git commit -m "feat(api): return 409 guest_name_taken for duplicate nicknames"
```

---

### Task 2: Stop `Name (2)` on anonymous insert

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/validation.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/service.rs` (map unique violation to `GuestNameTaken`)
- Modify: `hotel-app-be/tests/guest_portal_postgres.rs`
- Test: `repository.rs` unit module + postgres test

**Interfaces:**
- Consumes: `ValidatedAnonymousGuest { nick_name: String, first_name: String, last_name: Option<String>, ... }`
- Produces: `insert_anonymous_guest_tx` inserts `nick_name` once; on unique violation rolls SAVEPOINT and returns `ApiError::GuestNameTaken`

- [ ] **Step 1: Write the failing tests**

Replace `anonymous_guest_name_tests` so the suffix helper is gone and insert is expected to fail when taken. Change postgres test `postgres_anonymous_guest_insert_retries_when_the_name_is_taken` to:

```rust
let result = GuestBookingRepository::insert_anonymous_guest_tx(&mut tx, &details, "en").await;
tx.rollback().await.ok();
assert!(matches!(result, Err(ApiError::GuestNameTaken)));
let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM guests WHERE id = $1")
    .bind(existing_id)
    .fetch_one(&pool)
    .await
    .unwrap();
assert_eq!(count, 1);
```

Do not expect `format!("{base_name} (2)")`.

In `validation.rs` tests add:

```rust
#[test]
fn anonymous_guest_uses_first_name_as_nickname_without_last_name() {
    let guest = validate_anonymous_guest(&AnonymousGuestDetails {
        first_name: "Alex".into(),
        last_name: Some("   ".into()),
        email: "alex@hotel.test".into(),
        phone: None,
        tourism_type: "local".into(),
    })
    .unwrap();
    assert_eq!(guest.nick_name, "Alex");
    assert_eq!(guest.first_name, "Alex");
    assert!(guest.last_name.is_none());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hotel-app-be && cargo test --lib anonymous_guest_uses_first_name_as_nickname_without_last_name`

Expected: FAIL — `nick_name` not on struct / last_name still Some / `disambiguated_full_name` still present.

- [ ] **Step 3: Write minimal implementation**

- Rename `ValidatedAnonymousGuest.full_name` → `nick_name`. Always `nick_name = first_name`; ignore/drop last_name (treat blank as None). Validation error for empty first_name: `"Please enter a nickname"`.
- Delete `disambiguated_full_name` and the 1..=50 loop.
- `insert_anonymous_guest_tx`: one INSERT of `nick_name, first_name, last_name, ...` under SAVEPOINT. On `is_guest_name_unique_violation`, ROLLBACK TO SAVEPOINT, return `ApiError::GuestNameTaken`. Other errors still abort.
- `create_anonymous` uses `guest.nick_name` for emails that currently use `guest.full_name`.

Keep using column name `full_name` in SQL **until Task 3** if the rename is not in yet. If Task 3 is not merged, this task still compiles against `full_name` in SQL while the Rust field is `nick_name` bound to `full_name` column. Prefer doing Task 3 immediately after this commit if SQL would otherwise disagree.

**Order lock:** implement Task 3 schema first if insert SQL cannot compile against `nick_name` yet. If executing in order, Task 2 SQL still says `full_name` and Task 3 switches the identifier.

- [ ] **Step 4: Run tests**

Run: `cd hotel-app-be && cargo test --lib anonymous_guest_uses_first_name -- --nocapture`

If `DATABASE_URL` is set: `cargo test --all-features postgres_anonymous_guest_insert -- --nocapture`

Expected: unit PASS; postgres test PASS when DB available (fail-closed if it still writes `(2)`).

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(guest-booking): reject duplicate anonymous nicknames instead of suffixing"
```

---

### Task 3: Rename `guests.full_name` → `nick_name` (schema)

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql` (column, three indexes, `booking_summary`, AGE label properties, any other `guests.full_name`)
- Create: `hotel-app-be/database/postgres/patches/0011_guest_nick_name.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Modify: baseline checksum pins in `patches/_begin.sql`, `seed.sql`, `hotel-app-be/tests/status_vocabulary.rs`, `hotel-app-be/tests/postgres_patch_catalog.rs`, `hotel-desktop/src-tauri/src/postgres.rs` **only via desktop sync if that file is generated; if it is a pin, update it**
- Modify: `deploy/deploy.sh`, `deploy/deploy-staging.sh` (add `database/patches/0011_guest_nick_name.sql` to `required_payload`)
- Test: `hotel-app-be/tests/postgres_patch_catalog.rs` (manifest last entry)

**Interfaces:**
- Produces: live DBs rename column/indexes; fresh installs already have `nick_name`

- [ ] **Step 1: Write the failing catalog assertion**

In `postgres_patch_catalog.rs` after the ordered-windows check, assert the last entry is version 11 / `guest-nick-name` / `0011_guest_nick_name.sql`. Checksum can be filled after the file exists; first run should fail “manifest last version is 10”.

- [ ] **Step 2: Run to verify fail**

Run: `cd hotel-app-be && cargo test --test postgres_patch_catalog postgres_patch_manifest_is_ordered -- --nocapture`

Expected: FAIL last version != 11

- [ ] **Step 3: Schema + patch**

Baseline: rename column and indexes (`idx_guests_nick_name`, `idx_guests_nick_name_trgm`, `idx_guests_nick_name_unique`). Update `CREATE VIEW booking_summary` to `g.nick_name AS guest_name`. Update AGE `PROPERTIES` list.

Patch `0011_guest_nick_name.sql` (idempotent):

```sql
DO $guest_nick_name$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guests' AND column_name = 'full_name'
    ) THEN
        ALTER TABLE public.guests RENAME COLUMN full_name TO nick_name;
    END IF;

    IF to_regclass('public.idx_guests_full_name') IS NOT NULL THEN
        ALTER INDEX public.idx_guests_full_name RENAME TO idx_guests_nick_name;
    END IF;
    IF to_regclass('public.idx_guests_full_name_trgm') IS NOT NULL THEN
        ALTER INDEX public.idx_guests_full_name_trgm RENAME TO idx_guests_nick_name_trgm;
    END IF;
    IF to_regclass('public.idx_guests_full_name_unique') IS NOT NULL THEN
        ALTER INDEX public.idx_guests_full_name_unique RENAME TO idx_guests_nick_name_unique;
    END IF;
END
$guest_nick_name$;
```

Also `CREATE OR REPLACE VIEW public.booking_summary` matching the baseline (guest_name from `g.nick_name`). Follow 0010 style: preflight `guests` exists; wrap with catalog `_begin`/`_end` as other patches do.

Checksum: `python3 -c "import hashlib,pathlib; p=pathlib.Path('hotel-app-be/database/postgres/patches/0011_guest_nick_name.sql'); print('sha256:'+hashlib.sha256(p.read_bytes()).hexdigest())"`

Manifest row: `1	11	guest-nick-name	sha256:<digest>	0011_guest_nick_name.sql`

Recompute V1 baseline file sha256 the same way; replace `sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d` in `_begin.sql`, `seed.sql`, and tests that pin it.

Run `make prepare-desktop` (uses `sync-desktop-resources.mjs`) so `hotel-desktop/src-tauri/database/postgres/` matches the backend. Do not hand-edit those copies.

- [ ] **Step 4: Run catalog tests**

Run: `cd hotel-app-be && cargo test --test postgres_patch_catalog -- --nocapture`

Expected: PASS (checksums match, last patch 11)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): rename guests.full_name to nick_name"
```

---

### Task 4: Application SQL/Rust `guests.full_name` → `nick_name`

**Files:**
- Modify: every `hotel-app-be/src/**/*.rs` and `hotel-app-be/tests/**/*.rs` that references **guests** `full_name` (INSERT/SELECT/UPDATE/ORDER BY, `Guest.full_name`, `GuestCreateValues.full_name`, `full_name_conflict_id`)
- Modify: `hotel-app-be/src/repositories/auth.rs` constraint `idx_guests_nick_name_unique`
- Do **not** change `users.full_name` or eKYC `full_name`

**Interfaces:**
- Produces: `Guest.nick_name: String`; `GuestRepository::nick_name_conflict_id`; staff create still sets `nick_name` from first + last

- [ ] **Step 1: Write a failing compile/test probe**

Change `guests_rates_loyalty.rs` fixture SQL from `INSERT INTO guests (id, full_name, ...)` to `nick_name` first if Task 3 landed; or add:

```rust
assert!(sqlx::query_scalar::<_, String>("SELECT nick_name FROM guests WHERE id = $1")
```

in an existing postgres test that currently selects `full_name`.

- [ ] **Step 2: Run to fail**

Run a focused guests test; expect SQL/column errors until rename is complete.

- [ ] **Step 3: Rename mechanically**

- Struct fields on guest domain types: `full_name` → `nick_name` (serde JSON `nick_name`).
- SQL against `guests`: column `nick_name`.
- `full_name_conflict_id` → `nick_name_conflict_id` (same `LOWER(TRIM(...))` query on `nick_name`).
- Staff/register still `format!("{} {}", first, last)` into `nick_name`.
- Unique violation helper: `idx_guests_nick_name_unique`.
- Test fixtures: `INSERT INTO guests (..., nick_name, ...)`.
- Leave `users.full_name` and `ekyc_verifications.full_name` untouched (verify with `rg 'users \(.*full_name'` vs `guests \(.*full_name'`).

- [ ] **Step 4: Compile**

Run: `cd hotel-app-be && cargo check --all-features && cargo test --lib --offline` (skip offline if needed)

Expected: check passes. Lib tests pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(guests): rename guest identifier field to nick_name"
```

---

### Task 5: Expose `first_name` and `last_name` on Guest JSON

**Files:**
- Modify: `hotel-app-be/src/models/guest.rs` (`Guest`)
- Modify: guest SELECT lists in `repositories/guest.rs` (and any `query_as::<_, Guest>`)
- Modify: `hotel-web-fe/src/types/guest.types.ts`

**Interfaces:**
- Produces: `Guest { nick_name, first_name: Option<String>, last_name: Option<String>, ... }`

- [ ] **Step 1: Failing frontend type usage in check-in test** (can land with Task 7). Backend: add a unit/integration read that `find_by_id` returns `last_name`.

- [ ] **Step 2: Run to fail** — missing fields on `Guest`.

- [ ] **Step 3: Add columns to `Guest` and every matching SELECT (`first_name`, `last_name`). serde: include them. Frontend `Guest` type: `nick_name: string; first_name?: string | null; last_name?: string | null`.

- [ ] **Step 4: `cargo check --all-features`**

- [ ] **Step 5: Commit** `feat(guests): return first_name and last_name on guest payloads`

---

### Task 6: Anonymous booking UI

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx`
- Modify: `hotel-web-fe/src/i18n/resources/en/guestPortal.json`
- Modify: `hotel-web-fe/src/i18n/resources/ms/guestPortal.json`
- Test: `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPageAnonymous.test.tsx`

**Interfaces:**
- Consumes: 409 `{ code: "guest_name_taken" }`
- Produces: Nickname field; create body `guest.first_name` only

- [ ] **Step 1: Write failing tests**

Update existing “First name” queries to Nickname. Add:

```ts
it('keeps the guest on review when the nickname is taken', async () => {
  await reachReviewStep();
  fireEvent.change(screen.getByRole('textbox', { name: /Nickname/ }), {
    target: { value: 'Ahmad' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /Email/ }), {
    target: { value: 'ahmad@example.com' },
  });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Guest type/ }));
  fireEvent.click(screen.getByRole('option', { name: /Local tourist/ }));
  acceptRequiredConsents();
  const err = new HTTPError(
    new Response(JSON.stringify({
      error: 'This nickname is already used. Please choose another.',
      code: 'guest_name_taken',
    }), { status: 409 }),
    new Request('http://test/booking/reservations'),
    { method: 'POST' } as never,
  );
  mocks.publicCreate.mockRejectedValueOnce(err);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
  expect(await screen.findByText(/already used/i)).toBeTruthy();
  expect(mocks.publicQuote.mock.calls.length).toBeGreaterThan(0);
  const quotesAfterSubmit = mocks.publicQuote.mock.calls.length;
  await screen.findByText(/already used/i);
  expect(mocks.publicQuote.mock.calls.length).toBe(quotesAfterSubmit); // no extra re-quote from the 409
  expect(screen.getByRole('textbox', { name: /Nickname/ })).toBeTruthy();
});
```

Construct `HTTPError` the same way other tests in this repo do if this constructor shape fails — match existing ky error helpers.

Also assert create payload omits `last_name` and sends `first_name: 'Ahmad'`.

i18n keys:

```json
"nickname": "Nickname",
"detailsHint": "A nickname holds the room. Legal name is collected at check-in.",
"errors": {
  "nickname": "Please enter a nickname.",
  "nicknameTaken": "This nickname is already used. Please choose another."
}
```

ms:

```json
"nickname": "Nama samaran",
"errors": {
  "nickname": "Sila masukkan nama samaran.",
  "nicknameTaken": "Nama samaran ini sudah digunakan. Sila pilih yang lain."
}
```

- [ ] **Step 2: `cd hotel-web-fe && bun run test src/features/guestPortal/booking/PortalBookingPageAnonymous.test.tsx --run`**

Expected: FAIL missing Nickname / still First name

- [ ] **Step 3: Implement**

- `GuestDetailsForm`: one Nickname `TextField` bound to `first_name`; remove last name field.
- `guestDetailsError`: missing nickname → `book.errors.nickname`.
- `readGuestNameTaken(error)` like `readProfileIncompleteFields` but 409 + `code === 'guest_name_taken'`.
- `submitAnonymousBooking` catch: if name taken, `setError(t('book.errors.nicknameTaken'))`, set nickname field error, **return without re-quote**.
- Create payload: no `last_name`.

- [ ] **Step 4: Re-run the test file + `bun run typecheck` on touched files (full typecheck if feasible)**

- [ ] **Step 5: Commit** `feat(guest-portal): collect a unique nickname for anonymous booking`

---

### Task 7: Check-in legal name without touching nick_name

**Files:**
- Modify: `hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.tsx`
- Test: `hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.test.tsx`
- Backend: confirm `apply_guest_update_tx` still does not set `nick_name` (already true). Add a postgres assertion in an existing check-in test if one writes first/last.

**Interfaces:**
- Consumes: `guest.nick_name`, `guest.last_name`
- Produces: editable required first/last; hint `Booked as: {nick_name}` when `!last_name`; `guest_update` without nick_name

- [ ] **Step 1: Failing test**

```tsx
it('asks for legal names on a nickname-only guest and does not split the nickname', async () => {
  render(
    <EnhancedCheckInModal
      open
      onClose={mocks.onClose}
      booking={booking}
      guest={{ ...guest, nick_name: 'CoolAlex', first_name: 'CoolAlex', last_name: null }}
      onCheckInSuccess={mocks.onCheckInSuccess}
    />,
  );
  expect(screen.getByText(/Booked as:\s*CoolAlex/)).toBeTruthy();
  expect(screen.getByLabelText(/First Name/i)).toHaveValue('');
  expect(screen.getByLabelText(/Last Name/i)).toHaveValue('');
  expect(screen.getByLabelText(/First Name/i)).not.toBeDisabled();
});
```

- [ ] **Step 2: Run test — FAIL** (fields disabled / split CoolAlex)

- [ ] **Step 3: Implement**

- Stop parsing `full_name`/`nick_name` into first/last.
- Prefill from `guest.first_name` / `guest.last_name` only when `last_name` is non-empty; otherwise empty strings.
- Enable first/last TextFields. Require both in `validateField`.
- Show `Booked as: {guest.nick_name}` when `!guest.last_name`.
- `guest_update` sends first_name, last_name, other fields — never nick_name.

- [ ] **Step 4: Re-run EnhancedCheckInModal tests**

- [ ] **Step 5: Commit** `feat(check-in): collect legal name without changing nick_name`

---

### Task 8: Display legal name on folios once last_name exists

**Files:**
- Add helper in backend where emails/invoices pick guest display name (prefer `booking_emails.rs` / invoice SELECT).
- Small unit test: `display_guest_name(nick, first, last) -> legal if last else nick`

```rust
pub fn display_guest_name(nick_name: &str, first_name: Option<&str>, last_name: Option<&str>) -> String {
    match (first_name.map(str::trim).filter(|s| !s.is_empty()), last_name.map(str::trim).filter(|s| !s.is_empty())) {
        (Some(first), Some(last)) => format!("{first} {last}"),
        _ => nick_name.trim().to_string(),
    }
}
```

Use for confirmation-style mail and invoice guest name **after** check-in. Booking boards / `booking_summary.guest_name` stay `nick_name`.

Search: keep matching `nick_name` and first/last (already searches first_name).

- [ ] Tests for the helper (fail, implement, pass)
- [ ] Commit `feat(guests): show legal name on folios after check-in`

---

### Task 9: Remaining frontend `guest.full_name` consumers

**Files:** `GuestsPage`, `GuestConfigurationPage`, `GuestProfileDialog`, `BookingsPage` (`guest_name: guest.full_name`), check-in verify/form, tests/fixtures.

Replace display/sort/split of `guest.full_name` with `guest.nick_name`. Guest configuration must not split nick_name into first/last when last_name exists — use API first/last.

- [ ] `bun run test` on touched feature tests
- [ ] `bun run typecheck` (must be clean for `nick_name`)
- [ ] Commit `refactor(web): use guest.nick_name in staff UI`

---

### Task 10: Verification

- [ ] `cd hotel-app-be && cargo fmt && cargo check --all-features && cargo clippy --all-features -- -D warnings`
- [ ] `cd hotel-app-be && cargo test --all-features` with `DATABASE_URL` set; confirm run count is a full suite, not ~209
- [ ] `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test -- --run`
- [ ] `rg -n "disambiguated_full_name|Name \(2\)|idx_guests_full_name_unique" hotel-app-be --glob '!**/0001_v1_baseline.sql'` should not hit live insert logic (baseline history of old name only in patch IF EXISTS)
- [ ] `rg "INSERT INTO guests.*full_name" hotel-app-be` should be empty

---

## Spec coverage

| Spec section | Task |
|---|---|
| Unique nickname, no `(2)` | 2 |
| 409 `guest_name_taken` | 1, 2, 6 |
| Column rename + indexes + view + patch 0011 | 3, 4 |
| Anonymous form Nickname, no last name | 6 |
| Check-in legal name, nick_name untouched | 7 |
| Display table (board vs folio) | 3 view, 8 |
| first/last on guest payload | 5 |
| en/ms | 6 |
| Do not rename users/eKYC full_name | 4 |
| Tests listed in spec | 1–7, 10 |
