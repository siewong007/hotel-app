# Frontend Code-Health + CI Scan — 2026-07-07

Scope: `hotel-web-fe/` static analysis + `.github/workflows/ci.yml`. Desktop/packaging
and auth-token-storage topics intentionally out of scope (covered in prior sessions).
Method: `wc -l`, `grep -rn` counts only. No install/build run.

## 1. Component monoliths

`find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn` (top, excludes generated):

| Lines | File |
|---|---|
| 2586 | `src/features/bookings/components/Bookings/BookingsPage.tsx` |
| 2265 | `src/features/admin/components/CustomerLedger/CustomerLedgerPage.tsx` |
| 2247 | `src/features/reports/components/ModernReportsPage.tsx` |
| 1998 | `src/features/invoices/components/CheckoutInvoiceModal.tsx` |
| 1968 | `src/features/bookings/components/EnhancedCheckInModal.tsx` |
| 1800 | `src/features/rooms/components/RoomManagement/RoomManagementPage.tsx` |
| 1687 | `src/features/guests/components/GuestConfigurationPage.tsx` |
| 1506 | `src/features/rooms/components/RoomConfigurationPage.tsx` |
| 1440 | `src/features/loyalty/components/LoyaltyDashboard.tsx` |
| 1363 | `src/features/admin/components/DataTransferPage.tsx` |

8 files exceed 1000 lines total (list above shows top 10, cut at 1000: 8 qualify,
`NightAuditPage.tsx` 1305 and `UnifiedBookingModal.tsx` 1247 also >1000, bringing the
true >1000-line count to 10+). These are the same files CLAUDE.md's Leak #1 already
flags for BookingsPage/CustomerLedgerPage — confirms the doc is accurate here.

**Finding:** BookingsPage.tsx (2586 lines) and CustomerLedgerPage.tsx (2265 lines) are
the two largest components in the app, each 2-5x the next tier. — Effort L, Risk med
(refactor risk on business-critical pages; do not attempt without existing test coverage,
which is currently zero for `bookings` and `customer-ledger` domains, see §2).

## 2. Test coverage reality

- Test files: 13 total (`find src -name "*.test.ts*" -o -name "*.spec.ts*"`).
- `it(`/`test(` occurrences across those files: 99.
- `package.json` scripts: `"test": "vitest run"` — confirmed vitest, not jest.
- Feature domains under `src/features/` with **zero** test files (11 of 17):
  `admin`(partial — has 1 test file `dataTransferDependencies.test.ts` but the 1363-line
  `DataTransferPage.tsx` itself is untested), `audit-log`, `auth`, `bookings`,
  `customer-ledger`, `dashboard`, `data-transfer`, `invoices`, `loyalty`, `night-audit`,
  `rbac`, `user`.
- Domains WITH tests: `ekyc`, `guestPortal`, `guests`, `reports` (utils only), `rooms`
  (utils only).

**Finding:** `bookings` and `customer-ledger` — the two largest, most business-critical
domains — have zero test files despite being flagged as high-change-risk in CLAUDE.md's
booking-workflow/ledger-workflow refs. — Effort M (start with the hooks:
`useBookingsPageState.ts`, `useBookingQueries.ts`), Risk high (silent regressions in
money/booking-state code, per judgment-rubrics.md rubric #1 criteria).

## 3. TODO/FIXME/HACK, eslint-disable, ts-ignore

- `grep -rniE "\btodo\b|\bfixme\b|\bhack\b" src --include=*.ts --include=*.tsx`: **0 matches.**
- `eslint-disable`: 1 match — `src/routeTree.gen.ts:1` (`/* eslint-disable */`, TanStack
  Router auto-generated file — expected/benign, not hand-written debt).
- `@ts-ignore` / `@ts-expect-error`: **0 matches.**

**Checked and CLEAN** — no TODO/FIXME/HACK backlog, no suppressed lint/type errors
anywhere in hand-written source. This is unusually clean for a codebase this size.

## 4. Type safety (`tsconfig.json` strict: false)

- `tsconfig.json`: `"strict": false"` but `"strictNullChecks": true"` is ALSO set
  explicitly — CLAUDE.md's "don't assume strict typing" is directionally right but
  incomplete; null-safety is already partially enforced.
- `: any` annotations: **330** occurrences (`grep -rn ": any\b" src`).
- `any[]` / `<any>` / `as any`: **207** additional occurrences.
- Top 5 `any`-density files:
  1. `src/types/dataTransfer.types.ts` — 51
  2. `src/features/reports/components/ModernReportsPage.tsx` — 30
  3. `src/features/bookings/components/Bookings/BookingsPage.tsx` — 22
  4. `src/features/bookings/hooks/useBookingsPageState.ts` — 16
  5. `src/features/admin/components/CustomerLedger/CustomerLedgerPage.tsx` — 15

**Finding:** enabling `noImplicitAny` incrementally is plausible — the `any` debt is
concentrated in 5 files (~134 of 330, ~40%) rather than diffuse; a per-file
`// @ts-nocheck`-free tighten pass on `dataTransfer.types.ts` alone would meaningfully
cut the count. Full `strict: true` flip is NOT incremental-feasible in one pass given
537 total any-adjacent sites. — Effort M (types file) / L (full strict flip), Risk low
(type-only change, compiler catches regressions).

## 5. State / data-fetching pattern

- **Zustand is NOT present**: `grep -i zustand package.json` → no match; `grep -rl
  zustand src` → no match. **CLAUDE.md's "Vite, MUI v7, Zustand" claim is stale** —
  there is no Zustand dependency or usage anywhere in the repo.
- Actual state mechanisms: React Context (3 providers — `src/auth/AuthContext.tsx`,
  `src/features/dashboard/components/reports/formatContext.tsx`,
  `src/router/ThemeModeContext.ts`) + component-local state + TanStack Query.
- Server cache: `@tanstack/react-query ^5.100.14` IS in `package.json` and is
  well-adopted — `useQuery`/`useMutation`/`QueryClient` appear in 34 files across nearly
  every feature domain (hooks named `use*Queries.ts` are the dominant pattern).
- `useEffect(` under `src/features/`: 73 occurrences, concentrated in
  `UnifiedBookingModal.tsx` (8), `PortalDashboardPage.tsx` (5) — not evidence of
  hand-rolled fetching at scale since react-query is already the primary fetch path;
  these are more likely UI-sync effects.

**Finding (doc bug, not code bug):** CLAUDE.md architecture section should be corrected
to remove "Zustand" and state that data fetching is TanStack Query + React Context, not
Zustand stores. — Effort S, Risk low. This is a `.claude/rules/maintenance.md`
"ask user first" edit since it's structural to CLAUDE.md.

## 6. Route / bundle hygiene

- Routing is **TanStack Router** (file-based, `src/routes/*.tsx` + generated
  `src/routeTree.gen.ts`, 58 `path:` entries), NOT manual `<Route>` + `React.lazy()`
  inside `App.tsx` as CLAUDE.md states. `src/App.tsx` is only 51 lines and contains no
  route list — it wires `QueryClientProvider` → `ThemeProvider` → `AuthProvider` →
  `RouterProvider`.
- Code-splitting is real but happens via a custom registry, not raw `React.lazy` calls
  in App.tsx: `src/navigation/routeRegistry.tsx` (347 lines) calls a `lazyRoute()`
  helper (`src/navigation/lazyRoute.ts:11`, wraps `React.lazy`) **32 times**, one per
  heavy page component. Route files under `src/routes/*.tsx` are thin wrappers
  (`createFileRoute` + `RouteById` lookup into the registry) — confirmed via
  `src/routes/bookings.tsx`.
- Heavy deps check: `jspdf`/`jspdf-autotable` — used only via **dynamic `import()`**
  inside `src/api/audit.service.ts:143-144` (not a static top-level import) — properly
  code-split. `recharts` — statically imported only in
  `src/features/reports/components/AnalyticsDashboard.tsx`, which is reached solely
  through the already-lazy `ModernReportsPage.tsx` (registry line 48) — also properly
  isolated. **Checked and CLEAN** — no heavy chart/pdf library leaks into the eager
  bundle.
- Caveat: `src/api/index.ts` (a barrel) is imported eagerly by `src/auth/AuthContext.tsx`,
  which loads at app start via `App.tsx:6`. This pulls in `audit.service.ts` (though its
  jspdf import stays dynamic) and other service modules at eager-load time — a
  barrel-file bundling risk worth a bundle-analyzer check, but not a confirmed problem
  from static grep alone.

**Finding (doc bug):** CLAUDE.md's "App.tsx: pages are React.lazy() inside Suspense +
ErrorBoundary — add new routes there" is **incorrect** — routing moved to TanStack
Router with a file-based `src/routes/` + `src/navigation/routeRegistry.tsx` pattern;
new routes are added by creating a `src/routes/<name>.tsx` file and registering the
component in `routeRegistry.tsx`, not by editing App.tsx. This is a live-instruction
correctness bug (an agent following CLAUDE.md literally would fail to find where to add
a route). — Effort S (doc fix), Risk **high** for the doc-drift itself (misdirects any
agent adding a route) even though the underlying code pattern is fine.

## 7. Vite proxy drift

- `vite.config.ts:17`: `PROXY_PREFIXES = ['/api', '/uploads', '/health', '/ws']`.
- Backend `create_router` (`hotel-app-be/src/routes/mod.rs:74-158`): all domain routers
  are `.merge()`d under a single `/api` nest (line 156: `.nest("/api", api_routes)`);
  root-level routes are `/health` (151), `/ws/status` (152), and `/uploads` static
  serve (154). No other top-level prefixes exist.
- **Checked and CLEAN — no drift.** Every backend-registered top-level prefix has a
  matching proxy entry; the proxy has no dead/extra entries either.

## 8. CI gaps (`.github/workflows/ci.yml`, 254 lines)

- No FE test-coverage threshold: `vitest.config.ts:12-23` defines a `coverage` block
  (v8 provider) but CI's `Test` step (line 37) runs `npm run test -- --run` with no
  `--coverage` flag and no threshold gate — coverage is configured but unenforced.
- No E2E/UI smoke test for the frontend: no Playwright/Cypress dependency in
  `package.json` (confirmed via grep, no match); backend has an HTTP smoke test
  (lines 193-215, curl `/health` only) but nothing exercises the FE build or an actual
  user flow.
- No bundle-size check: `Build` step (line 40) runs `vite build` and stops — no
  size-limit/budget assertion on the output.
- No dependency/security scan: no `npm audit`, `cargo audit`, or SAST step anywhere in
  the workflow.
- Lint gate is soft: CI runs `npm run lint` = `eslint . --quiet` (line 34), which
  suppresses warnings from output and — per ESLint's `--quiet` semantics — only fails
  the process on errors, not warnings; `lint:strict` (`--max-warnings=0`) exists in
  `package.json` but is never invoked in CI, so warning-level issues can accumulate
  silently forever.
- Desktop job (lines 217-254) is `cargo check` only with placeholder resources — already
  documented as a known gap in CLAUDE.md, out of scope here per task instructions.

## Checked and found CLEAN (explicit absence claims)

- TODO/FIXME/HACK: zero, case-insensitive, whole codebase.
- `@ts-ignore`/`@ts-expect-error`: zero.
- Vite proxy prefixes vs backend route prefixes: exact match, no drift.
- jspdf/recharts eager-bundle leakage: none found — both are properly dynamically
  imported or reached only through already-lazy routes.
- Route registration mechanism does exist and does code-split (32 lazy routes) —
  CLAUDE.md is wrong about the *mechanism* (App.tsx) but the *outcome* (code-split
  pages) is real and healthy.
