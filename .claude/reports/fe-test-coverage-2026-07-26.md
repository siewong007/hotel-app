# Frontend Test Coverage Matrix — hotel-web-fe
**Generated 2026-07-26** | Total production files: 448 | Test files: 53 | Coverage floor: 2.5% (vitest config)

---

## Executive Summary

- **API Services:** 28 modules, 4 tested (14%), 24 untested
- **Utilities:** 12 modules, 6 tested (50%), 6 untested
- **Auth:** 3 modules, 1 tested (33%), 2 untested
- **Desktop:** 2 modules, 1 tested (50%), 1 untested
- **Hooks:** 6 modules, 0 tested (0%), 6 untested
- **Navigation:** 2 modules, 0 tested (0%), 2 untested
- **Routes:** 44 files, 1 tested (2%), 43 untested
- **Features (22 domains):** ~350 files across components/hooks/api/utils, ~40 tested (~11%), ~310 untested

**Overall:** ~448 production files, 53 test files → **11.8% test coverage by file count** (misleading metric; actual code coverage is ~2.5% per vitest config).

---

## API Services (src/api/*.service.ts)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| admin.service.ts | UNTESTED | — | Customer ledger, payment approvals, night audit, data transfer calls |
| analytics.service.ts | UNTESTED | — | Dashboard analytics queries |
| audit.service.ts | UNTESTED | — | Audit log queries |
| auth.service.ts | UNTESTED | — | Login, 2FA, passkey endpoints |
| bookings.service.ts | **TESTED** | bookings.service.test.ts | Payment method & online channel filters (2 test suites, ~18 cases) |
| **client.ts** | **TESTED** | client.test.ts | ky HTTP client configuration, auth header injection |
| companies.service.ts | UNTESTED | — | Company CRUD operations |
| dataTransfer.service.ts | UNTESTED | — | Data import/export endpoints |
| ekyc.service.ts | UNTESTED | — | eKYC guest verification |
| guestPortal.service.ts | UNTESTED | — | Guest portal dash, booking preview |
| guests.service.ts | UNTESTED | — | Guest profile CRUD, search |
| housekeeping.service.ts | UNTESTED | — | Room status, housekeeping tasks |
| invoices.service.ts | **TESTED** | invoices.service.test.ts | Invoice fetch, checkout calculation (minimal) |
| ledger.service.ts | UNTESTED | — | Customer ledger balance, transactions |
| loyalty.service.ts | UNTESTED | — | Loyalty points, member tier |
| loyaltyAdmin.service.ts | UNTESTED | — | Loyalty admin operations |
| maintenance.service.ts | **TESTED** | maintenance.service.test.ts | Maintenance task CRUD operations |
| nightAudit.service.ts | UNTESTED | — | Night audit reconciliation |
| paymentApprovals.service.ts | UNTESTED | — | Payment approval workflow |
| queryClient.ts | N/A | — | TanStack Query client setup |
| queryConfig.ts | N/A | — | Query config constants |
| queryInvalidation.ts | N/A | — | Query cache invalidation helpers |
| queryKeys.ts | N/A | — | Query key factory |
| rates.service.ts | UNTESTED | — | Room rates, rate plans |
| reports.service.ts | UNTESTED | — | Report generation endpoints |
| rooms.service.ts | UNTESTED | — | Room inventory, availability |
| search.service.ts | UNTESTED | — | Global search queries |

**API Service Gap Analysis:** Authentication, payments, ledger balance queries, and room inventory — all critical paths — have zero test coverage.

---

## Utilities (src/utils/*.ts)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| apiNotifications.ts | **TESTED** | apiNotifications.test.ts | Toast/notification message formatting |
| bookingUtils.ts | UNTESTED | — | Booking status display, duration calc |
| currency.ts | **TESTED** | currency.test.ts | Currency formatting, decimals |
| date.ts | **TESTED** | date.test.ts | ISO string parsing, timezone conversion (hotel-timezone aware) |
| hotelSettings.ts | UNTESTED | — | Settings cache, timezone, defaults |
| index.ts | N/A | — | Re-exports |
| money.ts | **TESTED** | money.test.ts | Money arithmetic, rounding |
| notificationStore.ts | **TESTED** | notificationStore.test.ts | Global notification state (Zustand store) |
| pagination.ts | UNTESTED | — | Page size encoding, cursor helpers |
| retry.ts | UNTESTED | — | Exponential backoff retry logic |
| storage.ts | UNTESTED | — | localStorage abstraction, session restore |
| validation.ts | **TESTED** | validation.test.ts | Email, phone, password regex validators |

**Utils Gap:** Hotel settings (timezone resolution, defaults), storage persistence, pagination logic, retry strategy all untested.

---

## Auth (src/auth/*.ts)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| AuthContext.tsx | UNTESTED | — | Session bootstrap, permission helpers, auth state machine |
| authUser.ts | **TESTED** | authUser.test.ts | JWT parsing, role/permission extraction (minimal) |
| tokenStore.ts | UNTESTED | — | In-memory access token, refresh cookie logic, session rehydration |

**Auth Gap:** Session bootstrap, cookie refresh flow, permission checking logic, token expiry handling — all untested despite being P0 security-critical.

---

## Desktop (src/desktop/*.ts)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| DesktopServiceGate.tsx | UNTESTED | — | Tauri desktop gate, environment detection |
| runtimeApi.ts | **TESTED** | runtimeApi.test.ts | Tauri IPC bridge mocking (minimal) |

**Desktop Gap:** Desktop-specific environment detection, backend port discovery, Tauri command dispatch all untested.

---

## Hooks (src/hooks/*.ts)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| index.ts | N/A | — | Re-exports |
| useApi.ts | UNTESTED | — | Wrapper around ky, error handling |
| useCurrency.ts | UNTESTED | — | Currency formatting hook |
| useDebouncedValue.ts | UNTESTED | — | Debounce state utility |
| useGlobalSearch.ts | UNTESTED | — | Global search input hook |
| useRoomAvailabilityCheck.ts | UNTESTED | — | Room availability real-time query |

**Hooks Gap:** Every hook untested. Debouncing, global search, and availability polling critical for UX.

---

## Navigation (src/navigation/*.ts)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| lazyRoute.ts | UNTESTED | — | Lazy route loader utility |
| routeRegistry.tsx | UNTESTED | — | TanStack Router file-based route registry |

**Navigation Gap:** Route registration, lazy loading, and fallback routing all untested.

---

## Routes (src/routes/*.tsx)

| File | Status | Test File | Notes |
|------|--------|-----------|-------|
| $.tsx | UNTESTED | — | 404 catch-all |
| 403.tsx | UNTESTED | — | Permission denied page |
| 423.tsx | UNTESTED | — | Locked conflict page |
| __root.tsx | UNTESTED | — | Root layout (RootLayout component) |
| admin-portal.tsx | UNTESTED | — | Admin shell wrapper |
| audit-log.tsx | UNTESTED | — | Audit log page route |
| bookings.tsx | UNTESTED | — | Bookings list page route |
| communications.tsx | UNTESTED | — | Communications page route |
| company-ledger.tsx | UNTESTED | — | Company ledger page route |
| complimentary.tsx | UNTESTED | — | Complimentary booking route |
| data-transfer.tsx | UNTESTED | — | Data import/export page |
| ekyc-admin.tsx | UNTESTED | — | eKYC admin management |
| ekyc.tsx | UNTESTED | — | Guest eKYC registration |
| guest-checkin/* (4 routes) | UNTESTED | -my-bookings.test.tsx (partial) | Check-in flow; only my-bookings has minimal tests |
| guest-config.tsx | UNTESTED | — | Guest configuration page |
| guest-portal.tsx | UNTESTED | — | Guest portal shell |
| help.tsx | UNTESTED | — | Help & support page |
| housekeeping.tsx | UNTESTED | — | Housekeeping tasks page |
| index.tsx | UNTESTED | — | Landing page (LandingPage component) |
| login.tsx | UNTESTED | — | Login page route |
| loyalty.tsx | UNTESTED | — | Loyalty admin page |
| my-bookings.tsx | **TESTED** | -my-bookings.test.tsx | Guest booking list (1 test suite, basic rendering) |
| my-rewards.tsx | UNTESTED | — | Guest rewards/points page |
| night-audit.tsx | UNTESTED | — | Night audit page |
| offers.tsx | UNTESTED | — | Guest promotion catalog |
| online-inventory.tsx | UNTESTED | — | Online channel inventory |
| payment-approvals.tsx | UNTESTED | — | Payment approval workflow |
| portal/book.tsx | UNTESTED | — | Guest booking page |
| portal/index.tsx | UNTESTED | — | Portal root/dashboard |
| profile.tsx | UNTESTED | — | User profile settings |
| promotions.tsx | UNTESTED | — | Admin promotion management |
| rbac.tsx | UNTESTED | — | RBAC admin page |
| register.tsx | UNTESTED | — | Guest registration page |
| reports.tsx | UNTESTED | — | Reports & analytics page |
| room-config.tsx | UNTESTED | — | Room inventory configuration |
| room-management.tsx | UNTESTED | — | Room status & check-in operations |
| settings.tsx | UNTESTED | — | Hotel settings page |
| support.tsx | UNTESTED | — | Support ticket management |
| timeline.tsx | UNTESTED | — | Booking timeline/history |
| unsubscribe.$token.tsx | UNTESTED | — | Email unsubscribe link |
| verify-email.tsx | UNTESTED | — | Email verification page |

**Routes Gap:** Nearly all routes untested. Critical paths (login, check-in, booking, payment) have zero route-level coverage.

---

## Features by Domain

### admin — Customer Ledger, Payments, RBAC, Audit, Night Audit, Data Transfer
**Status:** Components mostly UNTESTED; 3 test files (utils + limited component tests)
- **Tested:**
  - `utils/dataTransferDependencies.ts` (test: dataTransferDependencies.test.ts) — dependency resolution for data export
- **Untested (critical):**
  - All CustomerLedger/* dialogs (30+ components) — invoice generation, payment recording, balance editing
  - RBAC role/permission UI (12+ components)
  - AuditLogPage.tsx, NightAuditPage.tsx, DataTransferPage.tsx
  - All hooks: useAuditQueries, useLedgers, useNightAuditQueries, usePaymentApprovalsQueries, useDataTransferQueries, useRBACData, useRBACQueries
- **Files:** ~90 production files, 1 tested → 1% coverage

### audit-log — Audit Log Queries
**Status:** API only, UNTESTED
- **Tested:** None
- **Untested:** api.ts, types.ts, constants.ts
- **Files:** 4 production files, 0 tested → 0% coverage

### auth — Auth UI & Session
**Status:** 1 test file; LoginPage, RegisterPage, TwoFactorSetup, FirstLoginPasskeyPrompt all UNTESTED
- **Tested:**
  - `auth/authUser.ts` (minimal JWT parsing test)
- **Untested (P0):**
  - LoginPage.tsx, RegisterPage.tsx, TwoFactorSetup.tsx, FirstLoginPasskeyPrompt.tsx (auth UI)
  - EmailVerificationPage.tsx, ProtectedRoute.tsx
  - useTwoFactorQueries hook
- **Files:** 7 production files, 1 tested → 14% coverage (by file; actual test coverage minimal)

### bookings — Booking Creation, Check-in, My Bookings
**Status:** Moderate coverage; api tested, components mostly untested
- **Tested:**
  - `api/bookings.service.ts` (filter tests only)
  - `-my-bookings.test.tsx` (route, basic rendering)
- **Untested (critical):**
  - BookingsPage.tsx (admin booking list + filters)
  - QuickBookingModal.tsx, EnhancedCheckInModal.tsx, GuestCheckInForm.tsx
  - useBookingQueries, useBookings, useCheckInFormData, useEnhancedCheckInModalState, useBookingsPageState hooks
  - bookingChannel.ts (channel-of-origin logic)
- **Files:** ~20 production files, 2 test files (partial) → 10% file coverage

### communications — Email/SMS/Portal Notifications
**Status:** Moderate API coverage; components untested
- **Tested:**
  - `api/communicationsApi.ts` (api.test.ts)
  - `api/portalCommunicationsApi.ts` (api.test.ts)
  - `api/publicCommunicationsApi.ts` (api.test.ts)
  - PortalNotificationPreferences.tsx (minimal UI test)
  - UnsubscribePage.tsx (route test, minimal)
- **Untested:**
  - CommunicationsPage.tsx (admin send UI)
  - All message composition, queuing, delivery workflows
- **Files:** ~11 production files, 5 test files (partial) → ~45% file coverage

### customer-ledger — Ledger Types & Constants
**Status:** Types/constants only, UNTESTED (logic is in admin/CustomerLedger)
- **Tested:** None
- **Untested:** api.ts, types.ts, constants.ts
- **Files:** 4 production files, 0 tested → 0% coverage

### dashboard — Admin/Receptionist/Guest Dashboards
**Status:** Mostly UNTESTED
- **Tested:** None (analytics/charting logic untested)
- **Untested:**
  - AdminDashboard.tsx, AdminOverviewDashboard.tsx, ReceptionistDashboard.tsx, Dashboard.tsx, DashboardRouter.tsx
  - ReportsAnalytics.tsx, charts.tsx (charting logic)
  - useDashboardAnalytics hook
- **Files:** ~12 production files, 0 tested → 0% coverage

### data-transfer — Data Import/Export
**Status:** 1 test file; DataTransferPage.tsx untested
- **Tested:**
  - `utils/dataTransferDependencies.ts` (dependency validation)
- **Untested:**
  - DataTransferPage.tsx, api.ts
- **Files:** 4 production files, 1 tested → 25% coverage

### ekyc — Guest eKYC Verification
**Status:** 1 test file (validation utility); pages untested
- **Tested:**
  - `utils/ekycCreateValidation.ts` (validation rules)
- **Untested:**
  - EkycManagementPage.tsx, EkycRegistrationPage.tsx, EkycCreateDialog.tsx, EkycStatusCard.tsx
  - useEkycQueries hook
- **Files:** 7 production files, 1 tested → 14% coverage

### guestPortal — Guest Booking, Dashboard, Support Widget, Session
**Status:** Best coverage; 8 test files; critical session/dashboard logic tested
- **Tested:**
  - `api/guestPortalSupport.service.ts` (support API)
  - `api/portalTokenStore.ts` (session token store)
  - `api/usePortalSession.ts` (session bootstrap)
  - `booking/utils.ts` (availability parsing)
  - `booking/PortalBookingPage.tsx` (booking page rendering)
  - `components/PortalDashboardPage.tsx` (dashboard layout)
  - `components/PortalSupportTab.tsx` (support tab)
  - `components/GuestPortalNotificationBell.tsx` (notifications)
  - `components/dashboard/dashboardUtils.ts` (card formatting logic)
  - `components/dashboard/PortalDashboardSections.tsx` (dashboard sections rendering)
  - `hooks/usePortalSupport.ts` (support queries)
  - `hooks/usePortalSessionBootstrap.ts` (session initialization)
- **Untested:**
  - GuestPaymentPanel.tsx (payment form)
  - useGuestLoyaltySocket.ts, useSupportSocket.ts (WebSocket hooks)
  - Loyalty socket integration
- **Files:** ~27 production files, 12 test files (most are partial) → ~44% file coverage

### guests — Guest Configuration & Search
**Status:** 1 test file (utils); components untested
- **Tested:**
  - `utils.ts` (name formatting, validation)
- **Untested:**
  - GuestsPage.tsx, GuestConfigurationPage.tsx, GuestFormDialog.tsx, GuestProfileDialog.tsx
  - MembershipPointsScanner.tsx
  - useGuestQueries, useGuestCompanyOptions, useGuestConfigurationPageState hooks
- **Files:** ~13 production files, 1 tested → 8% coverage

### housekeeping — Room Tasks & Maintenance
**Status:** 0 test files
- **Tested:** None
- **Untested:**
  - HousekeepingPage.tsx, MaintenanceTab.tsx
  - useHousekeepingQueries, useMaintenanceQueries hooks
- **Files:** 5 production files, 0 tested → 0% coverage

### invoices — Invoice Generation, Checkout Modal, Print
**Status:** 1 test file (api); checkout modal logic untested
- **Tested:**
  - `api/invoices.service.ts` (minimal invoice fetch)
- **Untested:**
  - CheckoutInvoiceModal.tsx, CheckoutInvoicePrintView.tsx, InvoiceModal.tsx
  - chargesCalculation.ts (critical: room charges, fees, taxes, discounts)
  - useCheckoutFlow, useCheckoutInvoiceData, useCheckoutInvoiceModalState hooks
- **Files:** ~12 production files, 1 tested → 8% coverage

### loyalty — Loyalty Points, Member Tiers, Reports
**Status:** 0 test files
- **Tested:** None
- **Untested:**
  - LoyaltyDashboard.tsx, LoyaltyPortal.tsx, PersonalizedReportsPage.tsx
  - useLoyaltyAdmin, useLoyaltyQueries, useLoyaltySocket hooks
- **Files:** 7 production files, 0 tested → 0% coverage

### night-audit — Night Audit Reconciliation
**Status:** Types/API only, untested
- **Tested:** None
- **Untested:** api.ts, types.ts, constants.ts
- **Files:** 4 production files, 0 tested → 0% coverage

### onlineInventory — Online Channel Rates & Availability
**Status:** 0 test files
- **Tested:** None
- **Untested:**
  - OnlineInventoryPage.tsx, InventorySummary.tsx, InventoryRoomCard.tsx
  - useOnlineInventory hook
- **Files:** 6 production files, 0 tested → 0% coverage

### promotions — Promotion Management, Vouchers, Catalog
**Status:** Good coverage; 4 test files; admin and portal flows tested
- **Tested:**
  - `api/promotionsApi.ts` (admin CRUD)
  - `api/portalPromotionsApi.ts` (guest catalog)
  - `components/PromotionCard.tsx` (card rendering)
  - `components/PromotionCatalog.tsx` (catalog list)
  - `components/VoucherCard.tsx` (voucher card)
  - `components/PromotionAdminTable.tsx` (admin table)
  - `hooks/usePromotionAdmin.ts` (admin state, publish/draft transition)
  - `hooks/usePromotionCatalog.ts` (guest catalog queries)
- **Untested:**
  - PromotionEditorDialog.tsx (creation/edit form)
  - VoucherAdminTable.tsx, VoucherIssueDialog.tsx (voucher workflows)
  - VoucherWallet.tsx (guest wallet)
  - OffersPage.tsx, PromotionManagementPage.tsx (pages)
  - useVoucherWallet hook
- **Files:** ~18 production files, 8 test files → ~44% file coverage

### rbac — RBAC Admin UI
**Status:** 0 test files; all component logic untested
- **Tested:** None
- **Untested:**
  - All 15+ components (role cards, permission accordions, user tabs)
  - useRBACData, useRBACQueries hooks
- **Files:** ~20 production files, 0 tested → 0% coverage

### reports — Analytics & Reports
**Status:** 0 test files (utility test exists but needs more)
- **Tested:** `utils/reportTypography.ts` (text formatting, minimal)
- **Untested:**
  - ReportsPage.tsx, ModernReportsPage.tsx, AnalyticsDashboard.tsx
  - Charts, chart formatting, drawers
  - useReportData, useModernReportsPageState hooks
- **Files:** ~12 production files, 1 test file → 8% coverage

### rooms — Room Management, Booking, Unified Booking Modal
**Status:** Best coverage after guestPortal; 2 test files (utils + components partial)
- **Tested:**
  - `utils/roomManagementUtils.ts` (room status derivation, booking formatting)
  - `components/RoomManagement/components/RoomNotesDialog.tsx` (dialog interaction)
- **Untested (critical):**
  - RoomManagementPage.tsx, RoomStatusDialog.tsx (main room management UI)
  - UnifiedBookingModal.tsx (critical: room/rate/date selection, booking creation)
  - All 20+ dialog components (change room, check-in, checkout, notes, deposits, etc.)
  - RoomCard.tsx, RoomContextMenu.tsx (UI components)
  - All 9 room management hooks (booking, check-in workflows)
  - bookingTypes.ts, bookingTokens.ts (booking state machine)
- **Files:** ~60 production files, 2 test files → 3% file coverage

### support — Support Ticket Management
**Status:** Moderate coverage; 4 test files; conversation list/detail tested
- **Tested:**
  - `api.ts` (ticket CRUD)
  - `components/SupportConversationDetail.tsx` (detail panel)
  - `components/SupportConversationList.tsx` (list with pagination)
  - `components/SupportManagementPage.tsx` (page layout)
  - `hooks/useSupportQueries.ts` (query hook)
  - `utils.ts` (helpers)
- **Untested:**
  - SupportStatusChip.tsx (component, likely trivial)
  - Message rendering, assignment, escalation workflows (in conversations)
- **Files:** ~12 production files, 6 test files → 50% file coverage

### user — User Profile, Settings, Account Deactivation
**Status:** 0 test files
- **Tested:** None
- **Untested:**
  - SettingsPage.tsx, UserProfilePage.tsx, HelpSupportPage.tsx, AccountDeactivation.tsx
  - useSettingsQueries hook
- **Files:** 6 production files, 0 tested → 0% coverage

---

## Testing Conventions Summary

### ky API Client Mocking
All API service tests use the same pattern:
```typescript
const mockFn = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { get: (...args: any[]) => mockFn(...args) },
  };
});
```

**Key patterns:**
- Mock the `client.ts` module entirely; import the actual types
- Return a mock fn for the HTTP method (`.get()`, `.post()`, etc.)
- Call `mockFn.mockReturnValue({ json: () => Promise.resolve(data) })` to simulate responses
- Access call arguments via `mockFn.mock.calls[i]` to assert searchParams, body, etc.
- No real HTTP ever fires; all tests are synchronous (mocked promises)

### TanStack Query & Hook Testing
Tested hook patterns (e.g., `usePromotionAdmin.test.tsx`, `usePortalSessionBootstrap.test.tsx`):
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const { result } = renderHook(() => useMyHook(), { wrapper: createWrapper() });
await act(async () => { await result.current.mutate(...); });
```

**Key patterns:**
- Create a fresh QueryClient with `retry: false` to avoid test hangs
- Wrap in QueryClientProvider for every renderHook call
- Use `vi.spyOn(queryClient, 'invalidateQueries')` to verify cache invalidation
- Call mocked API functions via `vi.mock()` — same pattern as API service tests
- Use `await act(...)` for async state updates

### Component Testing (React Testing Library)
Tested component patterns (e.g., `SupportConversationList.test.tsx`, `PromotionCatalog.test.tsx`):
```typescript
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

function buildFixture(overrides = {}) {
  return { id: 42, name: 'Test', ...overrides };
}

describe('Component', () => {
  afterEach(() => cleanup());

  it('renders props and fires callbacks', () => {
    const props = {
      items: [buildFixture()],
      onSelect: vi.fn(),
    };
    render(<Component {...props} />);

    expect(screen.getByText('Test')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /test/i }));
    expect(props.onSelect).toHaveBeenCalledWith(42);
  });
});
```

**Key patterns:**
- Build fixtures with factory functions (Partial<T> overrides for flexibility)
- Render components with mocked props (callbacks are always `vi.fn()`)
- Assert DOM via `screen.getByText()`, `screen.getByRole()` (avoid `container.querySelector`)
- Fire events via `fireEvent.click()`, `fireEvent.change()` for user interactions
- **localStorage must be stubbed:**
  ```typescript
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
  });
  ```
  Without stubbing, jsdom's localStorage is undefined in vitest.
- Cleanup after each test with `afterEach(() => cleanup())`

### Utility/Helper Testing
Tested patterns (e.g., `date.test.ts`, `money.test.ts`, `validation.test.ts`):
- Pure function tests (no mocking or setup needed)
- Test edge cases: empty strings, nulls, boundary values, formatting rules
- Example: `date.test.ts` tests ISO parsing, timezone conversion (`toISOString().split` banned, use helper instead)
- Example: `money.test.ts` tests decimal rounding, currency formatting, arithmetic edge cases
- Example: `validation.test.ts` tests regex patterns for email, phone, password strength

---

## Test Coverage Gaps Ranked by Business Impact

### Tier 1: P0 Money/Booking/Auth (Silent Failures)
1. **Invoice/Checkout calculation** (`invoices/utils/chargesCalculation.ts`) — room charges, discounts, taxes, deposit application. A silent bug ruins financial records.
2. **Booking creation/check-in flow** (UnifiedBookingModal, EnhancedCheckInModal, check-in dialogs) — room selection, date handling, guest matching. Broken here = guests can't complete stays.
3. **Session bootstrap & token refresh** (AuthContext, tokenStore, usePortalSessionBootstrap) — in-memory access token, HttpOnly refresh cookie, permission rehydration. Broken = admins/guests logged out unexpectedly.
4. **Payment approval workflow** (PaymentApprovalsPage, paymentApprovals API) — marking payments as approved/rejected. Silent bug = cash reconciliation fails.
5. **Customer ledger balance updates** (CustomerLedger dialogs, ledger API) — recording payments, adjustments, voids. Off-by-one = guest balance wrong.

### Tier 2: P1 High-Impact Features (Visible Failures)
6. **Room management page** (RoomManagementPage, RoomStatusDialog, room hooks) — admins need to reliably check guests in/out and manage room status.
7. **Housekeeping/maintenance task assignment** (HousekeepingPage, MaintenanceTab, task hooks) — staff relies on this for day-to-day operations.
8. **RBAC permission UI** (all RBACManagementPage components) — admins need to trust role/permission changes.
9. **Guest portal dashboard & booking flow** (PortalDashboardPage, PortalBookingPage, guest-facing components) — key revenue stream (online bookings).
10. **Loyalty admin workflows** (LoyaltyDashboard, point tracking hooks) — guest retention feature, often manual fixes needed.

### Tier 3: P2 Secondary Features (Degraded UX)
11. **Reports & analytics** (dashboard charting, report generation)
12. **Online inventory sync** (OnlineInventoryPage, rate upload)
13. **Data transfer / migration** (DataTransferPage, import/export workflows)
14. **Promotions & vouchers** (editor dialog, voucher issuance) — most tested already, editor missing
15. **Communications** (email/SMS composition, delivery verification)

### Tier 4: Infrastructure & Edge Cases
16. **Global hooks** (useApi, useCurrency, useDebouncedValue, useGlobalSearch, useRoomAvailabilityCheck) — 0 tests; debouncing and polling logic often brittle.
17. **Desktop-specific logic** (DesktopServiceGate, Tauri IPC dispatch, backend port discovery)
18. **Navigation & route registration** (lazyRoute, routeRegistry, route-level redirect logic)
19. **Retry & backoff strategy** (utils/retry.ts exponential backoff, circuit breaker if present)
20. **Storage persistence** (utils/storage.ts localStorage abstraction, session rehydration on app boot)

---

## Recommended Next Steps

### Phase 1: Critical Money/Auth Paths (1 week, high ROI)
1. Invoice calculation tests (chargesCalculation.ts): room rates × days, discounts, taxes, tip, deposit
2. Booking creation/check-in: test UnifiedBookingModal state machine (room → dates → guest → submit)
3. Session bootstrap: test AuthContext.tsx `useEffect` on mount (refresh token restore, permission rehydration)
4. Payment approval: simple CRUD tests for paymentApprovals.service.ts

### Phase 2: Feature-Critical Components (2 weeks)
5. RoomManagementPage + RoomStatusDialog: test room status transitions, guest check-in dialog launch
6. CustomerLedger dialogs: test balance calculation, payment entry, void confirmation
7. HousekeepingPage: test task assignment and status updates
8. Guest portal booking flow: test room/date selection, availability validation

### Phase 3: Infrastructure & Global Hooks (1 week)
9. Retry logic: test exponential backoff, max retry count
10. Global hooks: useDebouncedValue, useGlobalSearch, useApi error handling
11. Desktop gate & Tauri integration: test environment detection, port discovery
12. Route registration: test lazy loading, fallback routes

---

## File-by-File Test Status Matrix

**Legend:** ✓ TESTED | ✗ UNTESTED | — N/A (config/index/setup) | ≈ PARTIAL (minimal coverage)

### API Services Summary
```
admin.service.ts ✗                invoices.service.ts ≈
analytics.service.ts ✗            ledger.service.ts ✗
audit.service.ts ✗                loyalty.service.ts ✗
auth.service.ts ✗                 loyaltyAdmin.service.ts ✗
bookings.service.ts ≈             maintenance.service.ts ≈
client.ts ✓                        nightAudit.service.ts ✗
companies.service.ts ✗            paymentApprovals.service.ts ✗
dataTransfer.service.ts ✗         queryClient.ts —
ekyc.service.ts ✗                 queryConfig.ts —
guestPortal.service.ts ✗          queryInvalidation.ts —
guests.service.ts ✗               queryKeys.ts —
housekeeping.service.ts ✗         rates.service.ts ✗
                                   reports.service.ts ✗
                                   rooms.service.ts ✗
                                   search.service.ts ✗
```

### Utilities Summary
```
apiNotifications.ts ✓        hotelSettings.ts ✗
bookingUtils.ts ✗            index.ts —
currency.ts ✓                money.ts ✓
date.ts ✓                     notificationStore.ts ✓
                             pagination.ts ✗
                             retry.ts ✗
                             storage.ts ✗
                             validation.ts ✓
```

### Features Summary (tested file count / total files)
```
admin 1/90                    guests 1/13
audit-log 0/4                 housekeeping 0/5
auth 1/7                      invoices 1/12
bookings 2/20                 loyalty 0/7
communications 5/11           night-audit 0/4
customer-ledger 0/4           onlineInventory 0/6
dashboard 0/12                promotions 8/18
data-transfer 1/4             rbac 0/20
ekyc 1/7                      reports 1/12
guestPortal 12/27             rooms 2/60
                             support 6/12
                             user 0/6
```
