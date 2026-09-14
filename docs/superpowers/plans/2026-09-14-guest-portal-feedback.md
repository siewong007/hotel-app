# Guest Portal Feedback System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every guest-facing failure exactly one predictable feedback owner — no toast+inline duplicates, no invisible failures — with guest-safe copy, full i18n, and accessible states across the Guest Portal, guest booking, pre-check-in, auth, offers, and unsubscribe surfaces.

**Architecture:** The shared `ky` client's `beforeError` hook emits a global `api:notification` toast for any failed request carrying a server error message — unless the request sets `x-skip-api-notification`. Guest surfaces already render every failure inline, so the fix is to mark guest-owned requests at their existing header-helper chokepoints (`authHeaders`, `bookingTokenHeaders`), give the handful of silent `catch`es real inline owners first, add a backward-compatible opt-in for the three shared profile queries whose guest callers render inline, and suppress the redundant toast on shared auth calls whose only callers render inline. A `guestErrorMessage` helper wraps `toApiError` so transport noise ("Failed to fetch", ky timeouts) never reaches guests while server-authored messages pass through.

**Tech Stack:** React 19 + TS strict, MUI v9, TanStack Query, ky, hand-rolled i18n (`useTranslation(ns)` → `{ t, tOr }`, locales `en` + `ms`, namespaces `auth|common|errors|guestPortal|help|nav`), Vitest + Testing Library.

## Global Constraints

- **Guest Portal only.** No behavior change to Admin/Staff/Management portals or back-office. Shared code changes must be backward-compatible opt-ins or strict duplicate-removal where an inline/manual owner already exists on every caller.
- All HTTP stays on `src/api/client.ts`'s `api` instance. No `fetch`.
- The suppression header is `SKIP_API_NOTIFICATION_HEADER = 'x-skip-api-notification'` from `src/utils/apiNotifications.ts`; send value `'true'` (matches `src/api/ekyc.service.ts` precedent).
- Do NOT modify `src/api/client.ts` — `beforeError`, `afterResponse`, and `isGuestPortalRequest` stay as they are.
- Do NOT suppress the toast for shared mutations (`revokeSession`, `deletePasskey`, `enableTwoFactor`, `updateProfile`, …): callers notify manually with the identical message and `ApiNotificationHost`'s 1.5s identical-message dedupe already collapses the pair to one toast.
- Guest-facing error text rule: HTTP error → server's own `error`/`message` body (it is the user-facing contract); anything else (timeout, offline, TypeError) → the caller's friendly fallback. `toApiError(err, fallback)` already implements this; the guest helper is a named wrapper.
- i18n: add keys to BOTH `src/i18n/resources/en/<ns>.json` and `src/i18n/resources/ms/<ns>.json` in the same edit; `src/i18n/resources/resources.test.ts` enforces parity. Use `t()` once the key exists; `tOr(key, fallback)` only where a string stays untranslated.
- Frontend commands (run from `hotel-web-fe/`): `bun run test` (vitest), `bun run typecheck`, `bun run lint`. Service tests mock `./client`'s `api`; HTTP errors built with `buildKyHttpError` from `src/api/testSupport/httpError.ts`.
- `git status --short` before every edit session — concurrent sessions share this tree; do not touch paths already dirty from other work (currently `hotel-app-be/tests/*` — outside our scope anyway).
- Follow repo conventions: `PascalCase` components, `useX` hooks, feature-local utils under `src/features/<domain>/`. No new dependencies.

## Feedback ownership rules (the architecture being installed)

- **Field-level problems** → beside the field (MUI `error` + `helperText`, `ConsentBlock` per-item text).
- **Submit-level failures** → one form-level `Alert` near the submit control, focused via `useAutoFocusError`.
- **Load/query failures** → section-level error state with visible **Retry** (the existing `ErrorState` pattern in `PortalDashboardSections.tsx`).
- **Background/best-effort failures** (security mutations, One Tap sign-in) → single toast via manual `emitApiNotification`/`notify`.
- **Global toast** (`beforeError` emit) → suppressed on every request whose UI owns the error; retained only where no other owner exists.
- **Empty data** → empty-state copy, never error styling; **loading** → spinner/skeleton only while loading, never alongside an error.
- One action → one message. Distinct simultaneous statuses (account created + details saved + check-in pending) are separate facts, not duplicates — consolidate their presentation, don't delete them.

---

### Task 1: `guestErrorMessage` helper + `useAutoFocusError` hook

**Files:**
- Create: `hotel-web-fe/src/features/guestPortal/utils/feedback.ts`
- Create: `hotel-web-fe/src/features/guestPortal/utils/feedback.test.ts`
- Create: `hotel-web-fe/src/hooks/useAutoFocusError.ts`
- Create: `hotel-web-fe/src/hooks/useAutoFocusError.test.tsx`

**Interfaces:**
- Produces: `guestErrorMessage(error: unknown, fallback: string): string` — used by every guest surface in place of `errorMessage()`, `getQueryErrorMessage`, and raw `err.message`.
- Produces: `useAutoFocusError(error: unknown): RefObject<HTMLDivElement | null>` — attach the ref to a form-level `Alert` (`tabIndex={-1}`); focuses it whenever `error` transitions to truthy. Used by Tasks 10-15.

- [ ] **Step 1: Write the failing test for `guestErrorMessage`**

```ts
import { describe, it, expect } from 'vitest';
import { buildKyHttpError } from '../../../api/testSupport/httpError';
import { guestErrorMessage } from './feedback';

describe('guestErrorMessage', () => {
  it('returns the server-provided message for HTTP errors', () => {
    const err = buildKyHttpError(400, { error: 'This voucher cannot be applied to the selected stay' });
    expect(guestErrorMessage(err, 'Something went wrong'))
      .toBe('This voucher cannot be applied to the selected stay');
  });

  it('collapses transport failures to the fallback', () => {
    expect(guestErrorMessage(new TypeError('Failed to fetch'), 'We could not reach the server. Please try again.'))
      .toBe('We could not reach the server. Please try again.');
  });

  it('returns the fallback for non-Error throws', () => {
    expect(guestErrorMessage('boom', 'Please try again.')).toBe('Please try again.');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `cd hotel-web-fe && bun run test -- src/features/guestPortal/utils/feedback.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/guestPortal/utils/feedback.ts
import { toApiError } from '../../../api/client';

/**
 * Guest-facing error text: the server's own message when it provided one
 * (the `{"error": ...}` body is the user-facing contract), otherwise the
 * caller's friendly fallback — never transport noise like "Failed to fetch"
 * or a ky timeout string.
 */
export function guestErrorMessage(error: unknown, fallback: string): string {
  return toApiError(error, fallback).message;
}
```

- [ ] **Step 4: `useAutoFocusError` — test then implement**

Test renders a component that sets error on click; asserts `document.activeElement` becomes the alert div. Implementation:

```ts
// src/hooks/useAutoFocusError.ts
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus a form-level error alert when it appears so keyboard and
 * screen-reader users land on the failure instead of hunting for it.
 * Attach the ref to an element with `tabIndex={-1}` (MUI `Alert` forwards
 * refs to its root div). Only use on submit-driven errors — focusing a
 * background-load failure would yank the user away from what they are doing.
 */
export function useAutoFocusError(error: unknown): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return ref;
}
```

- [ ] **Step 5: Run both test files — expect PASS. Commit.**

```bash
git add hotel-web-fe/src/features/guestPortal/utils/ hotel-web-fe/src/hooks/useAutoFocusError.*
git commit -m "feat(guest-portal): add guest-facing error helper and error-focus hook"
```

---

### Task 2: Give silent catches an inline owner (BEFORE suppressing toasts)

Suppressing the global toast turns today's silent catches into invisible failures. Fix owners first.

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/components/dashboard/PortalDashboardSections.tsx` (~line 1204 `loadPendingBookings` catch → `setPendingBookings([])`)
- Modify: `hotel-web-fe/src/features/guestPortal/booking/PortalBookingPage.tsx` (line ~185 `.catch(() => setVouchers([]))`)
- Verify: `hotel-web-fe/src/features/guestPortal/hooks/usePortalSessionBootstrap.ts:79`, `hotel-web-fe/src/features/guestPortal/components/GuestPaymentPanel.tsx:~71`, `hotel-web-fe/src/features/guestPortal/components/dashboard/IdentitySection.tsx:120` — confirm each sets inline error state; fix any that don't.
- Leave silent (legitimate): `portalTokenStore.ts`, `bookingAccessTokenStore.ts`, `useGuestLoyaltySocket.ts`, `useSupportSocket.ts`, `useAvailabilitySocket.ts`, `dashboardUtils.ts` date parse, `usePortalSession.ts` logout (fire-and-forget).

**Interfaces:**
- Consumes: `guestErrorMessage` from Task 1.

- [ ] **Step 1: `PaymentsSection` — pending bookings failure gets an error state**

In `loadPendingBookings`, replace the silent `catch { setPendingBookings([]) }` with a `pendingError` state; render a compact `Alert severity="warning"` + **Try again** button above the pending-payments list (failure here must not block the transactions list — it is a secondary surface). Reuse `guestErrorMessage(err, t('guestPortal:payments.pendingLoadFailed'))`.

- [ ] **Step 2: `PortalBookingPage` — voucher-options failure gets an inline note**

Replace `.catch(() => setVouchers([]))` with a `vouchersError` state; in the voucher picker area render a small `Alert severity="warning"` + retry button. A voucher-load failure must not mask the quote/search flow.

- [ ] **Step 3: Verify the remaining bare catches**

`usePortalSessionBootstrap` — confirm the catch sets `bootstrapError` (it does per audit; leave). `GuestPaymentPanel` line ~71 and `IdentitySection` line ~120 — read the catch bodies; if either swallows without setting the component's error state, wire it to the existing `error`/`loadError` state with a guest-safe fallback.

- [ ] **Step 4: Extend existing component tests**

`PortalBookingPage.test.tsx`: mock `voucherOptions` rejection → assert the warning alert renders and the quote flow still works. `PortalDashboardSections` has no dedicated test file — if none exists, cover `PaymentsSection` via a new focused test file or cover through the dashboard page test if present.

- [ ] **Step 5: Run tests — PASS. Commit.**

```bash
git commit -m "fix(guest-portal): surface pending-payment and voucher load failures inline"
```

---

### Task 3: Skip header — guest-owned authenticated services

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/api/guestPortalDashboard.service.ts` — `authHeaders()` + `createSession` (no token yet — inline `headers`)
- Modify: `hotel-web-fe/src/api/guestPortal.service.ts` — `bookingTokenHeaders()` + `verify` (inline `headers`)
- Modify: `hotel-web-fe/src/features/guestPortal/booking/api.ts` — `authHeaders()`
- Modify: `hotel-web-fe/src/features/guestPortal/api/guestPortalSupport.service.ts` — `authHeaders()`
- Modify: `hotel-web-fe/src/features/promotions/api/portalPromotionsApi.ts` — `authHeaders()`
- Modify: `hotel-web-fe/src/features/communications/api/portalCommunicationsApi.ts` — `authHeaders()`
- Test: `hotel-web-fe/src/features/guestPortal/api/guestPortalSupport.service.test.ts`, `src/features/promotions/api/portalPromotionsApi.test.ts`, `src/features/communications/api/portalCommunicationsApi.test.ts` (extend); create `guestPortalDashboard.service.test.ts` / `guestPortal.service.test.ts` if absent

**Interfaces:**
- Consumes: `SKIP_API_NOTIFICATION_HEADER` from `src/utils/apiNotifications.ts`.
- Produces: every `/guest-portal/*` request now carries `x-skip-api-notification: true`. No signature changes.

- [ ] **Step 1: Extend one existing service test to assert the header**

Pattern (mirror `src/api/ekyc.service.test.ts`):

```ts
post.mockReturnValue(mockJsonResponse({}));
await GuestPortalDashboardService.cancelBooking(3, 'plans changed', 'tok');
expect(post).toHaveBeenCalledWith('guest-portal/me/bookings/3/cancel', {
  headers: { Authorization: 'Bearer tok', 'x-skip-api-notification': 'true' },
  json: { reason: 'plans changed' },
});
```

- [ ] **Step 2: Run — FAIL. Implement.**

```ts
// in each service file
import { SKIP_API_NOTIFICATION_HEADER } from '<relative>/utils/apiNotifications';

function authHeaders(token?: string): Record<string, string> {
  const guestToken = token ?? getPortalToken();
  if (!guestToken) throw new Error('Not signed in to the guest portal');
  // Guest surfaces render every failure inline — the shared client's
  // global toast would repeat the same message.
  return {
    Authorization: `Bearer ${guestToken}`,
    [SKIP_API_NOTIFICATION_HEADER]: 'true',
  };
}
```

Same for `bookingTokenHeaders` in `src/api/guestPortal.service.ts` (merge into the returned record).

- [ ] **Step 3: Tokenless calls in the same files**

`createSession` → `api.post('guest-portal/session', { timeout: 10_000, headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' } })`. `GuestPortalService.verify` → add the same `headers` option.

- [ ] **Step 4: Assert header presence for one method per file across all six files; run service tests — PASS.**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(guest-portal): own API errors inline — suppress duplicate global toast on portal requests"
```

---

### Task 4: Skip header — unauthenticated guest-facing calls

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/booking/api.ts` — `PublicBookingApi.search/quote/create` (3 calls, `booking/*` paths)
- Modify: `hotel-web-fe/src/features/communications/api/publicCommunicationsApi.ts` — `view`/`unsubscribeTopic`/`unsubscribeAll` (3 calls). Caller check done: only `UnsubscribePage`, which renders errors at page level.
- Modify: `hotel-web-fe/src/features/promotions/api/promotionsApi.ts` — `listPublic` ONLY (`promotions` path; sole caller is `usePromotionCatalog` → `PromotionCatalog`, guest-only per grep). Do NOT touch `listAdmin`/`create`/`update`/`transition`/`listVouchers`/`issueVoucher`/`revokeVoucher`.
- Test: extend `publicCommunicationsApi.test.ts`, `promotionsApi.test.ts` (listPublic case), `booking/api` tests if present.

- [ ] **Step 1: Write header assertions for each of the 7 calls (fail).**
- [ ] **Step 2: Add `headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' }` to each call's options.**
- [ ] **Step 3: Run tests — PASS. Commit.**

```bash
git commit -m "fix(guest-portal): suppress duplicate toast on public guest endpoints"
```

---

### Task 5: Shared auth-flow calls — suppress the redundant toast

Approved decision: the shared auth pages' toast+inline duplicate is removed on both portals (inline alert remains the owner — strict dedup, no feedback lost).

**Files:**
- Modify: `hotel-web-fe/src/auth/AuthContext.tsx` — `api.post('auth/login', …)` (~line 375); passkey ceremony calls `auth/passkey/register/start` (~517), `…/register/finish` (~580), `…/login/start` (~614), `…/login/finish` (~675). Leave `auth/logout` (fire-and-forget — keep its toast off too? No: logout failures have no UI owner; leave default).
- Modify: `hotel-web-fe/src/api/auth.service.ts` — `register`, `loginWithGoogle`, `lookupLoginIdentifier`, `completeGuestProfile`, `verifyEmail`
- Test: `hotel-web-fe/src/api/auth.service.test.ts` — extend existing assertions with the header; AuthContext tests if present.

**Caller audit (done — every caller owns feedback):**
- `login` → `LoginPage` (inline `Alert`); `loginWithGoogle` → `LoginPage` Google button (inline) + `useGoogleOneTap` (emits its own translated toast — today it produces **two different toasts** for one failure; suppression leaves exactly one).
- `register` → `RegisterPage` (inline). `lookupLoginIdentifier` → `LoginPage` (inline). `completeGuestProfile` → `CompleteProfilePage` (inline). `verifyEmail` → `EmailVerificationPage` (page-level states).
- Passkey calls → `registerPasskey` (`UserProfilePage` + `SecuritySection`, both `notify()` manually) and `loginWithPasskey` (`LoginPage`, inline).

- [ ] **Step 1: VERIFY LoginPage's Google-button and passkey handlers set the inline error state** (read `LoginPage.tsx` handlers). If any auth path relies solely on the global toast, leave that call's emit on and note it.

- [ ] **Step 2: Extend `auth.service.test.ts`** — each covered method asserts `headers` containing `'x-skip-api-notification': 'true'` (merge with the existing `cf-turnstile-response` header logic in `register` — both keys must survive).

- [ ] **Step 3: Implement.** In `auth.service.ts` add the header to each listed call. In `register`, merge: `headers: { ...(turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {}), [SKIP_API_NOTIFICATION_HEADER]: 'true' }`. In `AuthContext.tsx` add the same `headers` option to the five `api.post` calls listed.

- [ ] **Step 4: Run `auth.service.test.ts` + `LoginPage.test.tsx` + `RegisterPage.test.tsx` + `GuestOneTap.test.tsx` — PASS.**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(auth): drop duplicate toast on sign-in flows — inline alert is the owner"
```

---

### Task 6: Opt-in suppression on shared profile queries (guest Security/Devices)

Guest `SecuritySection`/`DevicesSection` render inline `ErrorState` + retry for these loads; staff `UserProfilePage` tabs rely on the toast alone — so suppression must be opt-in per caller.

**Files:**
- Modify: `hotel-web-fe/src/api/auth.service.ts` — `listSessions`, `listPasskeys`, `getTwoFactorStatus` gain an optional options param
- Modify: `hotel-web-fe/src/features/user/hooks/useProfileQueries.ts` — `useSessionsQuery`, `usePasskeysQuery`
- Modify: `hotel-web-fe/src/features/auth/hooks/useTwoFactorQueries.ts` — `useTwoFactorStatus`
- Modify: `hotel-web-fe/src/features/guestPortal/components/dashboard/SecuritySection.tsx` (~line 197 `usePasskeysQuery()`, ~803 `useTwoFactorStatus()`), `DevicesSection.tsx` (~line 102 `useSessionsQuery()`)
- Test: extend `auth.service.test.ts`; hook-level tests if a pattern exists (`usePromotionCatalog.test.tsx` is the model)

**Interfaces:**

```ts
// auth.service.ts
export interface ApiRequestOptions {
  /** The caller renders this failure itself — skip the global toast. */
  suppressApiNotification?: boolean;
}
```

- [ ] **Step 1: Failing tests** — `AuthService.listSessions({ suppressApiNotification: true })` sends the header; `listSessions()` (no arg) sends none.

- [ ] **Step 2: Implement**

```ts
// auth.service.ts
import { SKIP_API_NOTIFICATION_HEADER } from '../utils/apiNotifications';

export interface ApiRequestOptions {
  suppressApiNotification?: boolean;
}

function apiRequestOptions(options?: ApiRequestOptions) {
  return options?.suppressApiNotification
    ? { headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' } }
    : undefined;
}

static async listSessions(options?: ApiRequestOptions): Promise<UserSessionInfo[]> {
  return await api.get('profile/sessions', apiRequestOptions(options)).json<UserSessionInfo[]>();
}
// same for listPasskeys, getTwoFactorStatus
```

```ts
// useProfileQueries.ts
export function useSessionsQuery(options?: ApiRequestOptions) {
  return useQuery<UserSessionInfo[]>({
    queryKey: queryKeys.profile.sessions(),
    queryFn: () => AuthService.listSessions(options),
  });
}
// same for usePasskeysQuery; useTwoFactorStatus in useTwoFactorQueries.ts
```

- [ ] **Step 3: Guest sections opt in**

`DevicesSection`: `useSessionsQuery({ suppressApiNotification: true })`. `SecuritySection`: `usePasskeysQuery({ suppressApiNotification: true })`, `useTwoFactorStatus({ suppressApiNotification: true })`. Also grep the guest sections for other shared queries (`useProfileQuery`, `useUpdateProfileMutation`, `useUpdatePasswordMutation`) — extend the opt-in to any that render inline errors; leave mutations suppressed-or-not per Global Constraints.

- [ ] **Step 4: Tests — PASS. Confirm `UserProfilePage.test.tsx` still passes (staff untouched).**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): opt-in notification suppression on shared profile queries; guest security/devices opt in"
```

---

### Task 7: ErrorBoundary — stop leaking raw exceptions to guests

**Files:**
- Modify: `hotel-web-fe/src/components/common/ErrorBoundary.tsx`
- Modify: `hotel-web-fe/src/guest/GuestRootLayout.tsx`
- Test: `hotel-web-fe/src/components/common/ErrorBoundary.test.tsx` (create if absent)

**Interfaces:**
- Produces: `ErrorBoundary` prop `detailMessage?: string` — when set, replaces the raw `error.message` in the fallback's "Error Details" alert. Default keeps current behavior (staff unchanged).

- [ ] **Step 1: Failing test** — boundary with `detailMessage="We hit a problem loading this page."` shows that text, not `TypeError: undefined is not…`; without the prop, raw message still shows.

- [ ] **Step 2: Implement**

```tsx
interface ErrorFallbackProps extends FallbackProps {
  title?: string;
  detailMessage?: string;
}
// in ErrorFallback:
{detailMessage ?? (errorMessage || 'An unexpected error occurred')}
// thread through ErrorBoundary props → FallbackComponent
```

- [ ] **Step 3: `GuestRootLayout`** — `<ErrorBoundary title={t('guestPortal:errorBoundary.title')} detailMessage={t('guestPortal:errorBoundary.detail')}>`; add keys `errorBoundary.title` ("We hit a problem") / `.detail` ("Something went wrong while loading this page. Please try again.") to en+ms `guestPortal.json`. The layout is a function component — `useTranslation('guestPortal')` is fine.

- [ ] **Step 4: Tests — PASS. Commit.**

```bash
git commit -m "fix(guest-portal): show generic detail in guest error boundary instead of raw exception text"
```

---

### Task 8: Per-surface copy + `guestErrorMessage` sweep — dashboard sections

For each surface: replace `errorMessage()`/local `getErrorMessage`/`getQueryErrorMessage`/raw `err.message` with `guestErrorMessage`, normalize fallback copy per the tone rules, and wrap ALL user-visible strings (not just errors — user chose full i18n) in `t()` with new keys added to en+ms `guestPortal.json`.

**Files:**
- Modify: `PortalDashboardSections.tsx` — all sections: Overview, Bookings, Payments, Credits, PointsHistory, Profile, Identity, Security, Devices, BookingDetailsDialog (receipt upload), cancel dialog; `ErrorState`/`LoadingState`/`EmptyState` helpers
- Modify: `GuestPortalNotificationBell.tsx`, `GuestPortalShell.tsx`, `PortalDashboardPage.tsx`
- Modify: `hotel-web-fe/src/i18n/resources/en/guestPortal.json`, `ms/guestPortal.json`
- Test: `GuestPortalShell.test.tsx`, plus new assertions where states change

- [ ] **Step 1: Inventory** — list every hardcoded user-facing string + every `catch`/`errorMessage`/`getQueryErrorMessage` call in the four files.

- [ ] **Step 2: Add keys** under a coherent shape, e.g. `dashboard.bookings.loadError` ("We couldn't load your bookings. Please try again."), `dashboard.bookings.empty`, `dashboard.payments.pendingLoadFailed`, `notifications.refreshFailed`, … — names following the existing `guestPortal.json` nesting.

- [ ] **Step 3: Apply** — `guestErrorMessage(err, t('guestPortal:dashboard.bookings.loadError'))`; `t()` for static copy. Add `role="alert"` on dynamically-injected `Alert`s that lack it.

- [ ] **Step 4: ms translations** for every new key (proper Malay, matching existing `ms/guestPortal.json` tone).

- [ ] **Step 5: `bun run test` + `typecheck` — PASS. Commit.**

```bash
git commit -m "feat(guest-portal): i18n + guest-safe error copy across dashboard sections"
```

---

### Task 9: Copy + i18n — booking page & payment panel

**Files:**
- Modify: `src/features/guestPortal/booking/PortalBookingPage.tsx` (incl. its local `errorMessage` helper and the `availabilityLost`/create/search/quote error paths), `src/features/guestPortal/components/GuestPaymentPanel.tsx`, `booking/utils` if they emit user text
- i18n: `guestPortal.json` — `booking.*`, `payment.*` sections
- Test: `PortalBookingPage.test.tsx`, `PortalBookingPageAnonymous.test.tsx`, `GuestPaymentPanel.test.tsx`

- [ ] Steps as Task 8: inventory → keys → `guestErrorMessage` + `t()` → ms → test → commit. Verify success confirmations render exactly once (booking-created state vs. any toast) and disabled/submitting states block repeat clicks on search/quote/create/pay buttons.

```bash
git commit -m "feat(guest-portal): i18n + guest-safe error copy on booking and payment"
```

---

### Task 10: Copy + i18n — pre-check-in flow

**Files:**
- Modify: `src/features/bookings/components/GuestCheckInLanding.tsx`, `GuestCheckInVerify.tsx`, `GuestCheckInForm.tsx`, `GuestCheckInConfirmation.tsx`, `guestCheckIn/ClaimAccountStep.tsx`, `guestCheckIn/PreCheckInDetailsStep.tsx`, `guestCheckIn/IdentitySection.tsx` (if present under guestCheckIn — else the dashboard one is Task 8's)
- i18n: `guestPortal.json` — new `checkin.*` section
- Test: `GuestCheckInForm.test.tsx` + step tests

Specific fixes beyond the mechanical sweep:
- [ ] `ClaimAccountStep`: the `alreadyClaimed` check does `message.toLowerCase().includes('already exists')` — switch to matching the HTTP 409/APIError `statusCode` so copy never depends on server phrasing.
- [ ] `ClaimAccountStep` consent duplication: keep the form-level alert concise ("Please review and accept the required agreements") — field-level consent text stays the field owner; no repeated sentences.
- [ ] `GuestCheckInForm` done step: consolidate `accountNotice` + `detailsSaved` + `checkinResult`/`checkinError` + identity status into a single summary `Alert`/status list — one container, distinct lines per fact.
- [ ] `GuestCheckInVerify`: page-level failure keeps "Back to Start" action; message via `guestErrorMessage` + friendly fallback.
- [ ] Commit: `feat(guest-portal): i18n + coherent feedback in pre-check-in flow`

---

### Task 11: Copy + i18n — auth pages (shared, approved)

**Files:**
- Modify: `src/features/auth/components/LoginPage.tsx`, `RegisterPage.tsx`, `EmailVerificationPage.tsx`, `CompleteProfilePage.tsx`
- i18n: `auth.json` (en+ms) — add missing keys for register/verify/complete-profile hardcoded strings
- Test: `LoginPage.test.tsx`, `RegisterPage.test.tsx`, `EmailVerificationPage.test.tsx`, `CompleteProfilePage.test.tsx`

- [ ] `EmailVerificationPage`: replace "please contact support" dead-end with an actionable next step (link to `/guest-portal` support or re-login path that exists).
- [ ] `CompleteProfilePage`: field-level `helperText` for first/last name failures (currently form-level only) — keep form-level summary for submit failures.
- [ ] Swap `errorMessage` → `guestErrorMessage` — safe here: identical output for HTTP errors; only transport failures change to fallback.
- [ ] Commit: `feat(auth): i18n + guest-safe error copy on shared auth pages`

---

### Task 12: Copy + i18n — support, preferences, unsubscribe, promotions

**Files:**
- Modify: `PortalSupportTab.tsx`, `PortalSupportWidget.tsx`, `src/features/communications/components/PortalNotificationPreferences.tsx`, `src/features/communications/pages/UnsubscribePage.tsx`, `src/features/promotions/components/PromotionCatalog.tsx`, `VoucherWallet.tsx`, `src/features/promotions/pages/OffersPage.tsx`
- i18n: `guestPortal.json` (`support.*`, `preferences.*`, `unsubscribe.*`, `offers.*`, `vouchers.*`) — OffersPage marketing copy may stay keyed under `guestPortal.offers.*`
- Test: existing component tests per file

- [ ] `PortalNotificationPreferences`: verify `savedMessage` and `error` can't coexist (mutation start clears both; assert stale success clears on failure).
- [ ] `UnsubscribePage`: page-level invalid-link alert, mutation error inline, success once — plus `t()` throughout.
- [ ] Commit: `feat(guest-portal): i18n + guest-safe copy on support, preferences, unsubscribe, offers`

---

### Task 13: Focus management + a11y attributes

**Files:**
- Wire `useAutoFocusError` (Task 1) into form-level alerts on: `LoginPage`, `RegisterPage`, `CompleteProfilePage`, `GuestCheckInLanding`, `ClaimAccountStep`, `PreCheckInDetailsStep`, `PortalBookingPage` (search/quote/create forms), `ProfileSection`, `PortalSupportTab` (new-conversation + reply forms), `UnsubscribePage` (mutation alert), booking cancel + receipt-upload dialogs.
- Audit `role="alert"`/`aria-*` on dynamically injected alerts; `aria-busy`/`aria-disabled` consistency on submitting buttons.

- [ ] Steps: per file, attach `ref={errorRef}` + `tabIndex={-1}` to the form-level `Alert`, pass the caught error to `useAutoFocusError`. Tests: one representative focus assertion (e.g., `PortalBookingPage` submit failure focuses the alert).

```bash
git commit -m "feat(a11y): focus form-level errors on submit failure across guest surfaces"
```

---

### Task 14: Theme/contrast + state-matrix verification pass

- [ ] Verify in `createHotelTheme`/`darkTokens` that `status.{success,warning,danger,info}.{bg,fg,border}` drive all `Alert` variants; spot-fix any `color="error"` text that isn't an `Alert` (e.g. `GuestPortalNotificationBell` upload error `Typography color="error"` — ensure contrast or wrap in `Alert`).
- [ ] Toast: `variant="filled"` on dark — verify contrast ratio of `Alert` filled tokens; adjust only guest-visible issues, never the shared theme tokens without a dark+staff check.
- [ ] State matrix per surface: loading-only / error-only / empty / success-once / disabled-while-submitting / retry-present. Confirm no spinner+error simultaneity (Task 2 fixed the known cases).
- [ ] Focus indicators + mobile placement spot-check via existing component tests; document any unfixed theme limitation in the final summary.

---

### Task 15: Final verification

- [ ] `bun run typecheck && bun run lint && bun run test` from `hotel-web-fe/` — all green; fix-gated stale failures investigated.
- [ ] `bun run build` — clean.
- [ ] `git diff master --stat` — confirm zero files under admin/staff/back-office paths changed beyond the approved shared touches (`AuthContext.tsx`, `auth.service.ts`, `useProfileQueries.ts`, `useTwoFactorQueries.ts`, `ErrorBoundary.tsx` — all backward-compatible).
- [ ] Summarize: root causes fixed, files touched, residuals (logout toast retained by design; mutation double-emit handled by dedupe).

---

## Residuals & documented non-goals

- `guestPortalDashboard.service.ts`'s documented 401/`auth:unauthorized` shared-tab risk — unchanged, out of scope.
- `AuthContext` `auth/logout` failure toast — retained (no other owner).
- `GuestOneTap` success/info toasts — retained (that's its designed channel).
- Marketing/display copy on `OffersPage` gets keys but wording stays as-is unless it's feedback text.
