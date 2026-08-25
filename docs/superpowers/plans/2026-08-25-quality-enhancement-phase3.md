# Quality Enhancement — Phase 3 (Test Deserts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the two largest frontend test deserts — `LoyaltyPortal.tsx` (997L, 0 tests), `LoyaltyDashboard.tsx` (1501L, skipped suite), `SettingsPage.tsx` (1647L, 0 tests) — extracting pure logic and the heaviest settings slices along the way, changing no runtime behavior.

**Architecture:** Follow the repo's Style-A mocking precedent (`HousekeepingPage.test.tsx`: mock the hooks/auth modules, bare `render`, no providers). Extract LoyaltyDashboard's pure tier/redeem math into `features/loyalty/utils.ts` first (unit-testable), fix the WIP member suite, then portal suites per tab, then split SettingsPage's three heaviest cards into siblings and test each slice plus a page-level suite.

**Tech Stack:** Vitest + Testing Library; MUI v9 (per-file `matchMedia` stub where `useMediaQuery` is hit); no new dependencies.

## Global Constraints

Spec: `docs/superpowers/specs/2026-08-25-quality-enhancement-design.md`.
- Behavior-preserving: same rendered text, same API/service calls, same payload shapes.
- No global vitest setup exists (`setupFiles: []`) — stub `matchMedia` per file when needed.
- All three gates green independently before each commit: `bun run typecheck && bun run lint && bun run test`.
- Out of scope (spec): placeholder-barrel features; rooms/admin thin spots stay deferred in the tracker.

---

### Task 1: Extract LoyaltyDashboard pure helpers → `features/loyalty/utils.ts`

**Files:**
- Create: `hotel-web-fe/src/features/loyalty/utils.ts`
- Modify: `hotel-web-fe/src/features/loyalty/components/LoyaltyDashboard.tsx` (import instead of define)
- Create: `hotel-web-fe/src/features/loyalty/utils.test.ts`

**Interfaces:**
- Produces (moved verbatim from LoyaltyDashboard.tsx): `TIER_CONFIG`, `getTierConfig(tierLevel)`, `getTierProgress(points)` (tier minimums 0/1000/5000/10000, clamped %), `canRedeem(reward, membership)` (points AND tier check), `formatCategoryLabel(category)` (title-cases `dining_discount` → `Dining Discount`), `formatNumber(n)`, types `UserLoyaltyMembership`.

- [ ] **Step 1: Write failing unit tests** for progress clamping at exact boundaries (999→below 100%, 1000→Bronze edge), `canRedeem` points/tier matrix, label title-casing.
- [ ] **Step 2:** Move implementations from LoyaltyDashboard.tsx L371–404/L751/L1075/L1086–1088 into utils.ts; re-import in the component; delete originals.
- [ ] **Step 3:** `bun run test src/features/loyalty/utils.test.ts --run` ⇒ PASS (component suite still green).
- [ ] **Step 4:** Gates + commit `refactor(loyalty): extract tier/redeem helpers for testability`

### Task 2: Make the skipped LoyaltyDashboard member suite real

**Files:**
- Modify: `hotel-web-fe/src/features/loyalty/components/LoyaltyDashboard.member.test.tsx`

The suite is `describe.skip` because "the component still renders empty under jsdom" — root cause per map: data loads in `loadLoyaltyData()` (L179–252) via mocked barrel services; assertions raced the async effect. Keep the existing hoisted-mock pattern; gate renders on `findBy*`; assert the eKYC-approved path renders tier card ("Silver Member"), catalog tri-state buttons ('Tier Locked' / 'Insufficient Points' / 'Redeem Now'), redeem dialog flow ('Confirm Reward Redemption' → 'Confirm Redemption' calls `redeemReward`), success banner, and the eKYC-required branch ("eKYC Verification Required").

- [ ] Steps: drop `.skip`; run; fix mock wiring until green (expected fixes: `getEkycStatus` resolves `{ status: 'approved' }` shape matching component read; `membership` factory fields match `UserLoyaltyMembership`); keep timeouts default now that waits are deterministic.
- [ ] Gates + commit `test(loyalty): land member-view dashboard suites`

### Task 3: Admin-view dashboard suites (new file)

**Files:**
- Create: `hotel-web-fe/src/features/loyalty/components/LoyaltyDashboard.admin.test.tsx`

Same hoisted-mock registry pattern; `permissions = new Set(['loyalty:manage'])`. Cover: admin header "Rewards Management" + rewards table rows; "Create Reward" opens 'Create Reward' dialog; Edit prefills; Delete confirmation calls delete; non-admin sees member view instead (permission flip).

- [ ] Steps: write tests → red where behavior misunderstood → adjust only mocks → green → gates → commit `test(loyalty): cover admin rewards-management surface`

### Task 4: LoyaltyPortal suites per tab

**Files:**
- Create: `hotel-web-fe/src/features/loyalty/components/LoyaltyPortal.test.tsx`

Mocks: `../hooks/useLoyaltyAdmin` (all 11 hooks return `{data, isLoading:false, error:null, mutateAsync}` shaped per usage) + `../hooks/useLoyaltySocket` (`() => ({ connected: true })`). No auth/provider needed.

Cover: shell tabs switch content (Overview/Members/Rewards/Redemptions/Rules accessible names); Overview stat values; Members empty-state text vs row rendering + row click opens "Member details"; gift-form validation messages ('Enter a positive number of points', 'Reason must be at least 5 characters'); valid gift calls `giftPoints.mutateAsync`; Redemptions pending rows expose Approve/Reject and reject dialog requires Reason; Rules "Save rules" calls `updateRules.mutateAsync` and shows "Rules saved"; loading state renders spinner when `isLoading:true`; error Alert path.

- [ ] Steps: write → run → fix mocks to actual hook shapes (read `hooks/useLoyaltyAdmin.ts` signatures first) → green → gates → commit `test(loyalty): cover portal tabs end-to-end`

### Task 5: SettingsPage — extract three heaviest cards + slice tests + page suite

**Files:**
- Create: `hotel-web-fe/src/features/user/components/settings/{ReportSettingsCard,SupportWorkflowCard,SystemConfigurationCard}.tsx`
- Modify: `hotel-web-fe/src/features/user/components/SettingsPage.tsx` (render extracted cards, thread existing state as props)
- Create: `settings/ReportSettingsCard.test.tsx`, `settings/SupportWorkflowCard.test.tsx`, `settings/SystemConfigurationCard.test.tsx`, `SettingsPage.test.tsx`

Split rules: move the card's JSX + section-local constants verbatim; props are exactly the state values/setters the section used (no renames, no reshaping); `TIMEZONES`, `SUPPORT_*` constants move with their card. Page keeps ownership of all state, `applySettingsToForm`, `saveSettings`.

Slice tests (pure prop-driven render): report preset select applies preset to font-size inputs; support priority minutes enforce ≥1; system-config "Rate Codes" add dedupes/uppercases via `addCode`. Page suite (Style A: mock `../hooks/useSettingsQueries`, `../../../auth/AuthContext`, `../../../router/ThemeModeContext`, keep `useCurrency`/hotelSettings real): loading spinner gate; admin vs non-admin field disabling; edit hotel name → Save calls `saveMutation.mutateAsync` with payload containing edited value; error Alert surfaces mutation failure.

- [ ] Steps: extract card 1 → gates → card 2 → gates → card 3 → gates → slice tests → page suite → gates → commits per card + one test commit (`refactor(user): split settings workflow cards`, `test(user): cover settings slices and page contract`)
- [ ] Update `docs/ongoing-dev.md`: rewrite FE-deserts bullet (loyalty/user deserts closed; note rooms/admin thin spots + remaining SettingsPage cards as future splits).

### Task 6: Full-suite stability

- [ ] `bun run test` full parallel run green; `bun run typecheck && bun run lint` clean.
