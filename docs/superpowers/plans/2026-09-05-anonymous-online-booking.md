# Anonymous Online Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors search, reserve, and pay for a room without an account or guest-portal session.

**Architecture:** A public booking API provides standard-rate search and quote operations, then creates a standalone guest record and a pending-payment booking in one transaction. A 256-bit booking-payment capability is stored as a SHA-256 hash in a new table and authorizes only that booking's payment operations. The React public page owns the anonymous funnel and reuses the shared payment UI through a new anonymous mode.

**Tech Stack:** Axum, SQLx/PostgreSQL, Rust, React 19, TypeScript, TanStack Router, MUI, Vitest, existing PayPal/bank-transfer services.

## Global Constraints

- Guest name is required; email and phone are optional.
- Never create a `users` record, authenticate the browser, or create a guest-portal session.
- Anonymous flows use standard online prices only: no voucher, loyalty, member, or complimentary-night adjustments.
- Never deduplicate anonymous guests by name, email, or phone: these values are unverified, and an incorrect match would expose or merge another person's history. Create one guest record per successful anonymous booking.
- The raw payment capability is returned once after booking creation, never logged or stored in browser persistence; the database stores only its SHA-256 hash.
- Existing signed-in portal and pre-check-in token routes retain their paths and behavior.
- New public search, quote, and creation handlers use per-IP rate limits, revalidate price/availability server-side, and require the existing `client_request_id` for idempotency.
- Schema changes update `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`, a new immutable numbered patch plus `manifest.tsv`, and `hotel-app-be/database/README.md`.
- Add no dependencies.

---

## File structure

- `hotel-app-be/src/modules/guest_booking/models.rs` — public request/response DTOs with no account-only fields.
- `hotel-app-be/src/modules/guest_booking/anonymous.rs` — public HTTP handlers and the narrow token-payment endpoints.
- `hotel-app-be/src/modules/guest_booking/service.rs` — public search/quote and anonymous booking transaction; shared capability-token helpers.
- `hotel-app-be/src/modules/guest_booking/repository.rs` — anonymous guest, token, and booking lookup SQL.
- `hotel-app-be/src/modules/guest_booking/routes.rs` — public route registration.
- `hotel-app-be/src/core/rate_limiter.rs` — bounded public booking per-IP limiter.
- `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql` and `hotel-app-be/database/postgres/patches/0009_anonymous_booking_payment_tokens.sql` — immutable token storage schema.
- `hotel-web-fe/src/features/publicBooking/` — public API wrapper, types, booking page, and tests.
- `hotel-web-fe/src/features/guestPortal/components/GuestPaymentPanel.tsx` — third payment authorization mode; session and pre-arrival paths remain unchanged.
- `hotel-web-fe/src/routes/book.tsx`, `hotel-web-fe/src/navigation/routeRegistry.tsx`, `hotel-web-fe/src/router/RootLayout.tsx` — public page routing and guest-facing skin.
- `hotel-web-fe/salim-inn/{index.html,account-actions.js}` — landing CTAs point to `/book`.

### Task 1: Add the anonymous payment-capability schema and repository primitives

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Create: `hotel-app-be/database/postgres/patches/0009_anonymous_booking_payment_tokens.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Modify: `hotel-app-be/database/README.md`
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/models.rs`
- Test: `hotel-app-be/tests/guest_booking_anonymous_postgres.rs`

**Interfaces:**
- Produces `AnonymousBookingContact { full_name: String, email: Option<String>, phone: Option<String> }` and `AnonymousPaymentToken { raw: String, expires_at: DateTime<Utc> }`.
- Produces repository methods `insert_anonymous_guest_tx`, `insert_payment_token_tx`, and `find_booking_id_by_payment_token_hash`.

- [ ] **Step 1: Write failing PostgreSQL tests for storage scope**

```rust
#[tokio::test]
async fn anonymous_payment_token_resolves_only_its_booking() {
    let (pool, booking_a, booking_b) = seeded_booking_pair().await;
    let raw = "a".repeat(64);
    GuestBookingRepository::insert_payment_token_tx(&mut pool.begin().await.unwrap(), booking_a, &sha256(&raw), expires_after_one_hour()).await.unwrap();

    assert_eq!(GuestBookingRepository::find_booking_id_by_payment_token_hash(&pool, &sha256(&raw)).await.unwrap(), Some(booking_a));
    assert_ne!(GuestBookingRepository::find_booking_id_by_payment_token_hash(&pool, &sha256(&raw)).await.unwrap(), Some(booking_b));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd hotel-app-be && cargo test --test guest_booking_anonymous_postgres anonymous_payment_token_resolves_only_its_booking -- --exact`

Expected: FAIL because the test module/table/repository methods do not exist.

- [ ] **Step 3: Add baseline and live-schema patch**

Add this table to the V1 baseline and use the same SQL in `0009_anonymous_booking_payment_tokens.sql` guarded by `IF NOT EXISTS`:

```sql
CREATE TABLE IF NOT EXISTS anonymous_booking_payment_tokens (
  booking_id BIGINT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_anonymous_booking_payment_tokens_expiry
  ON anonymous_booking_payment_tokens (expires_at);
```

Compute the patch checksum with `shasum -a 256 hotel-app-be/database/postgres/patches/0009_anonymous_booking_payment_tokens.sql`, add its exact `sha256:` value as generation `1`, version `9` in `manifest.tsv`, and document the patch in `database/README.md`.

- [ ] **Step 4: Add minimal repository methods and DTOs**

Use parameterized SQL and the existing transaction type:

```rust
pub async fn find_booking_id_by_payment_token_hash(
    pool: &DbPool, token_hash: &str,
) -> Result<Option<i64>, ApiError> {
    sqlx::query_scalar(
        "SELECT booking_id FROM anonymous_booking_payment_tokens \
         WHERE token_hash = $1 AND expires_at >= CURRENT_TIMESTAMP",
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)
}
```

`insert_anonymous_guest_tx` inserts only `full_name`, nullable `email`, nullable `phone`, `guest_type = 'non_member'`, and `created_by = NULL`; it never queries existing guests. `insert_payment_token_tx` inserts the hash and expiry in the same booking transaction.

- [ ] **Step 5: Run the targeted test to verify it passes**

Run: `cd hotel-app-be && cargo test --test guest_booking_anonymous_postgres anonymous_payment_token_resolves_only_its_booking -- --exact`

Expected: PASS against a configured `DATABASE_URL`; otherwise report the integration suite was skipped rather than treating exit code as proof.

- [ ] **Step 6: Commit**

```bash
git add hotel-app-be/database/postgres hotel-app-be/src/modules/guest_booking/{models.rs,repository.rs} hotel-app-be/tests/guest_booking_anonymous_postgres.rs
git commit -m "feat: add anonymous booking payment tokens"
```

### Task 2: Expose public standard-rate search and quote APIs

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/models.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/service.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/anonymous.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/routes.rs`
- Modify: `hotel-app-be/src/core/rate_limiter.rs`
- Test: `hotel-app-be/src/modules/guest_booking/service.rs`
- Test: `hotel-app-be/tests/guest_booking_anonymous_postgres.rs`

**Interfaces:**
- Consumes `BookingSearchQuery` and `PublicBookingQuoteRequest`.
- Produces `GET /public/bookings/options` and `POST /public/bookings/quote`, both returning existing `GuestBookingOffer`/`GuestBookingQuote` shapes with zero discount and no voucher data.

- [ ] **Step 1: Write failing unit tests for public quote rules**

```rust
#[test]
fn public_quote_request_has_no_voucher_or_credit_fields() {
    let parsed: PublicBookingQuoteRequest = serde_json::from_value(serde_json::json!({
        "room_type_id": 7,
        "check_in_date": "2026-10-01",
        "check_out_date": "2026-10-02",
        "adults": 1,
        "children": 0
    })).unwrap();
    assert_eq!(parsed.room_type_id, 7);
}
```

Also add an integration test that public search uses the existing online-allocation rules and returns no room type with zero `available_rooms`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd hotel-app-be && cargo test --lib public_quote_request_has_no_voucher_or_credit_fields`

Expected: FAIL because `PublicBookingQuoteRequest` and public search/quote functions do not exist.

- [ ] **Step 3: Implement public search and quote without account inputs**

Add `PublicBookingQuoteRequest` with exactly `room_type_id`, dates, adults, and children. Change the private pricing helper to accept `guest_id: Option<i64>` and only resolve vouchers when both `guest_id` and `voucher_id` are present. Add:

```rust
pub async fn search_public(pool: &DbPool, query: BookingSearchQuery)
    -> Result<Vec<GuestBookingOffer>, ApiError>;
pub async fn quote_public(pool: &DbPool, request: PublicBookingQuoteRequest)
    -> Result<GuestBookingQuote, ApiError>;
```

Both call the same stay validation, inventory, online-allocation, nightly-rate, and price computation as authenticated booking. They pass `None` for guest-specific pricing and `ComplimentaryContext::default()`.

Add `public_booking_read: RateLimiter::new(RateLimitConfig::new(60, 900))`. Public handlers accept `ConnectInfo<SocketAddr>`, use `extract_client_ip`, call `check_with_retry`, and return `ApiError::TooManyRequestsRetryAfter` with the computed retry delay.

- [ ] **Step 4: Register routes and preserve protected routes**

```rust
.route("/public/bookings/options", get(anonymous::search_handler))
.route("/public/bookings/quote", post(anonymous::quote_handler))
```

Do not alter `/guest-portal/me/booking-options`, `/guest-portal/me/booking-quote`, or their guest-session rate limits.

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `cd hotel-app-be && cargo test --lib public_quote_request_has_no_voucher_or_credit_fields && cargo test --test guest_booking_anonymous_postgres public_search_respects_online_allocation -- --exact`

Expected: PASS, with the integration-count caveat when `DATABASE_URL` is absent.

- [ ] **Step 6: Commit**

```bash
git add hotel-app-be/src/{core/rate_limiter.rs,modules/guest_booking/{anonymous.rs,models.rs,routes.rs,service.rs}} hotel-app-be/tests/guest_booking_anonymous_postgres.rs
git commit -m "feat: add public booking availability"
```

### Task 3: Create anonymous bookings and authorize only their payments

**Files:**
- Modify: `hotel-app-be/src/modules/guest_booking/models.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/anonymous.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/service.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/repository.rs`
- Modify: `hotel-app-be/src/modules/guest_booking/routes.rs`
- Modify: `hotel-app-be/src/core/rate_limiter.rs`
- Test: `hotel-app-be/tests/guest_booking_anonymous_postgres.rs`

**Interfaces:**
- Produces `POST /public/bookings` with `CreateAnonymousBookingRequest` and `AnonymousBookingConfirmation`.
- Produces `POST /public/bookings/{token}/payments/{bank-transfer|paypal/create-order|paypal/capture}`.
- `AnonymousBookingConfirmation` contains the normal confirmation fields plus `payment_token` and `payment_token_expires_at`.

- [ ] **Step 1: Write failing integration tests for anonymous creation**

```rust
#[tokio::test]
async fn anonymous_booking_requires_name_but_not_email_or_phone() {
    let response = post_public_booking(json!({
        "client_request_id": uuid(), "guest_name": "", "room_type_id": 7,
        "check_in_date": tomorrow(), "check_out_date": day_after_tomorrow(),
        "adults": 1, "children": 0, "expected_total": "250.00"
    })).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let created = post_public_booking(valid_anonymous_request("Aisha Rahman", None, None)).await;
    assert_eq!(created.status(), StatusCode::OK);
    assert!(created.json::<AnonymousBookingConfirmation>().payment_token.len() == 64);
}
```

Add tests proving a retry with the same request id returns the original booking/token response; altered price returns conflict; an expired or unrelated token cannot create a payment; and the guest has no row in `users`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd hotel-app-be && cargo test --test guest_booking_anonymous_postgres anonymous_booking_requires_name_but_not_email_or_phone -- --exact`

Expected: FAIL because public creation and anonymous DTOs do not exist.

- [ ] **Step 3: Implement the one transaction**

Add `CreateAnonymousBookingRequest` with `guest_name`, optional `email`/`phone`, room/stay fields, optional special requests, cleaning preference, expected total, and `client_request_id`. Validate trimmed name is non-empty and at most the existing guest-name field length; reject malformed supplied email; sanitize special requests.

Implement `service::create_anonymous`: validate request id, quote with `quote_public`, compare rounded expected total, begin a transaction, insert one anonymous guest, lock availability, allocate a room, insert a `pending_payment` booking, insert the token hash with a 24-hour expiry, mark the room reserved, write audit/history with action `public_booking.created`, and commit. Generate the 32-byte random token before the transaction, hash it with SHA-256, and return raw token only in `AnonymousBookingConfirmation`. Do not call profile completion, voucher, credit, or account-session code.

- [ ] **Step 4: Implement narrowly scoped payment handlers**

Add a private resolver that hashes the path token, finds a non-expired token, and loads its single booking. The three handlers call only the existing `payments::create_bank_transfer_claim`, `payments::create_paypal_order`, and `payments::capture_paypal_payment` with that resolved booking. Add `public_booking_payment: RateLimiter::new(RateLimitConfig::new(30, 900))` and enforce it by IP before resolving the token. Do not route anonymous tokens through pre-check-in handlers or the guest portal.

- [ ] **Step 5: Send optional confirmation email without token leakage in logs**

Within the creation transaction, queue the existing `booking_confirmation` delivery only when email is present. The email body contains the booking number and a link to `/book/payment/<raw token>`; audit details record only booking id/number and never the raw token, email, or phone.

- [ ] **Step 6: Run focused tests to verify they pass**

Run: `cd hotel-app-be && cargo test --test guest_booking_anonymous_postgres -- --nocapture`

Expected: all anonymous-booking tests PASS on a real PostgreSQL run; record the run count.

- [ ] **Step 7: Commit**

```bash
git add hotel-app-be/src/{core/rate_limiter.rs,modules/guest_booking/{anonymous.rs,models.rs,repository.rs,routes.rs,service.rs}} hotel-app-be/tests/guest_booking_anonymous_postgres.rs
git commit -m "feat: create anonymous online bookings"
```

### Task 4: Add the public booking client and immediate-payment page

**Files:**
- Create: `hotel-web-fe/src/features/publicBooking/api.ts`
- Create: `hotel-web-fe/src/features/publicBooking/types.ts`
- Create: `hotel-web-fe/src/features/publicBooking/PublicBookingPage.tsx`
- Create: `hotel-web-fe/src/features/publicBooking/PublicBookingPage.test.tsx`
- Modify: `hotel-web-fe/src/features/guestPortal/components/GuestPaymentPanel.tsx`
- Modify: `hotel-web-fe/src/api/guestPortal.service.ts`
- Test: `hotel-web-fe/src/features/guestPortal/components/GuestPaymentPanel.test.tsx`

**Interfaces:**
- `PublicBookingApi.search`, `quote`, `create`, `submitBankTransfer`, `createPaypalOrder`, and `capturePaypalOrder` call only `/public/bookings/*`.
- `GuestPaymentPanelProps.mode` becomes `'session' | 'token' | 'anonymous'`; anonymous mode requires only `token`.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('allows a visitor to search without being redirected to login', async () => {
  render(<PublicBookingPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(PublicBookingApi.search).toHaveBeenCalled());
  expect(screen.queryByText(/sign in|register/i)).toBeNull();
});

it('blocks anonymous checkout until guest name is supplied', async () => {
  render(<PublicBookingPage />);
  await selectFirstOffer();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
  expect(screen.getByText('Guest name is required.')).toBeTruthy();
});
```

Add a payment-panel test proving anonymous mode calls the public token route rather than a session or `/guest-portal/booking` route.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hotel-web-fe && bun run test src/features/publicBooking/PublicBookingPage.test.tsx src/features/guestPortal/components/GuestPaymentPanel.test.tsx`

Expected: FAIL because the public page/API and anonymous payment mode do not exist.

- [ ] **Step 3: Implement the narrow public API and payment mode**

`PublicBookingApi` uses the shared `api` client and sends no Authorization header. Its request types omit vouchers and complimentary dates. Extend `GuestPaymentPanel` with `mode: 'anonymous'` and route only that mode's bank-transfer, receipt, PayPal-order, and capture calls through `PublicBookingApi`; preserve exact behavior for the existing `session` and `token` branches.

- [ ] **Step 4: Implement the four-stage public page**

Build `PublicBookingPage` with Search, Choose, Guest details/review, and Payment stages. Use the existing `calendarDateInput`, `validateGuestBookingSearch`, money formatting, offer cards, and MUI controls where they are exported; do not load vouchers, profile data, portal sessions, or availability WebSockets. Require a trimmed guest name, keep email/phone optional, and submit the backend-quoted `expected_total` with a generated client request id. On success, render `GuestPaymentPanel mode="anonymous"` with the returned payment token, amount, and currency. If the price or availability changes, display the server error and return to refreshed search/review rather than creating a booking.

- [ ] **Step 5: Run focused frontend tests to verify they pass**

Run: `cd hotel-web-fe && bun run test src/features/publicBooking/PublicBookingPage.test.tsx src/features/guestPortal/components/GuestPaymentPanel.test.tsx`

Expected: PASS, including public API route assertions and the mandatory-name case.

- [ ] **Step 6: Commit**

```bash
git add hotel-web-fe/src/features/publicBooking hotel-web-fe/src/features/guestPortal/components/GuestPaymentPanel.tsx hotel-web-fe/src/api/guestPortal.service.ts
git commit -m "feat: add anonymous booking checkout"
```

### Task 5: Route public visitors to anonymous booking and verify all gates

**Files:**
- Create: `hotel-web-fe/src/routes/book.tsx`
- Modify: `hotel-web-fe/src/navigation/routeRegistry.tsx`
- Modify: `hotel-web-fe/src/router/RootLayout.tsx`
- Modify: `hotel-web-fe/salim-inn/index.html`
- Modify: `hotel-web-fe/salim-inn/account-actions.js`
- Test: `hotel-web-fe/src/features/publicBooking/PublicBookingPage.test.tsx`

**Interfaces:**
- Produces public route `/book` rendering `PublicBookingPage`.
- Landing-page account states all use `/book` for booking; only the account button continues to use the login/portal routes.

- [ ] **Step 1: Write failing routing assertions**

```tsx
it('registers /book as a public route', () => {
  expect(routeRegistry.find((route) => route.path === '/book')?.visibility).toBe('public');
});

it('landing booking links target the anonymous booking page', () => {
  expect(readFileSync('salim-inn/index.html', 'utf8')).toContain('href="/book"');
  expect(readFileSync('salim-inn/account-actions.js', 'utf8')).toContain("bookingAction.href = '/book'");
});
```

- [ ] **Step 2: Run the routing test to verify it fails**

Run: `cd hotel-web-fe && bun run test src/features/publicBooking/PublicBookingPage.test.tsx`

Expected: FAIL because `/book` and the changed landing targets do not exist.

- [ ] **Step 3: Add the public route and landing targets**

Create `routes/book.tsx` using `createFileRoute('/book')` and `RouteById id="public-book"`. Register `{ id: 'public-book', path: '/book', component: PublicBookingPage, animationType: 'fade', visibility: 'public' }`. Treat `/book` as a guest experience in `RootLayout` for title/favicon but never add an authentication redirect. Change both static `/register` booking links and every `bookingAction.href` branch to `/book`; keep “My account” and “Sign in” behavior unchanged. Let the router plugin regenerate `routeTree.gen.ts`; do not hand-edit generated code.

- [ ] **Step 4: Run focused UI tests to verify they pass**

Run: `cd hotel-web-fe && bun run test src/features/publicBooking/PublicBookingPage.test.tsx`

Expected: PASS, including the no-login redirect and landing-link assertions.

- [ ] **Step 5: Run complete verification gates**

Run:

```bash
cd hotel-app-be && cargo check --all-features && cargo test --test guest_booking_anonymous_postgres
cd ../hotel-web-fe && bun run typecheck && bun run lint && bun run test && bun run build
```

Expected: all commands succeed. For the backend integration command, report the actual executed test count and whether `DATABASE_URL` enabled the real PostgreSQL tests.

- [ ] **Step 6: Commit**

```bash
git add hotel-web-fe/src/{routes/book.tsx,navigation/routeRegistry.tsx,router/RootLayout.tsx,features/publicBooking} hotel-web-fe/salim-inn/{index.html,account-actions.js} hotel-web-fe/src/routeTree.gen.ts
git commit -m "feat: route visitors to anonymous booking"
```
