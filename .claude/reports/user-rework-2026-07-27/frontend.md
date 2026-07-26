# Frontend Audit — User / Team / RBAC Surface

Session date: 2026-07-27. Scope: `hotel-web-fe/src/features/rbac/`,
`features/user/`, `features/audit-log/`, `features/admin/`,
`api/users.service.ts`, `api/admin.service.ts`, `api/audit.service.ts`,
`auth/AuthContext.tsx`, `navigation/routeRegistry.tsx`.

All line numbers below were read directly this session (Read/Grep) — none are
carried over from memory or from other reports.

---

## 1. Where user/staff management actually renders

`features/rbac/` (api.ts, types.ts, constants.ts, index.ts) and
`features/audit-log/` (api.ts, types.ts, constants.ts, index.ts) are **entirely
placeholder stubs** — every file in both directories contains only `export {};`
(verified: `features/rbac/api.ts:1`, `features/rbac/types.ts:1`,
`features/rbac/constants.ts:1`, `features/rbac/index.ts:1`,
`features/audit-log/api.ts:1-3`, `features/audit-log/index.ts:1-4`).
`grep -rn "from '.*features/rbac'"` and `grep -rn "from '.*features/audit-log'"`
across `hotel-web-fe/src` both return **zero hits** — nothing imports either
barrel anywhere.

The real pages are wired directly from `navigation/routeRegistry.tsx` by file
path, bypassing those stub barrels entirely:

| Route id | Path | Component import (routeRegistry.tsx) | Real file |
|---|---|---|---|
| `profile` | `/profile` | line 60 | `features/user/components/UserProfilePage.tsx` |
| `settings` | `/settings` | line 61 | `features/user/components/SettingsPage.tsx` |
| `help` | `/help` | line 62 | `features/user/components/HelpSupportPage.tsx` |
| `rbac` | `/rbac` | line 63 | `features/admin/components/rbac/RBACManagementPage.tsx` |
| `audit-log` | `/audit-log` | line 82 | `features/admin/components/AuditLogPage.tsx` |
| `night-audit` | `/night-audit` | line 83 | `features/admin/components/NightAuditPage.tsx` |

Route table entries confirmed at `navigation/routeRegistry.tsx:221-329` (profile,
help, rbac, night-audit, payment-approvals, audit-log, complimentary) plus
`:379-389` (data-transfer). All are `visibility: 'auth'`, `accessControlled: true`.

`features/audit-log/index.ts:2-3` literally documents the intended state: *"During
incremental migration, components are re-exported from admin feature... Once
extracted, they will live here."* That extraction never happened; the stub
directories are migration scaffolding nobody finished or deleted.

### Full file tree read this session (scope directories)

```
features/rbac/                              api.ts, types.ts, constants.ts, index.ts   — all 1 line, `export {};`
features/audit-log/                         api.ts (2), types.ts (1), constants.ts (1), index.ts (4) — all stubs
features/user/
  index.ts (4)                              barrel — exports AccountDeactivation, SettingsPage, UserProfilePage
  components/
    UserProfilePage.tsx (224)
    SettingsPage.tsx (1571)                 *** >400 ***
    HelpSupportPage.tsx (224)
    AccountDeactivation.tsx (222)            — DEAD, see Finding F7
    profile/
      ProfileTab.tsx (295)
      SecurityTab.tsx (147)
      PasskeysTab.tsx (265)
      DevicesTab.tsx (72)
      TabPanel.tsx (24)
      deviceIcons.tsx (160)
  hooks/
    useSettingsQueries.ts (299)
    useProfileQueries.ts (81)
features/admin/
  index.ts (2)
  utils/
    dataTransferDependencies.ts (460)        *** >400 ***
    dataTransferDependencies.test.ts (255)
    paymentReceiptPdf.ts (53)
  hooks/ useNightAuditQueries.ts, usePaymentApprovalsQueries(.test).ts, useLedgers(.test).ts, useDataTransferQueries.ts, useAuditQueries.ts (all <300)
  components/
    PaymentApprovalsPage.tsx (457)           *** >400 ***
    NightAuditPage.tsx (1386)                *** >400 ***
    ComplimentaryManagementPage.tsx (1003)   *** >400 ***
    DataTransferPage.tsx (1380)              *** >400 ***
    AuditLogPage.tsx (763)                   *** >400 ***
    rbac/
      RBACManagementPage.tsx (842)           *** >400 ***  <- THE real RBAC page
      types.ts (63), constants.ts (37), index.ts (18) — barrel, dead (see F2)
      hooks/ useRBACData.ts (250), useRBACQueries.ts (185)  — alive
      UsersTab/ UsersTab.tsx (543)           *** >400 ***  — alive, used by RBACManagementPage.tsx:41
      RolesTab/  RolesTab.tsx(257) RoleCard.tsx(161) RoleEditDrawer.tsx(272)
                 PermissionSummarySection.tsx(191) NavigationAccessSection.tsx(185) index.ts(5)
                 — ALL DEAD, see Finding F2
      PermissionsTab/ PermissionsTab.tsx(298) PermissionCategoryAccordion.tsx(175)
                 PermissionRow.tsx(146) AddRolePopover.tsx(113) RoleChip.tsx(51) index.ts(5)
                 — ALL DEAD, see Finding F2
    CustomerLedger/ ...                      — different domain (company ledger), not part of this audit's dimension;
                                               CustomerLedgerPage.tsx (2268 lines, largest file in features/admin/) noted
                                               for completeness of the ">400 lines" inventory only.
auth/
  AuthContext.tsx (657)                      *** >400 ***
  AuthContext.test.tsx (245)
  authUser.ts (35), authUser.test.ts (33)
  tokenStore.ts (27)
navigation/
  routeRegistry.tsx (443)                    *** >400 ***
  lazyRoute.ts (62)
api/
  users.service.ts (97)
  admin.service.ts (148)
  audit.service.ts (179)
  queryKeys.ts (218)
  queryInvalidation.ts (76)
```

---

## 2. UserProfilePage.tsx — decomposition status

**224 lines today** (`features/user/components/UserProfilePage.tsx:1-225`, full file
read). This directly contradicts the premise that it might still be a 1051-line
monolith — it is **already decomposed and every subcomponent is genuinely wired
in**, not leftover:

- `ProfileTab` — imported line 27, rendered line 190-196 (tab index 0)
- `SecurityTab` — imported line 28, rendered line 200 (tab index 1)
- `PasskeysTab` (+ `MAX_PASSKEYS`) — imported line 29, rendered line 204-210 (tab index 2)
- `TwoFactorSetup` (from `features/auth/components`, not `features/user/profile`) — rendered line 214 (tab index 3)
- `DevicesTab` — imported line 30, rendered line 218 (tab index 4)
- `TabPanel` — imported line 26, wraps all five tabs

No finding here — this part of the migration is clean.

---

## 3. Permission gating

### 3.1 How AuthContext exposes permission checks

`auth/AuthContext.tsx`:
- `hasPermission` (lines 348-364): checks the normalized permission string against
  a `Set` built from `authState.permissions`; if not found, falls back to
  `<resource>:manage` (lines 355-360) — correctly mirrors the backend's
  "`<resource>:manage` implies all actions" rule from CLAUDE.md.
- `hasRole` (366-369), `getRoutePolicy` (371-374) — straightforward Set/Map lookups.
- Permissions/roles/route policies are loaded **once**, at `AuthProvider` mount
  (lines 106-150, via `AuthService.getAccessSnapshot()` at line 123) and on
  login (`finishResponse` destructuring at line 554-576). They are **not**
  re-fetched by the silent token-refresh path: `refreshAccessToken()`
  (`api/client.ts:90-114`) only re-mints the JWT and dispatches
  `auth:tokens-refreshed`; it never calls `getAccessSnapshot()` again. See
  Finding F3/F4 for the practical consequence.

`ProtectedRoute` (`features/auth/components/ProtectedRoute.tsx:12-63`) is the
route-level gate: it reads `getRoutePolicy(routeId)` and requires **any one** of
`required_permissions` (line 43-44) or `required_roles` (45) to match — this is
OR semantics across the whole permission list for a route, which is the root
cause of Finding F1 below.

### 3.2 Finding F1 (HIGH) — Route policies are OR'd across read+write permissions, but no page re-checks the specific mutating permission before rendering destructive controls

Every route below grants entry on **any** of a mixed read/write permission list
(seeded in `hotel-app-be/database/postgres/data.sql`), but the page component
renders its destructive/mutating buttons unconditionally — with **zero**
`hasPermission` calls anywhere in the file — so a user holding only the
*read*-tier permission reaches the page and sees fully-enabled controls that
will 403 on the backend. Verified end-to-end (FE file + route policy + BE
permission requirement) for four separate instances:

| Page | Route policy (data.sql) | Unguarded control (file:line) | Backend actually requires |
|---|---|---|---|
| `NightAuditPage.tsx` | `night-audit` → ANY of `["night_audit:read","night_audit:execute"]` (data.sql:1062) | "Run Night Audit" button, `NightAuditPage.tsx:816-820`; zero `hasPermission` in file (`grep -c hasPermission` = 0) | `night_audit:execute` specifically (`hotel-app-be/src/routes/night_audit.rs:43`), distinct from `night_audit:read` used by the read endpoints (lines 34,52,61,70) |
| `PaymentApprovalsPage.tsx` | `payment-approvals` → ANY of `["payments:approve","payments:read"]` (data.sql:1063) | Approve button `PaymentApprovalsPage.tsx:323`, Reject open `:347`, Reject confirm `:430` — none check `hasPermission('payments:approve')`; the file's only `hasPermission` call (line 82) gates an unrelated conflict-events banner | `payments:approve` specifically (`hotel-app-be/src/routes/payments.rs:227,237,248`), distinct from `payments:read` used elsewhere (lines 80,98,116,125,154,171,200,209,218) |
| `ComplimentaryManagementPage.tsx` | `complimentary` → ANY of `["bookings:read","bookings:update"]` (data.sql:1065) | Delete credit `:190`, delete booking/void `:709`; zero `hasPermission` calls in file | `bookings:update` specifically for mutations (`hotel-app-be/src/routes/bookings.rs:239,254,296,311`), vs `bookings:read` for the two GET endpoints (lines 273,282) |
| `RBACManagementPage.tsx` + `UsersTab.tsx` | `rbac` → ANY of `["roles:read","roles:manage","permissions:manage","users:read","users:manage"]` (data.sql:1061) | Delete Role `RBACManagementPage.tsx:579`, Save role permissions `:266-278`; Create User `UsersTab.tsx:373-379`, Delete User `:325-332`. `RBACManagementPage.tsx` imports no `useAuth`/`hasPermission` at all (full import block read, lines 1-42) | `users:delete`/`users:manage` and `users:create`/`users:manage` (`hotel-app-be/src/routes/users.rs:21-25`); role/permission mutations gated similarly in `routes/rbac.rs:24` |

**Contrast — the fix pattern already exists in the same codebase area**, proving
this is an inconsistency, not a hard problem: `DataTransferPage.tsx:300-306`
does `if (!hasPermission('settings:manage')) return <Alert.../>` before
rendering ANY import/export control, and `SettingsPage.tsx:149-150` computes
`isAdmin = hasPermission("settings:update") || hasPermission("settings:manage")`
then disables every editable field with `disabled={!isAdmin}` (28 call sites,
e.g. lines 501,512,522,532,636,662,834...1400) while the `settings` route policy
itself only requires `settings:read` (data.sql:1060) — exactly the
read-vs-write split that the four broken pages above fail to make.

This is UX, not a security hole (the backend enforces the real permission), but
it is exactly the "ungated button that 403s" defect class the audit brief
calls out, reproduced four times.

### 3.3 Minor — no client-side self-protection on user deletion

`UsersTab.tsx` has no check comparing the row being deleted to the
currently-logged-in user (`grep -n "self\|currentUserId\|authState.user"` → no
hits). Not a real risk: the backend explicitly rejects it —
`hotel-app-be/src/services/users.rs:172-176`: `if admin_user_id == user_id {
return Err(ApiError::BadRequest("Cannot delete your own user account"...))}`.
Nit-level: the Delete button for the admin's own row could be disabled
client-side with a tooltip instead of round-tripping to get a clear error.

---

## 4. Duplication

- **Role/Permission types**: `types/rbac.types.ts` (105 lines, full file read) is
  the single canonical source (`Role`, `Permission`, `RoleInput`,
  `PermissionInput`, `RbacSnapshot`, `RouteAccessPolicy`, etc.).
  `features/rbac/types.ts` is an empty stub (§1) — **no divergent copy exists**
  there. `features/admin/components/rbac/types.ts` imports `Permission`/`Role`
  from the canonical `types/` (`types.ts:1`) and only adds
  UI-shape-only interfaces (`PermissionCategory`, `RoleWithStats`,
  `NavigationItem`, `RoleFormData`, etc.) — this is legitimate view-model
  layering, not duplication of the same concept.
- **Permission category display metadata**: `features/admin/components/rbac/constants.ts:2-17`
  defines `PERMISSION_CATEGORIES` (14 resources → displayName/icon/color) and is
  consumed by the *live* `useRBACData.ts:5,199-201`. `AuditLogPage.tsx:75-81`
  separately defines its own `CATEGORIES` (5 entries: rooms/guests/bookings/system/reports)
  — this is a **different concept** (coarse audit-event buckets for filtering
  the log, not per-resource RBAC permission grouping) and only superficially
  resembles the RBAC categories; not flagged as duplication.
- **Permission string literals cross-checked against backend** (within this
  dimension's files only — `bookings:*`, `rooms:*` etc. belong to other
  dimensions' pages and were not re-verified here):
  - `DataTransferPage.tsx:300` `'settings:manage'` — exists as a real granted
    permission, `hotel-app-be/database/postgres/data.sql:494`.
  - `SettingsPage.tsx:150` `"settings:update"`/`"settings:manage"` — both real
    (`data.sql:493-494`); backend route requires `settings:update` literally
    (`hotel-app-be/src/modules/settings/routes.rs:52`).
  - `PaymentApprovalsPage.tsx:82` `'payments:read'`/`'audit:read'` — both real
    and match backend literals exactly (`routes/payments.rs:18`,
    `routes/audit.rs:39` et al).
  - `ProtectedRoute.tsx:33` `'rooms:update'`/`'rooms:manage'` (hardcoded
    special case for the `online-inventory` route id, bypassing the generic
    policy path) — matches `hotel-app-be/src/routes/rooms.rs:107`
    (`rooms:update`). This hardcoded per-route-id branch inside an otherwise
    generic component is a code smell (a second, ad-hoc access-control path
    living outside the `route_access_policies` table) but is out of this
    dimension's page scope (`online-inventory` is a rooms-domain page); noted
    for the rooms-domain reviewer.
  - No mismatched/typo'd permission string was found in the files audited here.

---

## 5. API layer hygiene

- **No raw `fetch(`** anywhere in `api/`, `features/rbac/`, `features/user/`,
  `features/admin/`, `features/audit-log/`, or `auth/` (`grep -rn "fetch("` on
  those trees, excluding `queryFn`/`refetch`/`prefetch`, returned no matches).
  Everything goes through the `ky`-based `api` client.
- **No lint-banned date methods** (`grep -rn "toISOString()\.\(split\|slice\)"`
  across the same tree → zero matches).
- **Dead single-item RBAC/user mutation methods** — all superseded by bulk
  "replace" endpoints but never deleted (verified: grepped every caller of each
  name across the whole `src/` tree; only the definition file and its own unit
  test reference them):
  - `AdminService.assignPermissionToRole` — `api/admin.service.ts:112-114`
  - `AdminService.removePermissionFromRole` — `api/admin.service.ts:116-118`
  - `AdminService.getRolePermissions` — `api/admin.service.ts:124-126`
  - `AdminService.updateRouteAccessPolicy` — `api/admin.service.ts:52-60` (its only
    plausible consumer, `NavigationAccessSection.tsx`, is itself dead — see F2)
  - `UsersService.assignRoleToUser` — `api/users.service.ts:86-88` (exercised
    only by `api/users.service.test.ts:74-79`)
  - `UsersService.removeRoleFromUser` — `api/users.service.ts:90-92` (exercised
    only by `api/users.service.test.ts:84-89`)
  - Everything else in `admin.service.ts` (148 lines, full file read),
    `users.service.ts` (97 lines, full file read), and `audit.service.ts`
    (179 lines; every one of its 8 static methods has ≥1 real external caller,
    `exportCSV` included — it's called internally by `downloadCSV` at
    `audit.service.ts:118`) has live callers.

---

## 6. Query cache invalidation after role/user changes

`features/admin/components/rbac/hooks/useRBACQueries.ts` (185 lines, full file
read) defines one shared invalidator:

```
useRBACQueries.ts:21-23
function invalidateRbacQueries(queryClient) {
  void queryClient.invalidateQueries({ queryKey: rbacQueryKeys.all });
}
```

called from every mutation's `onSuccess` (`useCreateRole` 77-80,
`useUpdateRole` 86-90, `useDeleteRole` 96-99, `useReplaceRolePermissions`
105-109, `useCreateUser` 115-118, `useUpdateUser` 124-131, `useDeleteUser`
137-143, `useCreatePermission` 149-152, `useUpdatePermission` 158-162,
`useDeletePermission` 168-171, `useReplaceUserRoles` 177-184).

Two gaps, both verified:

**F4 (MEDIUM) — RBAC mutations never invalidate `queryKeys.audit.all`.**
`api/queryInvalidation.ts` (76 lines, full file read) defines
`invalidateBookingDependencies`, `invalidateGuestDependencies`,
`invalidateRoomDependencies`, `invalidateNightAuditDependencies`,
`invalidatePaymentApprovalDependencies`, `invalidateImportedData` — **every
one of them includes `queryKeys.audit.all`** (lines 13, 24, 36, 46, 57, 70).
There is no `invalidateRbacDependencies`, and `useRBACQueries.ts`'s own
invalidator never touches `queryKeys.audit.all`. Role/permission/user
mutations do write real audit rows server-side —
`hotel-app-be/src/services/rbac.rs:8` and `services/users.rs:16` both
`use crate::services::audit::AuditLog;` — so this is an inconsistency with
every other domain's invalidation convention, not a hypothetical: the Audit
Log page (`AuditLogPage.tsx`, `queryKeys.audit.*`) will show a stale list for
up to its query's staleTime after an admin changes a role or deletes a user,
even though the write actually happened and was audited.

**F3 (MEDIUM) — the signed-in user's own `AuthContext.user` never refreshes
after a profile edit, and this reaches user-visible chrome.**
`features/user/hooks/useProfileQueries.ts:28-36`:
```
export function useUpdateProfileMutation() {
  ...
  onSuccess: profile => { queryClient.setQueryData(queryKeys.profile.me(), profile); },
}
```
This only writes the new profile into the **TanStack Query cache**
(`queryKeys.profile.me()`, defined `api/queryKeys.ts:167`). `AuthContext`
(`auth/AuthContext.tsx`) keeps its own **separate** copy of the user
(`authState.user`, plain `useState`, lines 86-88) and exposes no
`updateUser`/`setUser` in `AuthContextType` (interface at lines 33-44) — grepped
`setAuthState` call sites (lines 100,113,134,148,178,266,284,329,573) and none
of them run in response to a profile-mutation success. The only place
`authState.user` gets refreshed from the server is the mount-time
`getAccessSnapshot()`/`getUserProfile()` call (lines 106-150), and the silent
token-refresh path (`api/client.ts:90-114`) does not call it either. Practical
effect, verified by tracing a real consumer:
`components/layout/NavigationTabs.tsx:81` reads `user.full_name.split(' ')`
straight from `useAuth()` for the header/avatar initials — so editing your
display name or email on the Profile tab updates the Profile tab itself
immediately, but the navigation header keeps showing the **old** name/email
until a full page reload re-runs `AuthProvider`'s init effect.

Also note: RBAC list queries use `RBAC_STALE_TIME_MS = queryStaleTime.long`
= 5 minutes (`useRBACQueries.ts:17`, `api/queryConfig.ts:7`) — acceptable
within the mutating admin's own session (immediate `invalidateRbacQueries` on
success), but a second concurrently-open admin session showing the RBAC page
will not see another admin's changes for up to 5 minutes without a manual
refetch. Documented for completeness, not scored as a separate finding.

---

## 7. localStorage / sensitive data

**Clean.** `auth/tokenStore.ts` (27 lines, full file read) holds the access
token in a **module-level variable only** — explicit comment at lines 1-13
states the XSS-exfiltration rationale, and `getAccessToken`/`setAccessToken`/
`clearAccessToken` never touch `localStorage`. The refresh token is an
`HttpOnly` cookie the JS never sees (per the same file's comment and
consistent with `.claude/rules/lessons.md`'s 2026-07-06 entry).

`utils/storage.ts` (133 lines, full file read) explicitly enumerates its keys
(`StorageKey` union, lines 8-17) with a code comment (lines 5-7) documenting
that `accessToken`/`refreshToken` are deliberately excluded. Only
`user`/`roles`/`permissions`/`routePolicies` (plus unrelated UI-state keys:
`themeMode`, `cmdRecents`, `notificationHistory`, `ekycAdminFilters`,
`dataTransferHistory`) are ever written — confirmed by grepping every
`storage.setItem(s)`/`localStorage.` call across this dimension's files
(`auth/AuthContext.tsx:127,254,561` and `features/admin/components/DataTransferPage.tsx:388`,
the latter unrelated to auth). The `user` object itself
(`auth/authUser.ts:3-10`, full file read) carries only
`id/username/email/full_name/user_type/guest_id/is_active` — no password
hash, no token, no credential material.

Storing `permissions`/`roles` in localStorage is standard for this
memory-token/cookie-refresh pattern (it only seeds UI state on next boot before
`getAccessSnapshot()` re-verifies) and does not itself grant access — the
backend re-checks every request — so this is not scored as a finding.

---

## Findings summary (ranked)

| id | severity | title |
|---|---|---|
| F1 | HIGH | Route-level OR-permission policies + zero component-level gating → 4 pages render destructive/mutating controls to read-only-permission users, who then 403 on click (NightAuditPage, PaymentApprovalsPage, ComplimentaryManagementPage, RBACManagementPage/UsersTab) |
| F2 | HIGH | Entire parallel Roles/Permissions tab implementation (~1877 lines, 12 files under `rbac/RolesTab/` + `rbac/PermissionsTab/`) is dead — never imported outside its own orphaned barrel; consequently there is no live UI path to edit route/navigation access policies at all (`AdminService.updateRouteAccessPolicy` has zero callers) |
| F3 | MEDIUM | `AuthContext.user` is never refreshed after a profile edit (only the TanStack Query cache is updated); the navigation header (`NavigationTabs.tsx:81`) shows the stale name until a full reload |
| F4 | MEDIUM | RBAC/user mutations never invalidate `queryKeys.audit.all`, unlike every other domain's `queryInvalidation.ts` helper — Audit Log page can show stale data after a role/user change that was in fact audited |
| F5 | MEDIUM | `AuditLogPage.tsx` reimplements ad-hoc browser-local date/time formatting (`fmtTime`/`fmtDate`/`toLocalInput`/`shortStamp`, lines 118-149) instead of the hotel-timezone-aware `utils/date.ts` helpers (`formatHotelDate`/`formatHotelDateTime`), so timestamps on a security-sensitive audit trail render in the viewer's browser timezone rather than the hotel's configured timezone |
| F6 | MEDIUM | 6 single-item RBAC/user API methods across `admin.service.ts`/`users.service.ts` are dead (superseded by bulk "replace" endpoints, never removed) — a security-domain maintenance/consistency risk |
| F7 | LOW | `features/rbac/` and `features/audit-log/` are 100%-stub placeholder directories (`export {};` only), zero importers anywhere — migration scaffolding never finished or cleaned up |
| F8 | LOW | `AccountDeactivation.tsx` (222 lines, full self-deactivate/reactivate UI) is dead code — exported only from an unimported barrel, no other renderer, and no matching backend endpoint exists at all |
| F9 | NIT | `UsersTab.tsx` lets an admin click Delete on their own user row with no client-side warning; backend correctly rejects it (`services/users.rs:172-176`) so impact is a confusing round-trip, not a real risk |

No blocker-severity (security hole or data/permission loss reachable today) was
found in this dimension — every path that could look like privilege escalation
resolves to the backend correctly rejecting it; the gaps found are FE
correctness/UX/maintainability issues consistent with the "FE gating is UX, not
security" framing in the task brief.
