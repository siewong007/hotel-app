# Quality Enhancement Plan — Design

Date: 2026-08-25
Status: Approved by owner (approach A, sequenced phases)
Scope: hotel-web-fe primarily; one backend test in hotel-app-be. No behavior changes.

## Goal

Close the four open quality gaps tracked in `docs/ongoing-dev.md` P2, in
stability-first order:

1. Flaky CI tests + one a11y bug
2. API documentation drift (no OpenAPI schema)
3. Frontend test deserts (loyalty, user/SettingsPage)
4. `any`-type burn-down (~112 hand-written sites)

Constraint: no new dependencies (per AGENTS.md dependency policy). Public
behavior, route paths, response shapes, and status codes stay identical.

## Phase 1 — Stabilize CI signal

### 1a. Flaky payment idempotency suites

Diagnosis: the code under test has no timers or retry backoff. Flakiness is
Testing-Library `waitFor` polling losing the race against default timeouts
when the suite runs in parallel under load. The 10s `asyncUtilTimeout` /
30s `testTimeout` headers in these files are mitigation, not fix.

Affected suites (same reuse-key / rotate-after-edit / clear-after-success
pattern):

- `src/features/invoices/components/CheckoutInvoiceModal.test.tsx` (2 tests)
- `src/features/bookings/components/Bookings/BookingsPage.test.tsx` (1 test)
- `src/features/bookings/components/EnhancedCheckInModal.test.tsx` (1 test)
- `src/features/admin/components/CustomerLedger/CustomerLedgerPage.test.tsx`
  (same pattern, lines ~839–1285)

Fix: wrap each affected test in
`vi.useFakeTimers({ shouldAdvanceTime: true })`, restoring real timers in
`afterEach`/`finally`, following the existing precedent at
`BookingsPage.test.tsx:671`. This makes RTL's internal polling intervals
deterministic without changing what the tests assert.

Cleanup: if nothing else in those files needs it after conversion, remove the
blanket `configure({ asyncUtilTimeout: 10_000 })` headers.

Verification: ≥10 consecutive green runs of each touched file locally plus one
full parallel `bun run test`.

### 1b. Guest portal support-widget focus (a11y)

Diagnosis: focus moves in a mount effect (`PortalSupportWidget.tsx:42–50`),
but the panel renders inside `<Slide in={open} mountOnEnter unmountOnExit>`
(line ~81), so at effect time neither the IconButton ref nor a document query
can find the close button. Focus never moves; keyboard users need an extra
Tab.

Fix: move the focus call into the Slide transition's `onEntered` callback,
where children are mounted, and scope the fallback query to the panel
container ref instead of global `document.querySelector`. Remove the stale
MUI-v9-ref workaround comment once the root cause is addressed.

Test: regression test asserting the "Close support" button has focus after
the widget opens.

## Phase 2 — OpenAPI drift guard

Problem: no OpenAPI schema exists anywhere (verified: zero utoipa/swagger/
schemars usage). `README.md`'s endpoint table (~71 endpoints, 22 domains) is
hand-maintained against 31 routers merged in
`hotel-app-be/src/routes/mod.rs::create_router` and drifts.

Design: documentation-drift guard, not full contract generation.

- New committed artifact `docs/api/openapi.json`: hand-authored skeleton —
  OpenAPI info block, tags per domain, and every registered path with its
  method(s) plus a one-line summary. Seeded from the README table, expanded
  to cover all registered paths.
- New backend integration test `hotel-app-be/tests/openapi_drift.rs`: builds
  the real router via `create_router()` (no database needed), walks the
  registered paths/methods, and fails unless the set matches `openapi.json`
  exactly in both directions. Runs without `DATABASE_URL` like the other
  non-gated test files.
- README endpoint section shrinks to a pointer at `docs/api/openapi.json`;
  the spec becomes the single source of truth.

Out of scope: request/response schemas, Swagger UI, utoipa annotations, FE
client codegen. If a live machine-readable contract is ever wanted, that is a
separate spec (utoipa) — this design deliberately does not preclude it.

Acceptance: adding, renaming, or removing any route without updating
`openapi.json` fails CI.

## Phase 3 — Test deserts (capped scope)

Priority order; each item is its own reviewable change set.

1. **`SettingsPage.tsx` (1647 lines, zero tests)** — first split its workflow
   slices (tabs/sections) into sibling components as behavior-preserving
   moves (AGENTS.md: split large UI files by workflow), then write focused
   component tests per slice.
2. **`LoyaltyPortal.tsx` (997 lines, zero tests)** — component tests covering
   main render sections, the redemption interaction, and loading/error
   states.
3. **`LoyaltyDashboard.tsx` (1501 lines, one member-view suite)** — extract
   pure helpers (tier/points math) with unit tests and extend the existing
   member-view suite for admin-facing surfaces. Full coverage deferred.
4. **Stretch**: rooms (2 test files today) and admin thin spots.

Out of scope: placeholder-barrel feature folders (night-audit, data-transfer,
rbac, audit-log, customer-ledger barrels export nothing testable); deeper
portal integration flows.

Conventions: TanStack Query providers mocked per existing suite patterns;
tests colocated `<Component>.test.tsx`; all three gates (`typecheck`, `lint`,
`test`) green independently before moving on.

## Phase 4 — any-type burn-down

112 hand-written non-test sites (generated `routeTree.gen.ts` excluded).
Directory-by-directory commits, heaviest first:

| Order | Directory | Sites |
|---|---|---|
| 1 | `features/rooms` | 18 |
| 2 | `features/admin` | 16 |
| 3 | `features/auth` | 14 |
| 4 | `features/bookings` | 11 |
| 5 | remainder (~9 dirs) | ~53 |

Rules: honest types only (no `as unknown as X` laundering); documented
intentional exceptions remain (`router/compat.tsx` casts are its contract with
TanStack generics; the one deliberate `user: any` in AuthContext stays
documented). Typing-only changes must not alter runtime behavior; where typing
surfaces validation/date/status logic, add or update tests per AGENTS.md.

Each commit independently passes `bun run typecheck && bun run lint && bun
run test`.

## Sequencing and tracking

Phases are strictly ordered (stability → docs → coverage → typing) but items
inside a phase are independent. Work lands as small commits; each phase ends
with its `docs/ongoing-dev.md` entry updated or deleted.
