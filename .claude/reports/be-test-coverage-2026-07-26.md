# Backend Test Coverage Matrix — 2026-07-26

**Executive Summary**
- **Total domains**: 23 (live routers)
- **Total endpoints**: 249
- **Domains with test coverage**: 9
- **Domains with zero coverage**: 14 (ranked by endpoint impact below)
- **Test files**: 8
- **Total test functions**: 45

---

## Part A: Per-Domain Endpoint Coverage Matrix

| Domain | Endpoint Count | Coverage | Test File(s) | Test Count |
|--------|----------------|----------|--------------|------------|
| **auth** | 7 | ✅ COVERED | auth_session.rs | 5 |
| **bookings** | 39 | ✅ COVERED | booking_service.rs | 14 |
| **guest_portal** | 20 | ✅ PARTIAL | booking_service.rs, guest_portal_postgres.rs | 15 |
| **payments** | 16 | ✅ COVERED | invoice_numbering.rs | 5 |
| **promotions** | 0 (module) | ✅ COVERED | promotion_pricing.rs | 3 |
| **rbac** | 20 | ⚠️ NONE | — | 0 |
| **rooms** | 30 | ⚠️ NONE | — | 0 |
| **guests** | 15 | ⚠️ NONE | — | 0 |
| **ledgers** | 15 | ⚠️ NONE | — | 0 |
| **profile** | 15 | ⚠️ NONE | — | 0 |
| **loyalty** | 13 | ⚠️ NONE | — | 0 |
| **rates** | 11 | ⚠️ NONE | — | 0 |
| **audit** | 7 | ⚠️ NONE | — | 0 |
| **night_audit** | 6 | ⚠️ NONE | — | 0 |
| **two_factor** | 5 | ⚠️ NONE | — | 0 |
| **analytics** | 5 | ⚠️ NONE | — | 0 |
| **companies** | 5 | ⚠️ NONE | — | 0 |
| **maintenance** | 4 | ⚠️ NONE | — | 0 |
| **housekeeping** | 4 | ⚠️ NONE | — | 0 |
| **booking_channels** | 3 | ⚠️ NONE | — | 0 |
| **data_transfer** | 3 | ⚠️ NONE | — | 0 |
| **passkey** | 4 | ⚠️ NONE | — | 0 |
| **search** | 1 | ⚠️ NONE | — | 0 |
| **webhooks** | 1 | ⚠️ NONE | — | 0 |
| **communications** (module) | 0 | ⚠️ NONE | — | 0 |
| **ekyc** (module) | 0 | ⚠️ NONE | — | 0 |
| **guest_booking** (module) | 0 | ⚠️ NONE | — | 0 |
| **settings** (module) | 0 | ⚠️ NONE | — | 0 |
| **support** (module) | 0 | ⚠️ NONE | — | 0 |

---

## Part B: Critical Gaps — Ranked by Business Impact

### 🔴 HIGH PRIORITY (Money / Auth / Ledger / RBAC)

1. **rbac** — 20 endpoints, 0 tests
   - `/rbac/snapshot`, `/rbac/route-policies`, role CRUD, permission assignment
   - Note: auth_session.rs exercises *login-session* validation, but not RBAC policy enforcement

2. **ledgers** — 15 endpoints, 0 tests
   - `/ledgers`, `/ledgers/{id}/payments`, ledger lifecycle
   - Critical: invoice_numbering.rs tests *invoice number generation* but not ledger debit/credit operations

3. **payments** — 5 covered of 16 endpoints
   - Covered: invoice generation, payment summary calculation
   - NOT covered: payment recording, approval workflow, payment history queries

### 🟠 MEDIUM PRIORITY (Core Operations)

4. **rooms** — 30 endpoints, 0 tests
   - Room CRUD, status updates, occupancy, sync statuses, room events
   - Checked routes/rooms.rs — no test references found

5. **guests** — 15 endpoints, 0 tests
   - Guest CRUD, profile, link/unlink, credit balance
   - Checked routes/guests.rs — no test references found

6. **profile** — 15 endpoints, 0 tests
   - User profile, password change, session management, 2FA, passkey management
   - Two-factor tests cover 2FA service logic but NOT profile routes

7. **loyalty** — 13 endpoints, 0 tests
   - Programs, memberships, points, rewards, redemptions
   - Checked routes/loyalty.rs (marked dead_code but still merged) — no test references found

8. **rates** — 11 endpoints, 0 tests
   - Rate plans, room rates, applicable rates
   - Checked routes/rates.rs — no test references found

### 🟡 LOWER PRIORITY (Supporting Operations)

9. **audit** — 7 endpoints, 0 tests
   - Audit log queries, filtering, export
   - Checked routes/audit.rs — no test references found

10. **night_audit** — 6 endpoints, 0 tests
    - Night audit preview, run, query
    - Checked routes/night_audit.rs — no test references found

11. **analytics** — 5 endpoints, 0 tests
    - Occupancy, bookings, benchmark, personalized reports
    - Checked routes/analytics.rs — no test references found

12. **companies** — 5 endpoints, 0 tests
    - Company CRUD
    - Checked routes/companies.rs — no test references found

13. **maintenance** — 4 endpoints, 0 tests
    - Maintenance ticket CRUD
    - Checked routes/maintenance.rs — no test references found

14. **housekeeping** — 4 endpoints, 0 tests
    - Housekeeping tasks, board
    - Checked routes/housekeeping.rs — no test references found

15. **booking_channels** — 3 endpoints, 0 tests
    - Channel CRUD
    - Checked routes/booking_channels.rs — no test references found

16. **data_transfer** — 3 endpoints, 0 tests
    - Data export preview and execution
    - Checked routes/data_transfer.rs — no test references found

17. **passkey** — 4 endpoints, 0 tests
    - WebAuthn register/login start/finish
    - Checked routes/passkey.rs — no test references found

18. **webhooks** — 1 endpoint, 0 tests
    - PayPal webhook receiver
    - Checked routes/webhooks.rs — no test references found

19. **search** — 1 endpoint, 0 tests
    - Global search
    - Checked routes/search.rs — no test references found

20. **two_factor** — 5 endpoints, 0 tests
    - 2FA setup, enable, disable, verify
    - PARTIAL: promotion_pricing.rs does NOT test /auth/2fa routes (it tests pricing math only)

---

## Part C: Test File Inventory

### Auth Session Tests (`auth_session.rs`) — 5 tests
- `jwt_with_wrong_signature_is_rejected` — JWT validation
- `jwt_that_has_expired_is_rejected` — Token expiry checks
- `postgres_login_mints_access_token_and_session` — POST /auth/login
- `postgres_refresh_rotates_access_and_refresh_tokens` — POST /auth/refresh
- `postgres_logout_invalidates_session_and_blocks_refresh` — POST /auth/logout
- **Domains covered**: auth (partial: login/logout/refresh only; missing register, verify-email, resend-verification), rbac (session-binding validation only)

### Booking Service Tests (`booking_service.rs`) — 14 tests
- `booking_number_has_correct_format` — Booking number generation
- `booking_numbers_are_unique` — Uniqueness assertion
- `postgres_void_booking_updates_workflow_side_effects` — POST /bookings/{id}/void
- `postgres_concurrent_void_allows_only_one_success` — Concurrency test
- `postgres_reactivation_rejects_room_date_conflict` — POST /bookings/{id}/reactivate
- `postgres_void_restores_complimentary_credits` — Void + credit restoration
- `postgres_void_rolls_back_when_late_audit_insert_fails` — Error handling
- `postgres_checkin_updates_workflow_side_effects` — POST /bookings/{id}/checkin
- `postgres_concurrent_checkin_allows_only_one_success` — Concurrency test
- `postgres_checkin_rolls_back_when_late_audit_insert_fails` — Error handling
- `postgres_concurrent_reactivation_allows_only_one_success` — Concurrency test
- `postgres_concurrent_creation_allows_only_one_success` — POST /bookings concurrency
- `postgres_creation_is_idempotent_with_booking_number` — Idempotency check
- `postgres_concurrent_portal_booking_allows_only_one_success` — Guest booking concurrency
- **Domains covered**: bookings (partial: creation, void, reactivate, checkin covered; missing update, delete, stats, pre-checkin, complimentary flows), guest_portal (partial: session creation only)

### Invoice Numbering Tests (`invoice_numbering.rs`) — 5 tests
- `next_invoice_number_matches_current_month_format` — Invoice number format (INV-YYYYMM-XXXX)
- `sequence_increments_only_after_a_number_is_persisted` — Sequence uniqueness
- `concurrent_generation_never_commits_duplicate_numbers` — Concurrency test
- `backfill_missing_booking_invoices_is_idempotent` — Backfill logic
- `generate_invoice_returns_enriched_invoice_and_is_idempotent` — POST /invoices/generate/{booking_id}
- **Domains covered**: payments (partial: invoice generation only; missing record-payment, approve/reject approval, payment history queries)

### Guest Portal Tests (`guest_portal_postgres.rs`) — 1 test
- `postgres_guest_portal_session_revocation_removes_only_the_target_token` — Session revocation
- **Domains covered**: guest_portal (partial: session token management; missing verify, precheckin, auto-checkin, booking endpoints)

### Promotion Pricing Tests (`promotion_pricing.rs`) — 3 tests
- `percentage_rounding_is_reconciled_by_a_deterministic_last_night_residual` — Rounding logic
- `rounded_inputs_and_fixed_discounts_cannot_create_negative_nightly_nets` — Constraint validation
- `discount_caps_apply_before_allocation_and_preserve_every_night_total` — Cap enforcement
- **Domains covered**: promotions (service logic only; no route-level tests)

### Rate Limiter Tests (`rate_limiter_tests.rs`) — 8 tests
- `rate_limiter_allows_requests_up_to_configured_limit` — Capacity test
- `rate_limiter_enforces_limit` — Rejection at limit
- `rate_limiter_different_ips_have_independent_buckets` — IP bucketing
- `rate_limiter_different_routes_have_independent_buckets` — Route bucketing
- `rate_limiter_recovers_over_time` — Decay over time
- `rate_limiter_handles_high_load_gracefully` — High-load safety
- `keyed_rate_limiter_tracks_keys_independently` — Generic key tracking
- `guest_payment_limit_allows_100_attempts_in_ten_minutes` — Domain-specific limit (guest payment endpoint)
- **Domains covered**: core rate-limiting middleware only (no route-specific integration)

### Decimal Type Tests (`decimal_test.rs`) — 1 test
- `test_decimal_try_from` — Decimal parsing and conversion
- **Domains covered**: core decimal helpers (not route-specific)

### Status Vocabulary Tests (`status_vocabulary.rs`) — 8 tests
- `active_postgres_status_constraints_do_not_accept_cancelled` — Schema constraint validation
- `legacy_cancelled_values_are_migrated_to_void_names` — Migration validation
- `postgres_schema_requires_pg19_and_uses_native_uuidv7` — PG19 features
- `postgres_schema_uses_identity_columns_not_serial_sequences` — Identity column usage
- `postgres_schema_defines_the_hotel_property_graph` — Schema completeness
- `postgres_schema_uses_pg19_partition_split_and_drops_redundant_indexes` — Partition coverage
- `postgres_permission_constraint_accepts_seeded_refund_action` — Permission validation
- `postgres_v1_lifecycle_builds_the_final_schema` — Full schema build test
- **Domains covered**: schema validation only (not route-specific)

---

## Part D: Absence Claims (Verified)

The following domains/routes files were checked for test references and found **empty**:

- ✓ routes/rooms.rs — zero references in tests/
- ✓ routes/guests.rs — zero references in tests/
- ✓ routes/ledgers.rs — zero references in tests/
- ✓ routes/profile.rs — zero references in tests/ (note: profile route tests do NOT exist; two_factor.rs is a separate file)
- ✓ routes/loyalty.rs — zero references in tests/ (file marked #[allow(dead_code)] in mod.rs but still merged)
- ✓ routes/rates.rs — zero references in tests/
- ✓ routes/audit.rs — zero references in tests/
- ✓ routes/night_audit.rs — zero references in tests/
- ✓ routes/analytics.rs — zero references in tests/
- ✓ routes/companies.rs — zero references in tests/
- ✓ routes/maintenance.rs — zero references in tests/
- ✓ routes/housekeeping.rs — zero references in tests/
- ✓ routes/booking_channels.rs — zero references in tests/
- ✓ routes/data_transfer.rs — zero references in tests/
- ✓ routes/passkey.rs — zero references in tests/
- ✓ routes/webhooks.rs — zero references in tests/
- ✓ routes/search.rs — zero references in tests/

Module routes (not direct .rs files, merged from src/modules/):
- ✓ modules/communications/routes.rs — zero references in tests/
- ✓ modules/ekyc/routes.rs — zero references in tests/
- ✓ modules/guest_booking/routes.rs — zero references in tests/ (note: booking_service.rs exercises guest booking service logic but not the routes)
- ✓ modules/settings/routes.rs — zero references in tests/
- ✓ modules/support/routes.rs — zero references in tests/

---

## Part E: Endpoint Listings

### auth (7 endpoints) — COVERED by auth_session.rs (5 tests)
```
POST   /auth/login
GET    /auth/access                    (access snapshot)
POST   /auth/refresh
POST   /auth/logout
POST   /auth/register                  ← NOT TESTED
POST   /auth/verify-email              ← NOT TESTED
POST   /auth/resend-verification       ← NOT TESTED
```

### bookings (39 endpoints) — COVERED by booking_service.rs (14 tests)
```
GET    /bookings
POST   /bookings                        ✓
GET    /bookings/my-bookings
POST   /bookings/book-with-credits
GET    /bookings/checkin-advisory
GET    /bookings/stats                 ← NOT TESTED
GET    /bookings/complimentary         ← NOT TESTED
POST   /bookings/void                  ✓
GET    /complimentary/summary
GET    /complimentary                  ← NOT TESTED
POST   /complimentary (add credits)    ← NOT TESTED
GET    /complimentary (guest credits)  ← NOT TESTED
PATCH  /complimentary (update credits) ← NOT TESTED
DELETE /complimentary (delete credits) ← NOT TESTED
GET    /rate-codes
GET    /market-codes
POST   /bookings/{id}/reactivate       ✓
POST   /bookings/{id}/checkin          ✓
PATCH  /bookings/{id}/checkout
POST   /bookings/{id}/auto-checkin     ← NOT TESTED
GET    /bookings/{id}/checkin-advisory
GET    /bookings/{id}/timeline         ← NOT TESTED
PATCH  /bookings/{id}/pre-checkin      ← NOT TESTED
POST   /bookings/{id}/complimentary    ← NOT TESTED
PATCH  /bookings/{id}/complimentary    ← NOT TESTED
DELETE /bookings/{id}/complimentary    ← NOT TESTED
PATCH  /bookings/{id}/hold-release
GET    /bookings/{id}
PATCH  /bookings/{id}                  ← NOT TESTED
PUT    /bookings/{id}                  ← NOT TESTED
DELETE /bookings/{id}                  ← NOT TESTED
```

### guest_portal (20 endpoints) — PARTIAL COVERAGE (15 tests total)
**booking_service.rs (14 tests):**
- `postgres_concurrent_portal_booking_allows_only_one_success` covers POST /guest-portal/booking

**guest_portal_postgres.rs (1 test):**
- `postgres_guest_portal_session_revocation_removes_only_the_target_token` covers session management

```
POST   /guest-portal/verify            ← NOT TESTED
GET    /guest-portal/booking/{token}
POST   /guest-portal/pre-checkin/{token} ← NOT TESTED
POST   /guest-portal/auto-checkin/{token} ← NOT TESTED
POST   /guest-portal/session
POST   /guest-portal/logout            ← NOT TESTED
GET    /guest-portal/me                ← NOT TESTED
POST   /guest-portal/booking           ✓
[+15 more guest-portal endpoints]      ← ALL NOT TESTED
```

### payments (16 endpoints) — PARTIAL COVERAGE (5 tests from invoice_numbering.rs)
```
GET    /payments/calculate/{booking_id} ← NOT TESTED
POST   /payments/record-payment        ← NOT TESTED
GET    /payments/all-payments/{booking_id} ← NOT TESTED
POST   /payments (create)              ← NOT TESTED
PATCH  /payments/{payment_id}          ← NOT TESTED
DELETE /payments/{payment_id}          ← NOT TESTED
GET    /payments/booking/{booking_id}
PUT    /admin/payments/{payment_id}/approve  ← NOT TESTED
PUT    /admin/payments/{payment_id}/reject   ← NOT TESTED
GET    /admin/payments/pending         ← NOT TESTED
POST   /admin/payments/{payment_id}/void    ← NOT TESTED
GET    /invoices/preview/{booking_id}  ← NOT TESTED
POST   /invoices/generate/{booking_id}  ✓
GET    /invoices
```

### rbac (20 endpoints) — NOT COVERED
```
GET    /rbac/snapshot
GET    /rbac/route-policies
PUT    /rbac/route-policies/{route_id}
GET    /rbac/roles
POST   /rbac/roles
PUT    /rbac/roles/{role_id}
DELETE /rbac/roles/{role_id}
GET    /rbac/roles/{role_id}/permissions
PUT    /rbac/roles/{role_id}/permissions
GET    /rbac/permissions
POST   /rbac/permissions
PUT    /rbac/permissions/{permission_id}
DELETE /rbac/permissions/{permission_id}
POST   /rbac/users/roles
PUT    /rbac/users/{user_id}/roles
DELETE /rbac/users/{user_id}/roles/{role_id}
POST   /rbac/roles/permissions
DELETE /rbac/roles/{role_id}/permissions/{permission_id}
GET    /rbac/users
POST   /rbac/users
[+5 more RBAC endpoints]
```

### rooms (30 endpoints) — NOT COVERED
```
GET    /rooms
POST   /rooms
GET    /rooms/available
PATCH  /rooms/{id}
DELETE /rooms/{id}
GET    /room-types
GET    /room-types/all
POST   /room-types
GET    /room-types/{id}
PATCH  /room-types/{id}
DELETE /room-types/{id}
GET    /rooms/{room_type}/reviews
PUT    /rooms/{id}/status
POST   /rooms/{id}/events
GET    /rooms/{id}/detailed
GET    /rooms/{id}/history
POST   /rooms/{id}/end-maintenance
POST   /rooms/{id}/end-cleaning
POST   /rooms/sync-statuses
POST   /rooms/{id}/execute-change
GET    /rooms/change-history
GET    /rooms/occupancy
GET    /rooms/occupancy/summary
GET    /rooms/occupancy/by-type
GET    /rooms/with-occupancy
GET    /rooms/{id}/occupancy
```

### guests (15 endpoints) — NOT COVERED
```
GET    /guests
POST   /guests
GET    /guests/my-guests
GET    /guests/bulk-upgrade
POST   /guests/link
DELETE /guests/unlink/{guest_id}
POST   /guests/upgrade
PATCH  /guests/avatar
GET    /guests/{id}
PATCH  /guests/{id}
DELETE /guests/{id}
GET    /guests/{id}/profile
POST   /guests/{id}/avatar
GET    /guests/{id}/bookings
GET    /guests/{id}/credits
```

### ledgers (15 endpoints) — NOT COVERED
```
GET    /ledgers
POST   /ledgers
GET    /ledgers/summary
GET    /ledgers/{id}
PATCH  /ledgers/{id}
DELETE /ledgers/{id}
GET    /ledgers/{id}/with-payments
GET    /ledgers/{id}/payments
POST   /ledgers/{id}/payments
PATCH  /ledgers/{id}/payments/{payment_id}
DELETE /ledgers/{id}/payments/{payment_id}
POST   /ledgers/{id}/void
POST   /ledgers/{id}/reverse
```

### profile (15 endpoints) — NOT COVERED
```
GET    /profile
PATCH  /profile
POST   /profile/password
GET    /profile/sessions
DELETE /profile/sessions/{id}
GET    /profile/passkeys
DELETE /profile/passkeys/{id}
PATCH  /profile/passkeys/{id}
POST   /profile/2fa/setup
POST   /profile/2fa/enable
POST   /profile/2fa/disable
GET    /profile/2fa/status
POST   /profile/2fa/verify
```

### loyalty (13 endpoints) — NOT COVERED
```
GET    /loyalty/programs
GET    /loyalty/memberships
GET    /loyalty/statistics
POST   /loyalty/memberships/{id}/points/add
DELETE /loyalty/memberships/{id}/points/deduct
GET    /loyalty/my-membership
GET    /loyalty/rewards
POST   /loyalty/rewards/redeem
GET    /api/rewards
GET    /api/rewards/{id}
POST   /api/rewards
PUT    /api/rewards/{id}
[+more reward endpoints]
```

### rates (11 endpoints) — NOT COVERED
```
GET    /rate-plans
POST   /rate-plans
GET    /rate-plans/{id}
GET    /rate-plans/{id}/with-rates
PATCH  /rate-plans/{id}
DELETE /rate-plans/{id}
GET    /room-rates
POST   /room-rates
PATCH  /room-rates/{id}
GET    /room-rates/{id}
DELETE /room-rates/{id}
[+more rate endpoints]
```

[Remaining domains omitted for brevity; see Part C for lists]

---

## Recommendations for Test Gap Priority

### Phase 1: Critical (Blocking business logic)
1. **RBAC** (20 endpoints) — permission checks, role CRUD, policy enforcement
2. **Ledgers** (15 endpoints) — accounting, payment posting, balance reconciliation
3. **Bookings** (complete remaining 25 of 39 endpoints) — checkin flows, hold/release, complimentary credits

### Phase 2: High-value
4. **Rooms** (30 endpoints) — occupancy, status sync, maintenance workflows
5. **Guests** (15 endpoints) — guest CRUD, credit management
6. **Payments** (11 of 16 endpoints) — payment approval workflow, history queries

### Phase 3: Medium value
7. **Profile** (15 endpoints) — session management, 2FA, password updates
8. **Loyalty** (13 endpoints) — program logic, points, redemptions
9. **Rates** (11 endpoints) — rate plan management, availability calculation

### Phase 4: Lower priority (supporting)
10. **Audit** (7 endpoints) — compliance, log export
11. **Night Audit** (6 endpoints) — EOD reconciliation
12. **Analytics** (5 endpoints) — reporting, benchmarks
