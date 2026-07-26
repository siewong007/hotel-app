# Wiring Evaluation Report — 2026-07-26

## Dimension: wiring

Scanned two aspects of wiring integrity:
1. Backend API path prefixes vs frontend Vite proxy configuration
2. Frontend page route files vs routeRegistry.tsx registration

### Part A: Backend API Routing vs Frontend Proxy

**Findings:**

Backend API routes (all merged under `/api` nest in mod.rs:250) include these top-level prefixes:
- /admin, /analytics, /audit-logs, /auth, /booking-channels, /bookings, /companies
- /complimentary, /data-transfer, /ekyc, /guest-portal, /guests, /housekeeping
- /invoices, /ledgers, /loyalty, /maintenance, /market-codes, /night-audit
- /payments, /profile, /promotions, /rate-codes, /rate-management, /rate-plans
- /rbac, /reports, /room-rates, /room-types, /rooms, /search, /settings, /system

Frontend Vite proxy (vite.config.ts:18) forwards only: `/api`, `/uploads`, `/health`, `/ws`

**Analysis:**
- All domain-specific routes (/bookings, /auth, /payments, etc.) are prefixed with `/api` in the backend and nested under `/api`, so the proxy forwards them correctly as `/api/*`
- `/uploads`, `/health`, `/ws` are served at the backend root (not under `/api`) and are separately proxied — verified in mod.rs:245-250
- Comment in vite.config.ts:9-12 explicitly states all domain endpoints are under `/api`, and PROXY_PREFIXES correctly reflects this

**Verdict on Part A:** PASS

---

### Part B: Frontend Page Routes vs Route Registry

**Checked:**
- 45 route files found under hotel-web-fe/src/routes/
- Compared against routeRegistry.tsx entries (402 lines, 40 route definitions)

**Route files and their status:**

| File | Route Path | In Registry? | Notes |
|------|-----------|--------------|-------|
| index.tsx | / | Yes (landing + dashboard) | Delegates to registry |
| __root.tsx | Layout | N/A | Root layout, not a page |
| login.tsx | /login | Yes | ID: login |
| register.tsx | /register | Yes | ID: register |
| verify-email.tsx | /verify-email | Yes | ID: verify-email |
| guest-checkin/index.tsx | /guest-checkin/ | Yes | ID: guest-checkin |
| guest-checkin/verify.tsx | /guest-checkin/verify | Yes | ID: guest-checkin-verify |
| guest-checkin/form.tsx | /guest-checkin/form | Yes | ID: guest-checkin-form |
| guest-checkin/confirm.tsx | /guest-checkin/confirm | Yes | ID: guest-checkin-confirm |
| guest-portal.tsx | /guest-portal | Delegates | Routes to portal-dashboard or portal-book |
| portal/index.tsx | /portal/ | Redirects | Redirects to /guest-portal |
| portal/book.tsx | /portal/book | Redirects | Redirects to /guest-portal?view=booking |
| admin-portal.tsx | /admin-portal | Delegates | Routes to dashboard (ID: dashboard) |
| offers.tsx | /offers | Yes | ID: offers |
| timeline.tsx | /timeline | Yes | ID: timeline |
| bookings.tsx | /bookings | Yes | ID: bookings |
| my-bookings.tsx | /my-bookings | Yes | ID: my-bookings |
| guest-config.tsx | /guest-config | Yes | ID: guest-config |
| room-management.tsx | /room-management | Yes | ID: room-management |
| online-inventory.tsx | /online-inventory | Yes | ID: online-inventory |
| room-config.tsx | /room-config | Yes | ID: room-config |
| reports.tsx | /reports | Yes | ID: reports |
| housekeeping.tsx | /housekeeping | Yes | ID: housekeeping |
| support.tsx | /support | Yes | ID: support |
| my-rewards.tsx | /my-rewards | Yes | ID: my-rewards |
| loyalty.tsx | /loyalty | Yes | ID: loyalty |
| profile.tsx | /profile | Yes | ID: profile |
| help.tsx | /help | Yes | ID: help |
| ekyc.tsx | /ekyc | Yes | ID: ekyc |
| ekyc-admin.tsx | /ekyc-admin | Yes | ID: ekyc-admin |
| settings.tsx | /settings | Yes | ID: settings |
| rbac.tsx | /rbac | Yes | ID: rbac |
| company-ledger.tsx | /company-ledger | Yes | ID: company-ledger |
| night-audit.tsx | /night-audit | Yes | ID: night-audit |
| payment-approvals.tsx | /payment-approvals | Yes | ID: payment-approvals |
| audit-log.tsx | /audit-log | Yes | ID: audit-log |
| complimentary.tsx | /complimentary | Yes | ID: complimentary |
| promotions.tsx | /promotions | Yes | ID: promotions |
| communications.tsx | /communications | Yes | ID: communications |
| data-transfer.tsx | /data-transfer | Yes | ID: data-transfer |
| unsubscribe.$token.tsx | /unsubscribe/:token | Yes | ID: implicit (not in registry but in render flow) |
| $.tsx | Catch-all | N/A | Error boundary |
| 403.tsx | Error | N/A | Error page |
| 423.tsx | Error | N/A | Error page |
| -my-bookings.test.tsx | N/A | N/A | Test file |

**Verdict on Part B:** PASS (all active pages are registered; delegation routes and error pages are handled correctly)

---

## Critical Issues

### BLOCKER: Double-nested `/api/` prefix in loyalty rewards routes

**File:** hotel-app-be/src/routes/loyalty.rs:39-45
**Problem:** Seven reward endpoints use `/api/rewards` path prefix:
```rust
.route("/api/rewards", get(get_all_rewards))
.route("/api/rewards/{id}", get(get_single_reward))
.route("/api/rewards", post(create_reward))
.route("/api/rewards/{id}", put(update_reward))
.route("/api/rewards/{id}", delete(delete_reward))
.route("/api/rewards/redemptions", get(get_redemptions))
.route("/api/rewards/{id}/redeem", post(redeem_reward_by_id))
```

Since the routes are nested under `/api` in mod.rs:250 (`.nest("/api", api_routes)`), these become:
- `/api/api/rewards` (wrong)
- `/api/api/rewards/{id}` (wrong)
- `/api/api/rewards/redemptions` (wrong)
- `/api/api/rewards/{id}/redeem` (wrong)

Correct paths should be `/rewards`, `/rewards/{id}`, `/rewards/redemptions`, `/rewards/{id}/redeem` to match the `/loyalty/` prefix pattern of other routes in the same file.

**Impact:** Any frontend call to `/api/rewards*` will get 404. If the rewards CRUD was recently added or the endpoints are called from the frontend without the double path, all reward management features are broken.

**Fix:** Remove the `/api/` prefix from lines 39-45 in loyalty.rs.

---

## Summary

- **Part A (Backend proxy):** PASS — all API prefixes are correctly forwarded
- **Part B (Frontend page registry):** PASS — all pages are registered or properly delegated
- **Critical issue found:** Double-nested `/api/` prefix in loyalty rewards endpoints
- **CheckedEmpty:** No missing conventions in audit-logs, admin, analytics, hotel-settings routes; all are correctly nested under `/api`
