# Adversarial verification — Frontend user/team/RBAC surface

Session: 2026-07-27. Verifying 6 findings from a prior auditor pass. Every citation
below was opened this session at the stated file:line; no auditor claim was taken
on faith.

## Finding-by-finding

### 1. rbac-surface-ungated-mutating-controls — CONFIRMED
- NightAuditPage.tsx: `grep hasPermission\|useAuth` → 0 hits (whole file). Button
  "Run Night Audit" at lines 813-821, `onClick`/`disabled` (loading, total_unposted)
  only, no permission check. Confirmed exact line 816 = onClick.
- data.sql:1061 (rbac), 1062 (night-audit), 1063 (payment-approvals), 1065
  (complimentary) — all four route rows verified byte-exact, including the OR'd
  jsonb permission arrays.
- routes/night_audit.rs: line 34/52/61/70 = `night_audit:read`, line 43 =
  `night_audit:execute` (run endpoint) — exact match.
- ProtectedRoute.tsx:44 `requiredPermissions.some(permission => hasPermission(...))`
  — confirms the route gate really is OR ("ANY"), matching the finding's framing.
- PaymentApprovalsPage.tsx: hasPermission exists (line 60) but only feeds
  `canViewConflicts` (line 82); Approve button onClick at line 323, Reject at 347,
  confirm-Reject at 430 — none gate on `payments:approve`. Backend: payments.rs:28
  `PAYMENTS_APPROVE = "payments:approve"`, used at lines 227, 237, 248 exactly as
  cited.
- ComplimentaryManagementPage.tsx: 0 hasPermission hits; delete/edit icons at
  lines 185-193 and 696-712 (cited 190, 709) unconditional. bookings.rs:
  `bookings:update` at lines 240, 255, 295, 310 (auditor cited 239/254/296/311 —
  each off by exactly one line; the requoted line is the function-signature/
  closing-paren line adjacent to the real check. Minor citation drift, not a
  wrong claim).
- RBACManagementPage.tsx (real path: `features/admin/components/rbac/
  RBACManagementPage.tsx`, not directly under `components/` as the citation
  implied — content claims still verified): 0 hasPermission/useAuth hits in 842
  lines; import block lines 1-42 read in full, confirmed no auth import. Line 579
  is the Delete-role IconButton, disabled only by `isBuiltin(selectedRole)`.
  UsersTab/UsersTab.tsx: 0 hasPermission hits; Delete-user icon at 325-332,
  Add-User button at 373-379, both unconditional — matches exactly.
- Contrast: DataTransferPage.tsx:300-306 is a whole-page early-return gate on
  `settings:manage` (not per-control `disabled=`, but still a correct write-tier
  gate — the auditor's phrasing groups it with SettingsPage's per-control pattern,
  which is a little imprecise but not wrong). SettingsPage.tsx:149-150 defines
  `isAdmin`; exact literal `disabled={!isAdmin}` count = 24, total `!isAdmin`
  mentions = 29 (auditor said "28" — off by a handful either way, negligible).
- Verdict: CONFIRMED. All four page/button claims individually re-derived and
  correct; only trivial (±1 line, small count) citation noise, no substantive error.

### 2. rbac-dead-parallel-roles-permissions-ui — CONFIRMED
- rbac/index.ts lines 15 (`export * from './PermissionsTab'`) and 18
  (`export * from './RolesTab'`) verified exact.
- `grep -rln "RolesTab|PermissionsTab" hotel-web-fe/src` → only the barrel's own
  index.ts + the two folders' own internal files (RolesTab.tsx, RolesTab/index.ts,
  PermissionsTab.tsx, PermissionsTab/index.ts). No external file references either
  name.
- routeRegistry.tsx:63 imports `../features/admin/components/rbac/
  RBACManagementPage` directly (not via the barrel) — exact match.
- wc -l across the 12 files (10 named components + 2 index.ts) = 1859, not the
  claimed 1877 (≈1% low; likely a minor counting variance, does not affect the
  dead-code conclusion).
- admin.service.ts:52-60 `updateRouteAccessPolicy` — grep shows only the
  definition and admin.service.test.ts as referrers; 0 other callers.
- Verdict: CONFIRMED, with a minor (~1%) line-count discrepancy noted.

### 3. rbac-authcontext-user-not-refreshed-on-profile-edit — CONFIRMED
- useProfileQueries.ts:28-36 `useUpdateProfileMutation` onSuccess body is exactly
  `queryClient.setQueryData(queryKeys.profile.me(), profile)` — no AuthContext
  interaction, verbatim match.
- AuthContext.tsx:33-44 `AuthContextType` interface — verified exact member list
  (login/register/logout/hasPermission/hasRole/getRoutePolicy/registerPasskey/
  loginWithPasskey/dismissPasskeyPrompt/checkPasskeys); no updateUser/setUser.
- All 9 cited `setAuthState` call sites verified at the EXACT lines given (100,
  113, 134, 148, 178, 266, 284, 329, 573) via `grep -n setAuthState`; read the
  surrounding context of each — they belong to resetAuthState, mount-time
  initializeAuth, the `auth:tokens-refreshed` listener, `login()`, the post-login
  passkey-prompt callback, `dismissPasskeyPrompt()`, and a second login-shaped
  flow (~line 573) — none fire from a profile-edit mutation.
- api/client.ts:90-114 `refreshAccessToken` — confirmed it only sets the access
  token and dispatches `auth:tokens-refreshed` (consumed only by the line-178
  handler, which touches `accessToken` alone) — never re-fetches the profile.
- NavigationTabs.tsx:81-83 `getUserInitials` reads `user.full_name.split(' ')`
  from `useAuth()` (import confirmed line 25, destructure line 48) — exact match.
- Verdict: CONFIRMED, no discrepancies found — every citation checked out exactly.

### 4. rbac-audit-log-not-invalidated-on-role-user-change — CONFIRMED
- useRBACQueries.ts:21-23 `invalidateRbacQueries` body verified verbatim (only
  invalidates `rbacQueryKeys.all`).
- All 11 call sites of `invalidateRbacQueries(` found via grep: 79, 89, 98, 108,
  117, 129, 141, 151, 161, 170, 182 — matches the auditor's list (129-130,
  171→170, 182-183 are the same statements with a 1-line spread/off-by-one on the
  closing brace; substance identical).
- queryInvalidation.ts: all 6 dependency-invalidation helpers
  (Booking/Guest/Room/NightAudit/PaymentApproval/ImportedData) call
  `invalidate(queryClient, queryKeys.audit.all)` at EXACTLY lines 13, 24, 36, 46,
  57, 70 as cited — perfect match. No `invalidateRbacDependencies` function
  exists (only 6 exported functions total in the file, confirmed via
  `grep "^export function"`).
- Backend: `services/rbac.rs:8` and `services/users.rs:16` both
  `use crate::services::audit::AuditLog;` — exact line match, confirming role/user
  mutations do write audit rows server-side.
- Verdict: CONFIRMED — this is the most precisely-cited finding in the batch;
  every line number matched on the first read.

### 5. rbac-audit-log-page-browser-local-timestamps — CONFIRMED
- AuditLogPage.tsx:118-149 — `fmtTime` (118-121), `fmtDate` (122-125),
  `toLocalInput` (142-143), `shortStamp` (145-149) all confirmed to use
  `new Date(iso)` + raw `.getHours()/.getDate()/.getMonth()` (browser-local).
  (fmtDay at 126-137 does the same but wasn't separately named — harmless.)
- Baseline line 1181 (`audit_logs_default.created_at timestamp with time zone
  DEFAULT CURRENT_TIMESTAMP ...`) confirmed verbatim — an instant type.
- utils/date.ts:109 `formatHotelDate`, :122 `formatHotelDateTime` confirmed exact;
  `formatHotelDateTime` (line 139) does
  `parsed.toLocaleString(undefined, { timeZone: getHotelTimeZone() })` for zoned
  instants — the exact convention AuditLogPage.tsx bypasses.
- Verdict: CONFIRMED, no discrepancies.

### 6. rbac-dead-single-item-mutation-methods — CONFIRMED
- admin.service.ts: `assignPermissionToRole` 112-114, `removePermissionFromRole`
  116-118, `getRolePermissions` 124-126, `updateRouteAccessPolicy` 52-60,
  `replaceRolePermissions` 120-122 — all confirmed exact via direct Read.
- users.service.ts: `assignRoleToUser` line 86, `removeRoleFromUser` line 90,
  `replaceUserRoles` line 94 — confirmed exact.
- Grepped every one of the 6 "dead" names repo-wide: each has exactly 2 hits —
  its own definition and its own unit-test file (admin.service.test.ts /
  users.service.test.ts) — 0 production callers. `replaceRolePermissions` /
  `replaceUserRoles` are additionally confirmed live-called from
  useRBACQueries.ts.
- Verdict: CONFIRMED, no discrepancies.

## Additional issues found (not reported by the original auditor)

1. **RBACManagementPage.tsx "built-in role" protection is a fragile client-side
   name regex, not the backend's actual `is_system_role` flag — and the roles API
   never even exposes that flag.**
   - `RBACManagementPage.tsx:101-102`:
     `const BUILTIN = /(super\s*admin|administrator|^admin$|manager|receptionist|
     front desk|housekeeping|guest|staff)/i;` / `const isBuiltin = (r: Role) =>
     BUILTIN.test(r.name.trim());`, consumed at line 579 to disable the Delete
     button.
   - `types/rbac.types.ts:4-9` — the FE `Role` interface has only
     `{id, name, description, created_at}` — no `is_system_role` field at all.
   - `hotel-app-be/src/models/rbac.rs:9-16` — the backend's own `Role` struct
     (Serialize'd straight to JSON for the roles-list endpoint) ALSO has no
     `is_system_role` field — so the API genuinely never surfaces it.
   - `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql:4189` —
     `is_system_role boolean DEFAULT false` exists as a real column, but only
     reached server-side via a separate call
     (`services/rbac.rs:219 RbacRepository::role_system_status`) at delete/update
     time, never through the list response.
   - Failure modes: (a) a legitimate custom role literally named "Guest Services
     Manager", "Front Desk Lead", or "Support Staff" gets its Delete button
     disabled in the UI (false positive — the regex has no word boundaries except
     on "admin") even though the backend would happily delete it. (b) a genuine
     system role whose name doesn't match the list (e.g., renamed by a future
     migration, or something outside the 9 hardcoded words) shows as deletable
     client-side; clicking Delete round-trips to the server only to get rejected
     with "Cannot delete system roles" (`services/rbac.rs:222-224`).
   - Severity: medium — a real, reproducible UX/correctness defect (not a security
     hole, since the backend re-validates), same class as finding 1 but a
     different mechanism (name heuristic vs missing permission check) and a
     different root cause (API never exposes the field it needs).

2. **The permission catalog (as opposed to route policies) has ZERO live UI path
   to create, update, or delete a permission — a more severe version of what
   finding `rbac-dead-parallel-roles-permissions-ui` already flagged for route
   policies.**
   - `useRBACQueries.ts:146,155,165` define `useCreatePermission`,
     `useUpdatePermission`, `useDeletePermission`.
   - Grep for each name repo-wide: `useUpdatePermission` and `useDeletePermission`
     have **zero** callers anywhere, including inside the already-dead
     `PermissionsTab.tsx` — they are entirely unreachable code.
     `useCreatePermission`'s only caller is `PermissionsTab.tsx:61`, which is
     itself dead (finding 2, confirmed above).
   - The live page, `RBACManagementPage.tsx`, imports only
     `useCreateRole/useDeleteRole/useReplaceRolePermissions/useUpdateRole` (lines
     36-39) — it reads permissions (`permCode` at line 115, list rendering at
     637/689) but never calls any permission-mutation hook.
   - `AdminService.createPermission/updatePermission/deletePermission`
     (admin.service.ts:94,101,108) are correspondingly only reachable from the
     dead hook layer + their own test file.
   - Impact: today, creating a new permission, renaming one, or deleting one is
     impossible from any live page — an admin must write directly to the
     database/`data.sql`. This compounds the existing route-access-policy gap
     into "the entire permission-catalog admin surface is unreachable," which is
     a stronger and more concrete framing of the "dead code" finding's impact
     than what was reported.
   - Severity: medium-high (functional gap, not a security bug).

3. **AuditLogPage's date-range filter sends naive browser-local timestamps that
   the backend reinterprets in the HOTEL's timezone — silently wrong query
   results, not just a display bug (goes beyond the `rbac-audit-log-page-
   browser-local-timestamps` finding, which only covered the RENDER side).**
   - `AuditLogPage.tsx:142-143` `toLocalInput` builds a string like
     `2026-07-27T14:30` from browser-local `Date` getters (no offset/zone
     marker), used for the quick-filter buttons (lines 385, 389) and the custom
     range picker (`applyRange` at line 378, invoked at line 563 with
     `draftStart`/`draftEnd`).
   - `AuditLogPage.tsx:309-310` puts `query.start_date`/`query.end_date` (that
     same naive string) straight into the query object with no conversion.
   - `api/audit.service.ts:23-24` (and 47-48, 103-104) forward them verbatim:
     `searchParams.set('start_date', params.start_date)` — no client-side
     timezone normalization anywhere in the chain.
   - `hotel-app-be/src/models/audit.rs:16-17` — `AuditLogQuery.start_date` /
     `end_date` are typed `Option<String>`, not a zoned type.
   - `hotel-app-be/src/repositories/audit.rs:315,319` (and 359,363) build
     `"a.created_at >= ${}::timestamptz"` / `"a.created_at <= ${}::timestamptz"`
     and bind the raw string directly.
   - Per CLAUDE.md (`core/db.rs`): "each connection receives the timezone from
     `system_settings.timezone`" — so casting a zone-less literal to
     `timestamptz` resolves it using the HOTEL's configured session timezone, not
     the browser's. A naive string built from browser-local digits therefore gets
     silently reinterpreted as hotel-local digits. Whenever an admin's browser
     timezone differs from the hotel's configured timezone, "today" / "last
     hour" / any custom range is shifted by the zone offset — the query returns
     the wrong window of audit rows, with no error or indication anything is off.
   - Severity: medium-high — this is a data-correctness bug (wrong result set),
     not merely a wrong label, in exactly the audit-trail feature whose entire
     purpose is reconstructing "when did X happen." It shares the browser-local
     root cause with the already-reported display finding but is a materially
     more serious and previously unflagged consequence.

## Commands run (for reproducibility)
- Repeated `grep -n`, `grep -rn`, `grep -rln`, `wc -l`, `sed -n` against the
  exact paths named above; all zsh-glob-free (no bare `*.ext` patterns, per repo
  lesson 2026-07-26o).
- No files modified outside this report.
