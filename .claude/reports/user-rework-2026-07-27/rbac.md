# RBAC Correctness Audit — 2026-07-27

Scope: roles, permissions, assignment, caching, escalation. Backend only
(`hotel-app-be/`). All line numbers were read this session; absence claims list
the exact command run.

Files read in full or by targeted offset/limit this session:
`src/core/auth.rs` (460-505), `src/core/middleware.rs` (1-153, full),
`src/core/rbac_cache.rs` (full, 164 lines), `src/core/config.rs` (grep),
`src/repositories/rbac.rs` (1-260, 260-460, 515-642), `src/services/rbac.rs`
(full, 368 lines), `src/handlers/rbac.rs` (full, 188 lines), `src/routes/rbac.rs`
(full, 230 lines), `src/routes/users.rs` (full, 127 lines), `src/services/users.rs`
(full, 273 lines), `src/handlers/users.rs` (full, 56 lines), `src/routes/profile.rs`
(full, 231 lines), `src/routes/audit.rs` (full, 92 lines), `src/routes/auth.rs`
(full, 154 lines), `src/routes/two_factor.rs` (full, 148 lines),
`src/routes/passkey.rs` (full, 126 lines), `src/models/rbac.rs` (1-75),
`src/models/user.rs` (148-192), `src/repositories/user.rs` (95-195),
`src/repositories/auth.rs` (230-277), `src/services/analytics.rs` (15-38),
`src/services/audit.rs` (28-160ish), `src/routes/mod.rs` (6-35, 203-240),
`src/modules/loyalty/routes.rs` (full, 234 lines), `database/postgres/data.sql`
(1-130, 380-530, 530-630, 900-1000, 1100-1225), `database/postgres/migrations/
0001_v1_baseline.sql` (permissions/roles table DDL via `awk`),
`database/postgres/upgrade/pg18_4_to_v1.sql` (grep only, not fully read).

---

## 1. Route → required-permission table

### `routes/users.rs` (merged at `routes/mod.rs:225`)

| Route | Method | Permission check | Const (file:line) |
|---|---|---|---|
| `/users` | GET | `users:read` OR `users:manage` | `USER_READ_PERMISSIONS` — users.rs:21 |
| `/users` | POST | `users:create` OR `users:manage` | `USER_CREATE_PERMISSIONS` — users.rs:22 |
| `/users/{id}` | GET | `users:read` OR `users:manage` | users.rs:21 |
| `/users/{id}` | PATCH | `users:update` OR `users:manage` | `USER_UPDATE_PERMISSIONS` — users.rs:23 |
| `/users/{id}` | DELETE | `users:delete` OR `users:manage` | `USER_DELETE_PERMISSIONS` — users.rs:24 |
| `/users/roles` | POST (assign) | `users:update` OR `users:manage` | `USER_ROLE_MANAGE_PERMISSIONS` — users.rs:25 |
| `/users/{id}/roles` | PUT (replace) | `users:update` OR `users:manage` | users.rs:25 |
| `/users/{id}/roles/{role_id}` | DELETE | `users:update` OR `users:manage` | users.rs:25 |

Every route has a permission check. None missing.

### `routes/rbac.rs` (merged at `routes/mod.rs:224`)

| Route | Method | Permission check | Const |
|---|---|---|---|
| `/rbac/snapshot` | GET | roles:read/manage, permissions:read/manage, users:read/manage | `RBAC_SNAPSHOT_PERMISSIONS` — rbac.rs:18-25 |
| `/rbac/route-policies` | GET | same as above | rbac.rs:18-25 |
| `/rbac/route-policies/{id}` | PUT | `permissions:manage` | `PERMISSION_MANAGE_PERMISSIONS` — rbac.rs:39 |
| `/rbac/roles` | GET | `roles:read`/`roles:manage` | `ROLE_READ_PERMISSIONS` — rbac.rs:26 |
| `/rbac/roles` | POST | `roles:create`/`roles:manage` | `ROLE_CREATE_PERMISSIONS` — rbac.rs:27 |
| `/rbac/roles/{id}` | PUT | `roles:update`/`roles:manage` | `ROLE_UPDATE_PERMISSIONS` — rbac.rs:28 |
| `/rbac/roles/{id}` | DELETE | `roles:delete`/`roles:manage` | `ROLE_DELETE_PERMISSIONS` — rbac.rs:29 |
| `/rbac/roles/{id}/permissions` | GET | `roles:read`/`roles:manage` | rbac.rs:26 |
| `/rbac/roles/{id}/permissions` | PUT (replace) | `permissions:manage` | rbac.rs:39 |
| `/rbac/permissions` | GET | permissions:read/manage, roles:read/manage | `PERMISSION_READ_PERMISSIONS` — rbac.rs:30-35 |
| `/rbac/permissions` | POST | `permissions:create`/`permissions:manage` | `PERMISSION_CREATE_PERMISSIONS` — rbac.rs:36 |
| `/rbac/permissions/{id}` | PUT | `permissions:update`/`permissions:manage` | `PERMISSION_UPDATE_PERMISSIONS` — rbac.rs:37 |
| `/rbac/permissions/{id}` | DELETE | `permissions:delete`/`permissions:manage` | `PERMISSION_DELETE_PERMISSIONS` — rbac.rs:38 |
| `/rbac/roles/permissions` | POST (assign) | `permissions:manage` | rbac.rs:39 |
| `/rbac/roles/{id}/permissions/{pid}` | DELETE | `permissions:manage` | rbac.rs:39 |

Every route has a permission check. None missing. Note: granting/removing a
permission **to/from a role** is gated only on `permissions:manage`, never on
`roles:manage` — a judgment call (permission-side ownership vs role-side), not
a bug, but worth a product decision if the two are meant to be separately
delegable.

### `routes/profile.rs` (merged at `routes/mod.rs:226`) — ALL login-only

Every one of the 13 routes (`/profile`, `/profile/password`, `/profile/sessions`
[+`/{id}`], `/profile/passkeys` [+`/{id}` GET/DELETE/PATCH], `/profile/2fa/{setup,
enable,disable,status,verify}`) calls only `require_auth(&headers)` — no
`check_permission`. **Judged CORRECT**: `user_id` is taken from the JWT claim
(`extract_claims`/`require_auth`, profile.rs:44-231), never from a path or body
parameter, so these are inherently self-scoped — permission gating would be
meaningless (there is no "other user" this endpoint could act on). Sensitive
ones (`password`, all `2fa/*`) are additionally rate-limited via
`limiters.sensitive.check_with_retry` (profile.rs:70-79, 145-153, etc).

### `routes/audit.rs` (merged at `routes/mod.rs:234`)

| Route | Permission |
|---|---|
| GET `/audit-logs` | `audit:read` — audit.rs:39 |
| GET `/audit-logs/actions` | `audit:read` — audit.rs:47 |
| GET `/audit-logs/resource-types` | `audit:read` — audit.rs:55 |
| GET `/audit-logs/users` | `audit:read` — audit.rs:63 |
| GET `/audit-logs/category-counts` | `audit:read` — audit.rs:73 |
| GET `/audit-logs/export/csv` | **`audit:export`** — audit.rs:81 |
| GET `/audit-logs/db-statements` | `audit:read` — audit.rs:90 |

Every route has a permission check. But see **Finding RBAC-3**: `audit:export`
is never seeded, so the CSV export route is permanently unreachable.

### `routes/auth.rs` (merged at `routes/mod.rs:211`) — mostly no check (correct)

| Route | Check | Judged |
|---|---|---|
| POST `/auth/login` | none (rate-limited) | correct — pre-auth |
| GET `/auth/access` | `require_auth` only | correct — returns caller's own snapshot |
| POST `/auth/refresh` | none, cookie-based | correct — pre-auth |
| POST `/auth/logout` | none, cookie-based | correct — pre-auth |
| POST `/auth/register` | none (rate-limited) | correct — pre-auth |
| POST `/auth/verify-email` | none | correct — pre-auth, token in body is the credential |
| POST `/auth/resend-verification` | none (rate-limited) | correct — pre-auth |

`RegisterRequest` (models/auth.rs:82-97) has no `role_ids` field — self-registration
cannot pick a role; new accounts get the `guest` role via
`repositories/auth.rs:260-268` (hardcoded `SELECT id FROM roles WHERE name = 'guest'`).
Confirmed correct — no privilege choice exposed to anonymous registration.

### `routes/two_factor.rs` (merged at `routes/mod.rs:239`) — all login-only (correct)

All 6 routes (`/auth/2fa/{setup,enable,disable,status,verify,
regenerate-backup-codes}`) use `require_auth` only, `user_id` from JWT, sensitive
ones rate-limited. Same self-scoping argument as profile.rs applies — correct.
(Duplicate of `/profile/2fa/*`, same handlers, different prefix — cosmetic
duplication, not a security issue.)

### `routes/passkey.rs` (merged at `routes/mod.rs:238`)

| Route | Check | Judged |
|---|---|---|
| POST `/auth/passkey/register/start` | `require_auth`, self-scoped | correct |
| POST `/auth/passkey/register/finish` | `require_auth`, self-scoped | correct |
| POST `/auth/passkey/login/start` | none (rate-limited: auth) | correct — pre-auth |
| POST `/auth/passkey/login/finish` | none (rate-limited: auth) | correct — pre-auth |

**Summary for item 1**: every login-only / no-check route in these 7 files is
either (a) pre-authentication bootstrapping, or (b) strictly self-scoped by a
JWT-derived `user_id` with no user-suppliable target. No missing checks found.

---

## 2. Privilege escalation

### 2a. The core guard: `ensure_actor_can_manage_roles` (services/rbac.rs:332-357)

```
if role_priority >= actor_priority { Forbidden }
```

`actor_priority = RbacRepository::max_role_priority_for_user(pool, actor_user_id)`
(repositories/rbac.rs:389-402) — the MAX `roles.priority` over the actor's
*current* role rows, recomputed fresh from the DB on every call (not cached,
not JWT-embedded). This is used by every RBAC/user mutation: `assign_role_to_user`
(services/rbac.rs:86-96), `remove_role_from_user` (98-109),
`assign_permission_to_role` (111-120), `remove_permission_from_role` (122-132),
`replace_role_permissions` (134-149), `replace_user_roles` (151-179, called
twice — once for current roles, once for new roles), `update_role` (192-216),
`delete_role` (218-241), and `services/users.rs::ensure_actor_can_manage_user`
(361-368, which resolves the target user's role ids and delegates to the same
function) used by `update_user`/`delete_user`.

**This guard answers "can a user grant a role at/above their own rank?" — NO,
correctly blocked** (`>=`, not `>`). Priority is immutable via API: `RoleInput`
(models/rbac.rs:20-23) has no `priority` field, `RbacRepository::update_role`
(repositories/rbac.rs:525-545) only writes `name`/`description`, and
`create_role` (repositories/rbac.rs:99-118) never sets `priority` so every
custom role gets the schema default `0` (`database/postgres/migrations/
0001_v1_baseline.sql`: `CREATE TABLE public.roles (... priority integer DEFAULT 0
...)`, confirmed via `awk` scan of the table DDL). So no admin-panel action can
ever manufacture a role that outranks its creator.

### 2b. BLOCKER — the guard is priority-only, never permission-superset. A seeded role (manager) can self-escalate into an unrelated permission domain (eKYC)

**"Is there any check that the actor cannot assign a role whose permission set
exceeds their own?" — No. There is none, anywhere in `services/rbac.rs` or
`services/users.rs`.** The only comparison performed is the integer
`role_priority < actor_priority`; nothing compares the *permission set* of the
role being assigned against the actor's own current permission set, and
nothing prevents the target user of `assign_role_to_user`/`replace_user_roles`
from being the actor themselves (`grep -n "actor_user_id ==" src/services/rbac.rs`
→ 0 hits; the only two self-target checks in the whole user/rbac domain are in
`services/users.rs:99` and `:172`, both for the *user record* endpoints, not
for role assignment).

Concretely reachable **today**, with the exact seed data in
`database/postgres/data.sql`:

- Role priorities (data.sql:386-398): `admin=100`, `manager=80`,
  `compliance_admin=90`, `senior_reviewer=75`, `ekyc_reviewer=70`, `auditor=65`,
  `receptionist=60`, `housekeeping=45`, `staff=40`, `support_readonly=30`,
  `guest=20`, `super_admin=1000`.
- `manager`'s seeded permissions (data.sql:538-548) include `users:read`,
  `users:create`, `users:update` — **but zero `ekyc:*` permissions**.
- `senior_reviewer`'s seeded permissions (data.sql:602-607) include
  `ekyc:view_sensitive`, `ekyc:override`, `ekyc:approve`, `ekyc:reject`,
  `ekyc:escalate` — eKYC compliance powers.
- `routes/users.rs:25`: `USER_ROLE_MANAGE_PERMISSIONS = ["users:update",
  "users:manage"]` gates `POST /users/roles` (`assign_role_to_user`).

**Exploit chain**: any user holding only the seeded `manager` role
(`users:update`, priority 80) calls
`POST /users/roles { "user_id": <themselves>, "role_id": <senior_reviewer's id> }`.
`assign_role_to_user` (services/rbac.rs:86-96) calls
`ensure_actor_can_manage_roles(pool, actor_user_id, &[senior_reviewer_id])`,
which only checks `75 < 80` → **passes**. `RbacRepository::assign_role_to_user`
(repositories/rbac.rs:155-170) does a plain
`INSERT INTO user_roles ... ON CONFLICT DO NOTHING` with no further check. The
manager now holds `senior_reviewer` and, through the `rbac_cache`'s per-user
UNION of all held roles' permissions (rbac_cache.rs:90-101), gains
`ekyc:view_sensitive`/`ekyc:override` — sensitive eKYC data reveal and manual
override power a hotel-operations manager was never granted and has no
business capability to use safely.

The bulk `PUT /users/{id}/roles` (`replace_user_roles`, services/rbac.rs:151-179)
is *slightly* more defended in this one specific case — it re-validates the
actor's *current* role set too (line 163: `ensure_actor_can_manage_roles(pool,
admin_user_id, &current_role_ids)`), and since a manager's own current role
(`manager`, priority 80) is not `< 80`, that call fails and blocks the whole
replace. **But this is incidental**, not a deliberate second control: the
single-role `assign_role_to_user`/`remove_role_from_user` endpoints
(`POST /users/roles`, `DELETE /users/{id}/roles/{role_id}`) never re-check the
actor's current roles at all, so the same self-escalation goes through via the
"assign" endpoint even though "replace" would have (accidentally) blocked it
for a single-role actor. This is an actual, no-caveats privilege escalation
reachable by any account holding the standard, intentionally-broad `manager`
role.

Note this same gap also lets ANY actor who can reach `assign_permission_to_role`
(gated on `permissions:manage`, i.e. today only `admin`/`super_admin`, who
already hold every permission) grant a subordinate role a permission
disjoint from their own set — currently a non-issue only because admin/
super_admin get every permission via the `CROSS JOIN` at data.sql:533-535, but
the *code path* offers zero resistance if a future custom role is ever granted
`permissions:manage` without also being admin/super_admin.

### 2c. System role/permission protection — YES on rename/delete, NO on permission-membership mutation

- `update_role` (services/rbac.rs:192-216) and `delete_role` (218-241) both
  check `RbacRepository::role_system_status` (`is_system_role`) and reject with
  `"Cannot modify/delete system roles"` before doing anything else.
- `update_permission` (243-267) and `delete_permission` (269-291) do the
  equivalent `permission_system_status` check.
- **`assign_permission_to_role` (111-120), `remove_permission_from_role`
  (122-132), and `replace_role_permissions` (134-149) call
  `ensure_actor_can_manage_roles` only — none of the three checks
  `is_system_role` at all.**

So the seeded `super_admin` role (priority 1000) is safe from *any* peer or
subordinate acting on it (nobody but another priority-1000+ actor can pass the
`>=` check, and no second `super_admin`-priority actor can act on a peer
either — see 2d), but every OTHER system role (`admin`=100 down to `guest`=20)
**can have its entire permission set wiped or rewritten** by any actor who
outranks it in priority, via `replace_role_permissions(role_id=<admin's id>,
permission_ids=[])` or repeated `remove_permission_from_role` calls — with no
`is_system_role` guard rejecting it, unlike the rename/delete paths that
explicitly protect the same role. Today only `super_admin` (1000 > 100)
can reach `admin`; `admin` (100) can reach every other system role's
permission set (`manager`=80 down to `guest`=20) freely, including
`compliance_admin`/`senior_reviewer`/`auditor` (eKYC and audit-adjacent roles).
This is an inconsistent application of a control the code clearly intends
(see the identical `is_system_role`/`is_system_permission` pattern applied one
function away) — not just a missing nice-to-have.

### 2d. Last-admin protection — verified, works, but only by the combination of two separate checks

- `delete_user` (services/users.rs:171-176) and `update_user`'s
  is_active-false path (services/users.rs:99-103) both explicitly forbid
  `admin_user_id == user_id` (self-delete / self-deactivate).
- `ensure_actor_can_manage_user` → `ensure_actor_can_manage_roles` blocks
  acting on any user whose *any* role has priority `>=` the actor's own max —
  which means **two peers at the same priority tier (e.g. two `admin` users,
  or two `super_admin` users) can never act on each other** (100 >= 100 / 1000
  >= 1000 both fail).

Net effect: nobody can delete/deactivate the sole remaining `super_admin`
(self-blocked, no peer can reach a tie), and an `admin` cannot be
deleted/deactivated by a peer `admin` — only by a `super_admin`. Since
`super_admin` already holds every permission (data.sql:533-535), this cannot
produce an operational lockout. **Verified protected, no finding.**

### 2e. Can a user edit their own roles via profile endpoints?

**No.** `routes/profile.rs` (fully read, 231 lines) exposes no role or
permission mutation route at all — its surface is limited to profile fields,
password, sessions, passkeys, and 2FA. Role/permission management lives
exclusively under `/users/*` and `/rbac/*`, both gated by the checks in
section 1. Confirmed clean.

---

## 3. `is_system_permission`/system-role protection: UPDATE/DELETE paths, not just UI

| Path | is_system_role / is_system_permission checked? | Evidence |
|---|---|---|
| `update_role` | YES | services/rbac.rs:198-203 |
| `delete_role` | YES | services/rbac.rs:219-227 |
| `update_permission` | YES | services/rbac.rs:248-253 |
| `delete_permission` | YES | services/rbac.rs:270-278 |
| `assign_permission_to_role` | **NO** | services/rbac.rs:111-120 |
| `remove_permission_from_role` | **NO** | services/rbac.rs:122-132 |
| `replace_role_permissions` | **NO** | services/rbac.rs:134-149 |

See finding **RBAC-4** below — this is the same gap as 2c, restated for item 3.
The check exists and is correctly enforced for the two functions that change a
role/permission's own *metadata or existence*; it is absent for the three
functions that change a role's *permission membership*, which is the more
consequential mutation for a role like `admin`.

---

## 4. Cache invalidation trace

`core/rbac_cache.rs` (full file read, 164 lines): a `LazyLock<RbacCache>`
static (line 28), keyed by `user_id -> CachedUser{loaded_at, permissions,
roles}` (lines 38-47), TTL from `config.rbac_cache_ttl_secs` defaulting to 30s
(`core/config.rs:158`: `env_or_parse("RBAC_CACHE_TTL_SECS", 30)`). `resolve()`
(84-119) does the 3-table join only on a cache miss/expiry; `has_permission`
(122-132) derives the `<resource>:manage` fallback in-memory.
`invalidate_all()` (143-145) clears the entire `HashMap` — process-global, not
per-user.

**Every SQL write to `user_roles` / `role_permissions` / `permissions` /
`roles` in the repo** (`grep -rn "INSERT INTO user_roles\|DELETE FROM
user_roles\|UPDATE user_roles\|INSERT INTO role_permissions\|DELETE FROM
role_permissions\|UPDATE role_permissions\|INSERT INTO permissions\|UPDATE
permissions\|DELETE FROM permissions\|INSERT INTO roles\|UPDATE roles\|DELETE
FROM roles" src/ --include="*.rs"` → 16 hits, all in `repositories/rbac.rs`,
`repositories/auth.rs:266`, `repositories/user.rs:127,182`):

| Write site | Caller | Invalidates? |
|---|---|---|
| `RbacRepository::{assign,remove}_role_to_user`, `{assign,remove}_permission_to_role`, `replace_role_permissions`, `replace_user_roles`, `update_role`, `delete_role`, `update_permission`, `delete_permission` (repositories/rbac.rs) | `services/rbac.rs` (all 10 mutation fns) | YES — every one of the 10 calls `crate::core::rbac_cache::invalidate_all()` immediately after the repository call (services/rbac.rs:94,107,118,130,147,177,212,239,263,289) |
| `UserRepository::create_with_roles` INSERT (repositories/user.rs:125-134) | `services/users.rs::create_user` (30-77) | **NO invalidate_all call** — but harmless: `user_id` is a brand-new IDENTITY value that was never in the cache, so there is no stale entry to evict |
| `UserRepository::soft_delete` DELETE (repositories/user.rs:182-186) | `services/users.rs::delete_user` (171-210) | YES — `delete_user` calls `invalidate_all()` at line 207 after `soft_delete` succeeds |
| `AuthRepository` guest-registration INSERT (repositories/auth.rs:266-271) | registration flow | **NO invalidate_all call** — harmless, same reasoning (brand-new user_id) |
| `services/users.rs::update_user` | (no RBAC-table write at all — only `users` columns) | calls `invalidate_all()` anyway (users.rs:166) — see finding RBAC-9 (spurious, not missing) |

**No missing invalidation was found for any already-cached user.** Every
mutation that can make an EXISTING user's cached permission/role set stale is
followed synchronously by `invalidate_all()` in the same function, before the
HTTP response is returned. The 30s TTL therefore only bounds drift from
out-of-band edits (direct SQL, a future migration/patch) — not from any
mutation reachable through the app's own RBAC endpoints.

**Worst-case stale window, restated precisely**: `RbacCache` is a single
`static LazyLock` (rbac_cache.rs:28) — one instance **per OS process**. In any
deployment running more than one backend process/replica behind a load
balancer, `invalidate_all()` only clears the process that handled the
mutating request; every *other* process keeps serving the pre-revocation
permission set until its own independent 30-second TTL lapses. This is called
out in the module's own doc comment (rbac_cache.rs:15-17: "Single-process
design ... a process-global cache") as a deliberate, known tradeoff, not a
hidden bug — restated here because the worst case (up to `RBAC_CACHE_TTL_SECS`,
default 30s, per un-notified replica) is exactly the number an operator needs
before scaling this service horizontally. No evidence of horizontal scaling in
this repo today (`grep -n "replicas\|scale" docker-compose.yml` → no hits) —
noted as a scaling landmine, not a live bug.

---

## 5. Redundant `|| check_permission(..., "x:manage")` clauses

`check_permission` (core/middleware.rs:30-59) already derives and checks
`<resource>:manage` as a fallback (lines 43-53) on top of
`AuthService::check_permission` → `rbac_cache::has_permission`
(rbac_cache.rs:121-132), which **itself already** performs the identical
`<resource>:manage` derivation and OR (line 127-131:
`Ok(permissions.contains(permission) || manage.is_some_and(|m|
permissions.contains(&m)))`). So `middleware::check_permission`'s explicit
second call (lines 43-53) can never produce a different result than its first
call — it is provably dead logic, not just stylistically redundant, since both
calls resolve from the same cache entry and the manage-derivation is
byte-identical in both places.

On top of that structural (2-layer) redundancy, the **user-domain permission
constant lists add a third, explicit layer** of the same check:

- `routes/users.rs:21-25` — 5 of 5 lists pair a specific permission with its
  own `:manage` (`["users:read","users:manage"]`,
  `["users:create","users:manage"]`, `["users:update","users:manage"]`,
  `["users:delete","users:manage"]`, `["users:update","users:manage"]`) → **5
  redundant entries**.
- `routes/rbac.rs:18-39` — every one of its 9 lists includes at least one
  `<same-resource>:manage` alongside a specific action on that same resource:
  `RBAC_SNAPSHOT_PERMISSIONS` (roles:manage, permissions:manage, users:manage
  redundant — 3), `ROLE_READ_PERMISSIONS` (1), `ROLE_CREATE_PERMISSIONS` (1),
  `ROLE_UPDATE_PERMISSIONS` (1), `ROLE_DELETE_PERMISSIONS` (1),
  `PERMISSION_READ_PERMISSIONS` (permissions:manage AND roles:manage both
  redundant against permissions:read/roles:read in the same list — 2),
  `PERMISSION_CREATE_PERMISSIONS` (1), `PERMISSION_UPDATE_PERMISSIONS` (1),
  `PERMISSION_DELETE_PERMISSIONS` (1) → **12 redundant entries**.

**Total: 17 redundant `"<resource>:manage"` list entries in the user/RBAC
domain** (routes/users.rs + routes/rbac.rs), all functionally inert given
`check_permission`'s built-in derivation, on top of the structurally-redundant
double-check inside `middleware::check_permission` itself. (For scale: the
same `|| check_permission(..., "x:manage")` pattern recurs outside the user
domain too, e.g. `services/analytics.rs:27-35`,
`repositories/bookings/lifecycle.rs` six times, `services/bookings.rs` three
times, `services/guests.rs` twice — a repo-wide pattern, not unique to RBAC
code.)

---

## 6. Permission-string diff: code vs `database/postgres/data.sql`

Method: `grep -rhoE '"[a-z_]+:[a-z_]+"' src/ --include="*.rs" | sort -u` → 92
raw hits; removed 5 confirmed non-RBAC false positives (`"abc:def"` — test
fixture at `handlers/webhooks.rs:205`; `"auth:login"`/`"auth:passkey"`/
`"auth:register"`/`"guest_portal:verify"`/`"api:generic"` — rate-limiter
*category* labels matched in `core/rate_limiter.rs:251-259`, not RBAC
permissions) → 86 real permission-string literals. Seeded set extracted from
the actual `INSERT INTO permissions (name, resource, action, description,
is_system_permission) VALUES (...)` statement, `database/postgres/data.sql:
414-517` (the ONLY such INSERT in the file — confirmed via
`grep -n "INSERT INTO permissions" data.sql` → single hit) → 103 unique names.

### 6a. In code, NOT seeded (candidates for "permanently denied")

| String | Where used | Verdict |
|---|---|---|
| **`loyalty:manage`** | `src/modules/loyalty/routes.rs:15` (`LOYALTY_MANAGE_PERMISSIONS`, the ONLY entry, no fallback) — gates 7 live, merged endpoints: `manual_adjustment` (loyalty/routes.rs:117), `gift_points` (130), `update_rules` (172), `create_reward` (190), `update_reward` (200), `approve_redemption` (219), `reject_redemption` (230) | **BLOCKER (RBAC-1)** — see below |
| **`loyalty:read`** | `src/modules/loyalty/routes.rs:14` (`LOYALTY_READ_PERMISSIONS`, alongside `analytics:read`) | Not a dead-route bug — `analytics:read` (which IS seeded and IS granted to `manager`/`receptionist`) provides a working fallback for the 4 read endpoints. Still worth fixing (the permission is unusable in its own right, defeating its purpose as a distinct grant). |
| **`audit:export`** | `src/routes/audit.rs:81` (single string, no list, no fallback) — gates `GET /audit-logs/export/csv` | **HIGH (RBAC-3)** — see below |
| `permissions:read`/`create`/`update`/`delete` | `routes/rbac.rs:30,36,37,38` | Not a dead-route bug — each list also contains the seeded `permissions:manage`, which is the actual working grant path. These 4 names are simply never usable as narrower/standalone grants (a role can only ever get "read permissions catalog" via full `permissions:manage`, never in isolation) — a real granularity gap, but not a hard-denied route. |
| `analytics:manage` | `src/services/analytics.rs:30` — `AuthService::check_permission(pool, user_id, "analytics:manage")`, ORed with `analytics:read` and `reports:execute` (lines 27-35) | Not a dead-route bug (same function already accepts `analytics:read`/`reports:execute`); redundant given `check_permission("analytics:read")` already implies `analytics:manage` — same class of finding as section 5, outside the user domain. |
| `analytics:write` | `src/routes/loyalty.rs:20` (`LOYALTY_MANAGE_PERMISSIONS`) | **Dead code** — this whole file is unmerged (see RBAC-5); not reachable regardless. |
| `rooms:write` | `src/routes/rooms.rs:97,116`; `src/routes/rates.rs:57,94,113,150`; `src/services/rooms.rs:425,556` (8 call sites, single-string `require_permission_helper`, no list) | **MEDIUM (RBAC-6)** — outside strict user-domain scope but found by the same diff; see below. |
| `"abc:def"` | test fixture, `handlers/webhooks.rs:205` | Not a permission string — false positive, excluded from all counts above. |

### 6b. Seeded but never referenced in code (candidate dead permissions)

`companies:manage`, `ekyc:manage`, `ekyc:manage_reason_codes`,
`ekyc:manage_risk_rules`, `ekyc:view_sensitive`, `guests:create`,
`housekeeping:manage`, `maintenance:manage`, `navigation_communications:read`,
`navigation_housekeeping:read`, `navigation_promotions:read`,
`navigation_support:read`, `payments:manage`, `reports:read`,
`reviews:create/delete/manage/read/update`, `rooms:create/delete/manage`,
`services:create/delete/manage/read/update`.

Most of these are false "dead" signals from the grep method, not real dead
permissions: the `navigation_*:read` names are consumed as *data* (JSON string
elements inside `route_access_policies.required_permissions`/
`nav_permissions` jsonb columns, e.g. `data.sql:1066`) rather than as Rust
string literals, so they don't show up in a `grep` over `.rs` files; several
of the `*:manage`/`*:create`/`*:delete` ones (rooms, services, reviews,
companies) are very likely consumed the same way the `USER_*_PERMISSIONS`
consts consume `users:manage` — i.e. as the automatic `<resource>:manage`
fallback derived from a differently-spelled action check
(`check_permission(pool, id, "rooms:update")` silently also accepts
`rooms:manage` without the string `"rooms:manage"` ever appearing literally in
Rust source). This report does not assert any of these are truly unreachable
without checking each domain's route file individually — **UNVERIFIED**,
flagged here only because the task asked for the raw diff; recommend a
follow-up pass scoped to those specific domains before treating any as
"delete this permission."

### 6c. Root cause of RBAC-1/RBAC-3: `data.sql`'s own missing-seed check is never wired to fail

`database/postgres/data.sql:51-53` creates `CREATE TEMP TABLE
expected_system_permissions` and seeds it (`data.sql:55-...`) with the full
set of permission names the codebase is expected to depend on — this list
**does include** `loyalty:manage` (data.sql:101), `loyalty:read`
(data.sql:102), and `audit:export` (data.sql:58). Later, `data.sql:1144-1162`
computes `missing_seed_count` — a count of every `expected_system_permissions`
(and role/setting/route-policy) name with no matching row in the real table —
which **would** catch exactly this gap. But `missing_seed_count` is computed
into a `DECLARE`d variable and **never read again**: `grep -n "missing_seed_count"
database/postgres/data.sql` shows it assigned at line 1144 and never appearing
in any subsequent `IF ... THEN RAISE EXCEPTION` (the only three
`RAISE EXCEPTION`s in the file, at lines 23, 1139, and 1177/1196, check
unrelated counters — `invalid_count`, `unknown_route_permission_count`,
`unknown_route_role_count` — never `missing_seed_count`). So a fresh V1
install **silently succeeds** despite `loyalty:manage`/`loyalty:read`/
`audit:export` never being inserted as real `permissions` rows — the
validation code that would have caught this at install time exists, computes
the right number, and is simply never checked.

Corroborating evidence that these three names are real, intended permissions
(not typos invented for this report): `database/postgres/upgrade/
pg18_4_to_v1.sql:4864-4865` (the SQLite→PostgreSQL upgrade script that brought
the pre-existing dev/VPS database up to V1) contains
`('loyalty:read', 'loyalty', 'read', ...), ('loyalty:manage', 'loyalty',
'manage', ...)` and grants them to roles at lines 4893-4904 — i.e., any
database that arrived at V1 via the upgrade path (the live dev DB, the VPS)
already has these rows and never notices the gap; only a genuinely fresh
`data.sql`-only install (CI's Postgres smoke test, a new deployment) is
affected. This is the same class of bug as the 2026-07-27 lessons.md entry
("loyalty bootstrap data" — `loyalty_tiers`/`loyalty_program_rules` business
rows had the identical fate) but for `permissions` catalog rows instead of
business config rows, and it was not caught by that fix.

---

## Findings

### RBAC-1 (BLOCKER, security/correctness) — Priority-only escalation guard: a `manager` can grant themselves eKYC override powers

- **Files**: `src/services/rbac.rs:86-96` (`assign_role_to_user`), `:332-357`
  (`ensure_actor_can_manage_roles`); `src/routes/users.rs:25,91-100`
  (`USER_ROLE_MANAGE_PERMISSIONS`, `POST /users/roles`);
  `database/postgres/data.sql:388,390,396,540,603-607` (priorities and
  permission grants for `manager`/`senior_reviewer`).
- **Impact**: any account holding only the seeded `manager` role can call
  `POST /users/roles {user_id: self, role_id: <senior_reviewer>}` and gain
  `ekyc:view_sensitive`/`ekyc:override` — sensitive eKYC reveal and manual
  override authority a hotel-operations manager was never granted, using only
  the `users:update` permission `manager` legitimately holds.
- **Fix**: `ensure_actor_can_manage_roles` (or a new guard called alongside it)
  must also verify the role being granted introduces no permission the actor
  does not already hold via their *current* role set (a permission-superset
  check, not just a priority-number check); at minimum, `assign_role_to_user`/
  `remove_role_from_user` should reject `target_user_id == actor_user_id`
  (self-service role changes) the same way `services/users.rs:99,172` already
  do for the user-record endpoints.

### RBAC-2 (BLOCKER, correctness) — `loyalty:manage` required-permission is never seeded; 7 live endpoints are permanently 403 for everyone including super_admin

- **Files**: `src/modules/loyalty/routes.rs:15,117,130,172,190,200,219,230`;
  `database/postgres/data.sql:101` (expected list) vs `:414-517` (actual
  INSERT — absent); root cause at `data.sql:1144-1162` (dead
  `missing_seed_count` check, never raised).
- **Impact**: on any fresh V1 install (new deployment, CI's Postgres smoke
  test), nobody can ever hold `loyalty:manage` since the permission row does
  not exist — manual point adjustments, gift points, program-rule updates,
  reward create/update, and redemption approve/reject are dead on arrival,
  including for `super_admin`.
- **Fix**: add `('loyalty:read', 'loyalty', 'read', ..., true), ('loyalty:manage',
  'loyalty', 'manage', ..., true)` to the real `INSERT INTO permissions` in
  `data.sql:414-517` (values already exist verbatim in
  `upgrade/pg18_4_to_v1.sql:4864-4865`), grant them to the appropriate roles,
  ship an idempotent patch for existing V1 databases per the
  `database/postgres/patches/` convention, and wire `missing_seed_count` (or an
  equivalent check) to actually `RAISE EXCEPTION` so this class of gap fails a
  fresh install loudly instead of silently.

### RBAC-3 (HIGH, correctness) — `audit:export` is never seeded; the audit CSV export route is permanently unreachable

- **Files**: `src/routes/audit.rs:81`; `database/postgres/data.sql:58`
  (expected list) vs `:414-517` (actual INSERT — absent).
- **Impact**: `GET /audit-logs/export/csv` requires `audit:export`, which no
  role can ever hold on a fresh install (same root cause as RBAC-2); the
  automatic `<resource>:manage` fallback also fails since `audit:manage` is
  never seeded either. `audit:read`-only endpoints are unaffected.
- **Fix**: same remedy pattern as RBAC-2 — add `audit:export` to the real
  seed INSERT and grant it (`compliance_admin`/`auditor`/`admin` per
  data.sql:592,611 already reference `audit:read` for these roles — extend to
  `audit:export` where CSV export access is intended).

### RBAC-4 (HIGH, security) — System-role protection is enforced for rename/delete but not for permission-membership mutation

- **Files**: `src/services/rbac.rs:111-149` (`assign_permission_to_role`,
  `remove_permission_from_role`, `replace_role_permissions` — no
  `is_system_role` check) vs `:192-241` (`update_role`, `delete_role` — both
  check it).
- **Impact**: any actor who outranks a system role in priority (e.g. `admin`,
  100, against `manager`/`compliance_admin`/`senior_reviewer`/etc., or
  `super_admin` against `admin`) can silently strip or rewrite that role's
  entire permission set via `replace_role_permissions`/
  `remove_permission_from_role`, even though the identical actor is explicitly
  blocked from renaming or deleting the same role. This bypasses the apparent
  intent of the `is_system_role` control using a functionally-equivalent
  "neuter the role" action.
- **Fix**: add the same `RbacRepository::role_system_status` check (or a
  softer "system roles need `super_admin`/an explicit override flag to have
  their permission set replaced") to `assign_permission_to_role`,
  `remove_permission_from_role`, and `replace_role_permissions`.

### RBAC-5 (HIGH, traceability) — 8 of 11 RBAC-mutation functions in `services/rbac.rs` write no audit log at all

- **Files**: `src/services/rbac.rs` — `create_role` (15-17), `create_permission`
  (72-84), `assign_permission_to_role` (111-120), `remove_permission_from_role`
  (122-132), `replace_role_permissions` (134-149), `update_role` (192-216),
  `delete_role` (218-241), `update_permission` (243-267), `delete_permission`
  (269-291) — none call `AuditLog::log_event` or any `AuditLog::log_*` helper.
  Only `assign_role_to_user`/`remove_role_from_user`/`replace_user_roles`
  (via `AuditLog::log_role_assignment`/`log_role_removal`, services/rbac.rs:93,
  106,171,174) and `update_route_policy` (services/rbac.rs:57-68) do.
- **Impact**: creating a role, creating a permission, renaming/deleting a role,
  renaming/deleting a permission, and — most importantly — granting or
  revoking a permission on a role (the action that directly caused RBAC-1's
  and RBAC-4's exploit chains to work) leave **zero** audit trail. If RBAC-1
  or RBAC-4 is exploited, or simply misused by an authorized admin, there is
  no `audit_logs` row identifying who changed what role's permission set or
  when — only the bare `role_permissions` join-table row (which itself has no
  actor/timestamp columns) and the RBAC cache flush.
- **Fix**: add `AuditLog::log_event` calls (matching the pattern already used
  by `update_route_policy`, services/rbac.rs:57-68) to all 9 remaining
  mutation functions, including role/permission id and (for the permission-
  membership functions) the before/after permission set.

### RBAC-6 (MEDIUM, correctness) — `rooms:write` used at 8 call sites is never seeded, silently degrading to full `rooms:manage`

- **Files**: `src/routes/rooms.rs:97,116`; `src/routes/rates.rs:57,94,113,150`;
  `src/services/rooms.rs:425,556`; not present in
  `database/postgres/data.sql:414-517`.
- **Impact**: not a hard-denied route (the automatic `<resource>:manage`
  fallback in `rbac_cache::has_permission` silently substitutes `rooms:manage`,
  which `admin`/`super_admin`/`manager` do hold), but no role can ever be
  granted "write access to rooms" without also getting full `rooms:manage`
  (which additionally implies delete) — the intended finer-grained permission
  was never wired up, so the granularity gap is invisible until someone tries
  to configure a role with write-but-not-delete room access and finds it
  impossible.
- **Fix**: seed `rooms:write` for real (or replace the 8 call sites with the
  already-seeded `rooms:update`, whichever matches the intended semantics) and
  add a patch for existing databases.

### RBAC-7 (MEDIUM, maintainability/efficiency) — `middleware::check_permission`'s explicit manage-fallback is dead logic

- **Files**: `src/core/middleware.rs:30-59` vs `src/core/rbac_cache.rs:121-132`.
- **Impact**: `rbac_cache::has_permission` already ORs in the
  `<resource>:manage` derivation (rbac_cache.rs:127-131) before returning,
  so `middleware::check_permission`'s second explicit lookup for the same
  derived string (middleware.rs:43-53) is guaranteed to return the same
  (already-established) `false` — it can never change the outcome of the
  first call. Purely wasted code path, but worth removing before it misleads
  a future reader into thinking two independent checks exist.
- **Fix**: delete `middleware.rs:43-53`; `has_permission`'s own fallback is
  sufficient and already covers every call site.

### RBAC-8 (LOW, maintainability) — 17 redundant `"<resource>:manage"` entries in user/RBAC permission-list consts

- **Files**: `src/routes/users.rs:21-25` (5 entries); `src/routes/rbac.rs:18-39`
  (12 entries across `RBAC_SNAPSHOT_PERMISSIONS`, `ROLE_READ/CREATE/UPDATE/
  DELETE_PERMISSIONS`, `PERMISSION_READ/CREATE/UPDATE/DELETE_PERMISSIONS`).
- **Impact**: none functionally (RBAC-7 already makes the manage-fallback
  redundant one layer up) — pure code bloat/confusion; a future maintainer may
  assume the explicit `:manage` entries are load-bearing.
- **Fix**: drop the redundant `:manage` entry from each list once RBAC-7 is
  resolved (or leave both fixes for the same PR, since RBAC-7 is what proves
  RBAC-8 safe to delete).

### RBAC-9 (LOW, dead-code) — `src/routes/loyalty.rs` is fully orphaned

- **Files**: `src/routes/mod.rs:19-23` (`pub mod loyalty;`, comment
  acknowledging it is "preserved on disk for backward reference") vs
  `src/routes/mod.rs:211-240` (only `crate::modules::loyalty::routes::routes()`
  is `.merge()`d — `grep -n "routes::loyalty::routes" src/routes/mod.rs` → 0
  hits).
- **Impact**: none live (unreachable), but its own `LOYALTY_MANAGE_PERMISSIONS`
  const (routes/loyalty.rs:20) references a THIRD unseeded string,
  `analytics:write`, compounding confusion for anyone diffing permission
  strings against the seed file without first checking merge status. Same
  category as the already-deleted `handlers/ekyc.rs` (see git log
  `bf38639b6 chore(be): delete orphaned handlers/ekyc.rs`).
- **Fix**: delete `src/routes/loyalty.rs` and its `pub mod loyalty;`
  declaration, same as the ekyc precedent.

### RBAC-10 (LOW, maintainability) — targeted cache invalidation and role/admin-gate helpers exist but are never called

- **Files**: `src/core/rbac_cache.rs:148-151` (`invalidate_user`, `#[allow(
  dead_code)]`); `src/core/middleware.rs:81-92` (`check_admin_role`, `#[allow(
  dead_code)]`), `:122-127` (`require_admin_helper`, `#[allow(dead_code)]`),
  `:130-152` (`require_super_admin_helper`, `#[allow(dead_code)]`); confirmed
  unused via `grep -rn "require_super_admin_helper\|require_admin_helper\|
  check_admin_role\b" src/ --include="*.rs"` → only re-exports in `lib.rs:19-20`
  and `core/mod.rs:32-33`, never called from any route handler.
- **Impact**: every RBAC mutation calls the blunt `invalidate_all()`
  (process-wide cache flush for every user) instead of the already-written,
  cheaper `invalidate_user(target_user_id)` — functionally correct, just more
  work than necessary on every mutation, on every other logged-in user's
  cached entry. Separately, no endpoint anywhere hard-gates on "must literally
  hold the super_admin flag" (`require_super_admin_helper`) or "must hold the
  admin role" (`check_admin_role`) — every privileged action in this repo is
  gated purely by permission strings plus the priority-comparison guard from
  section 2, never by these role/flag-based helpers that exist in the code.
- **Fix**: either wire `invalidate_user` into the targeted mutation paths
  (`assign_role_to_user`, `remove_role_from_user`, `update_user`, etc., where
  the affected user_id is already known) or remove the unused helpers/`#[allow
  (dead_code)]` markers if the blunt-invalidation design is intentionally
  preferred for simplicity.

---

## Answers, condensed

1. Route table: see section 1. No missing permission checks found in any of
   the 7 files; every login-only route is either pre-auth or JWT-self-scoped.
2. Escalation: role priority strictly blocks "assign a role at/above your own
   rank" (correct), but **has no permission-superset check at all** — RBAC-1
   is a real, reachable escalation with the shipped seed data. Super_admin is
   protected from deletion/deactivation by self-block + peer-tie-block;
   last-admin lockout is not possible given the current seed (super_admin
   already holds everything). Users cannot edit their own roles via
   `/profile/*` (no such route exists there).
3. `is_system_role`/`is_system_permission` is enforced for rename/delete, NOT
   for permission-membership mutation (RBAC-4).
4. Cache: TTL 30s default (`RBAC_CACHE_TTL_SECS`); every mutation reachable
   through the app's own endpoints synchronously invalidates before
   responding — no missed invalidation found for any pre-existing cached user.
   The cache is process-local, so the real worst-case stale window in a
   multi-replica deployment is the TTL, per un-notified replica (not currently
   applicable — no evidence of horizontal scaling in this repo).
5. Redundant `:manage` clauses: 17 in the user/RBAC domain (routes/users.rs +
   routes/rbac.rs), plus a structural (always-inert) second check inside
   `middleware::check_permission` itself (RBAC-7/RBAC-8).
6. Permission-string diff: `loyalty:manage`, `loyalty:read`, and `audit:export`
   are used in live, merged route code but were never inserted into
   `permissions` by `data.sql` (only listed in its own never-checked
   `expected_system_permissions` validation) — RBAC-2/RBAC-3, both reproducible
   on a fresh install. `rooms:write` (8 sites) has the same gap but degrades
   safely to `rooms:manage` (RBAC-6). `permissions:read/create/update/delete`
   are unseeded but always paired with the seeded `permissions:manage` in the
   same check list, so they're a granularity gap, not a dead route.
