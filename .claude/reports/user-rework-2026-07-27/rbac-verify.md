# Adversarial verification: RBAC correctness findings (2026-07-27)

Scope: roles, permissions, assignment, caching, escalation.
All line numbers below were opened and re-read this session (not trusted from
the auditor's report).

## Verdicts

### rbac-priority-only-escalation-guard — CONFIRMED (blocker)
- `ensure_actor_can_manage_roles` (services/rbac.rs:332-357) is exactly
  `if role_priority >= actor_priority { Forbidden }` — no permission-superset
  comparison anywhere in the function or its callers.
- `assign_role_to_user` (rbac.rs:86-96) calls only this guard.
- Route: POST `/users/roles` (routes/users.rs:37,91-100) gated by
  `USER_ROLE_MANAGE_PERMISSIONS = ["users:update","users:manage"]`
  (routes/users.rs:25,97). No self-assignment guard anywhere in
  `handlers/rbac.rs:62-72` or `services/rbac.rs:86-96`.
- Seed data verified: `manager` priority 80 (data.sql:389), `senior_reviewer`
  priority 75 (data.sql:396). Manager's granted permissions (data.sql:538-548)
  include `users:update` (line 540) and contain **no** `ekyc:*` permission.
  `senior_reviewer`'s permissions (data.sql:603-607) include
  `ekyc:view_sensitive` (604) and `ekyc:override` (606).
- Exploit chain fully re-derived: a `manager`-only account calls
  `POST /users/roles {user_id: self, role_id: <senior_reviewer's id>}`; 75 >= 80
  is false, so `ensure_actor_can_manage_roles` returns `Ok`, and the manager
  gains `ekyc:view_sensitive`/`ekyc:override` it was never granted, using only
  `users:update`. No refutation found. Blocker severity justified.

### rbac-loyalty-manage-never-seeded — CONFIRMED (blocker)
- `data.sql:101-102` lists `loyalty:manage` and `loyalty:read` in
  `expected_system_permissions`.
- The real `INSERT INTO permissions` statement (data.sql:414-517) contains
  **zero** `loyalty:*` rows — grep confirms (`grep -n "'loyalty" data.sql` only
  hits lines 101, 102, 255 (an unrelated `expected_system_roles`-style temp
  table? no — line 255 is `('loyalty')` in a different expected-list, and 1066
  is the `loyalty` nav route policy, which requires `analytics:read`, not
  `loyalty:*`).
- `missing_seed_count` (data.sql:1144-1162) computes exactly this gap via
  `NOT EXISTS` against `expected_system_permissions`, but is **never** read by
  any `IF`/`RAISE EXCEPTION` — confirmed by reading the entire validation block
  data.sql:1087-1222: only `invalid_count` (1138), `unknown_route_permission_count`
  (1176), `unknown_route_role_count` (1195), and `obsolete_assigned_role_count`
  (1216, `RAISE NOTICE` only) are checked. `missing_seed_count` is computed and
  discarded — dead code, exactly as claimed.
- `src/modules/loyalty/routes.rs:15` `LOYALTY_MANAGE_PERMISSIONS = ["loyalty:manage"]`,
  used with `require_any_permission_helper` (no fallback list) at lines 117
  (manual_adjustment), 130 (gift_points), 172 (update_rules), 190 (create_reward),
  200 (update_reward), 219 (approve_redemption), 230 (reject_redemption) — all
  7 call sites verified verbatim.
- `rbac_cache::has_permission` (rbac_cache.rs:122-132) derives the manage
  fallback as `permission.split_once(':').0 + ":manage"` — for input
  `"loyalty:manage"` this derives `"loyalty:manage"` itself, i.e. no rescue.
- Confirmed the values exist in `database/postgres/upgrade/pg18_4_to_v1.sql:4865`
  (existing-DB upgrade path inserts it; only the fresh V1 `data.sql` omits it).
- No refutation found.

### rbac-audit-export-never-seeded — CONFIRMED (high)
- `routes/audit.rs:81`: `require_permission_helper(&pool, &headers, "audit:export")`
  — single string, no fallback list (verified by reading the whole 92-line file).
- `data.sql:58` lists `audit:export` in `expected_system_permissions`; the real
  INSERT (414-517) contains only `audit:read` (line 498) for the `audit`
  resource — no `audit:export`, and (notably stronger than the auditor's own
  framing) **no `audit:manage` is even in the *expected* list** — the `audit`
  resource was apparently never designed to have a `:manage` permission at all,
  so there is no possible rescue path, not even a theoretical one.
- Same dead `missing_seed_count` root cause as the loyalty finding.
- No refutation found.

### rbac-system-role-permission-mutation-unguarded — CONFIRMED (high)
- Read the entirety of `services/rbac.rs`. `assign_permission_to_role` (111-120),
  `remove_permission_from_role` (122-132), `replace_role_permissions` (134-149)
  each call only `ensure_actor_can_manage_roles` — no `role_system_status` call.
- Repository layer also checked (`repositories/rbac.rs:189-204, 207-220, 412-...`)
  — no `is_system_role` guard there either.
- Contrast confirmed: `update_role` (192-216) and `delete_role` (218-241) both
  match on `RbacRepository::role_system_status` first and reject
  `Some(true)` with `"Cannot modify/delete system roles"`.
- Reachability check: the route for `replace_role_permissions`
  (routes/rbac.rs `assign_permission`/`replace_role_permissions`) requires
  `PERMISSION_MANAGE_PERMISSIONS = ["permissions:manage"]` (routes/rbac.rs:36,
  148-149 area), and in the **default seed** only `admin`/`super_admin` hold
  `permissions:manage` (data.sql:534, `CROSS JOIN` all permissions). So in the
  as-shipped seed this specific path requires admin-tier access already — but
  the finding's own framing ("any actor who outranks a system role in
  priority") is still accurate for any deployment where `permissions:manage`
  is granted to a non-admin role via the RBAC UI (which is exactly what the
  RBAC admin screen is built to allow). Severity "high" (not blocker) is
  reasonable given the admin-tier prerequisite. No refutation of the core claim.

### rbac-missing-audit-on-mutations — PARTIAL (count is wrong; substance holds)
- Read the entire `services/rbac.rs` and enumerated every mutating function:
  `create_role`(15-17, no audit), `update_route_policy`(49-70, **has** audit
  via `log_event` at 57), `create_permission`(72-84, no audit),
  `assign_role_to_user`(86-96, **has** audit via `log_role_assignment` at 93),
  `remove_role_from_user`(98-109, **has** audit via `log_role_removal` at 106),
  `assign_permission_to_role`(111-120, no audit),
  `remove_permission_from_role`(122-132, no audit),
  `replace_role_permissions`(134-149, no audit),
  `replace_user_roles`(151-179, **has** audit at 171/174),
  `update_role`(192-216, no audit), `delete_role`(218-241, no audit),
  `update_permission`(243-267, no audit), `delete_permission`(269-291, no audit).
- That is **13 mutating functions total**, **4 with audit logging**, **9
  without** — i.e. "9 of 13", not the title's "8 of 11". The auditor's own
  evidence string actually *lists* 9 function names (matches my count), so the
  title's "8 of 11" is simply an arithmetic slip inconsistent with its own
  evidence, not a different (smaller) claim.
- Substance fully confirmed: assigning/removing a permission on a role — the
  exact action behind two blocker/high findings above — writes no audit_logs
  row. Severity "high" stands.
- Corrected: **9 of 13** RBAC mutation functions lack audit logging (not 8 of 11).

### rbac-rooms-write-never-seeded — CONFIRMED (medium)
- All 8 call sites verified verbatim: routes/rooms.rs:97,116;
  routes/rates.rs:57,94,113,150; services/rooms.rs:425,556 — all
  `require_permission_helper(&pool, &headers, "rooms:write")`.
- `data.sql:164` lists `rooms:write` in `expected_system_permissions`; absent
  from the real INSERT (414-517), same dead-validation root cause.
- Fallback check: `"rooms:write"` → derived manage = `"rooms:manage"`, which
  **is** seeded (data.sql:430) and granted to `manager`/`admin`/`super_admin`
  (manager: data.sql:540 `'rooms:manage'`). So the fallback rescues every
  caller today — medium (not blocker) is correct, matching the auditor's own
  characterization. No refutation.

### rbac-middleware-manage-fallback-dead-code — CONFIRMED (medium)
- `AuthService::check_permission` (core/auth.rs:489-495) is a direct
  passthrough to `rbac_cache::has_permission`, which (rbac_cache.rs:122-132)
  **already** ORs the exact permission with the derived `<resource>:manage`.
- `middleware::check_permission` (middleware.rs:30-59) calls
  `AuthService::check_permission` once (line 35); if that's false, it derives
  `manage_permission` again (line 44) and calls `AuthService::check_permission`
  a second time (line 46) with that manage string.
- Traced the logic: the second call re-enters `rbac_cache::has_permission`
  with `permission = "<resource>:manage"`; splitting THAT on `:` yields the
  same resource, so its own derived-manage fallback is `"<resource>:manage"` —
  identical to the input. The second check therefore reduces to
  `permissions.contains(manage_permission)`, which the FIRST call already
  evaluated (as the second disjunct of its own OR) and found false. The
  second check cannot logically produce a different result. Confirmed
  provably-inert, no functional bug, medium/nit-adjacent severity as stated.

## Additional issues found (not in the original report)

1. **The `missing_seed_count` dead-validation gap is far larger than any single
   reported instance.** Diffed `expected_system_permissions` (data.sql:56-185,
   129 entries) against the real `INSERT INTO permissions` list (data.sql:414-517,
   103 entries) programmatically: **26** expected permissions are missing, not
   the 3 already reported (`loyalty:manage`, `audit:export`, `rooms:write`).
   The other 23: `loyalty:read`, `permissions:create/read/update/delete`,
   `rewards:read`, and 17 `navigation_*:read` permissions (`navigation_audit_log`,
   `navigation_bookings`, `navigation_company_ledger`, `navigation_complimentary`,
   `navigation_data_transfer`, `navigation_ekyc_admin`, `navigation_guest_config`,
   `navigation_loyalty`, `navigation_my_bookings`, `navigation_my_rewards`,
   `navigation_night_audit`, `navigation_rbac`, `navigation_reports`,
   `navigation_room_config`, `navigation_room_management`, `navigation_settings`,
   `navigation_timeline`). I checked whether any of these are load-bearing:
   grepped the entire `route_access_policies` INSERT block (data.sql:619-1085)
   for each — none of the 17 `navigation_*` gaps are referenced by any
   `required_permissions`/`nav_permissions` array there (only 4 *working*
   `navigation_*` permissions are referenced: housekeeping/support/promotions/
   communications, all of which DO exist in the real INSERT). Grepped
   `src/` for `rewards:read` — zero hits, dead on both sides. The
   `permissions:create/read/update/delete` gaps are harmless today because
   `permissions:manage` (which IS seeded) satisfies their `<resource>:manage`
   fallback. So today's *functional* blast radius is exactly the 3 the auditor
   found — but the underlying validation bug is systemic (18%, 26/129, of the
   declared permission surface silently diverges from what's installed), and
   the very next permission added to `expected_system_permissions` without a
   matching real INSERT will silently repeat this bug with no CI signal.
   Severity: informational/medium — strengthens, not weakens, the case for
   fixing `missing_seed_count` itself rather than patching each instance.
   File: `hotel-app-be/database/postgres/data.sql:56-185` vs `:414-517`.

2. **`assign_permission_to_role`/`remove_permission_from_role`/
   `replace_role_permissions` never check that the acting user already holds
   the permission being granted or revoked** — a second, independent code path
   with the same "no permission-superset check" root cause as the reported
   blocker (which was about assigning an *existing role*, not granting a
   *specific permission*). Verified: `services/rbac.rs:111-149` calls only
   `ensure_actor_can_manage_roles(pool, actor_user_id, &[input.role_id])`,
   which checks the role's priority, never whether `actor_user_id` holds
   `input.permission_id` or any permission at all in that resource. In the
   default seed this requires `permissions:manage` first (routes/rbac.rs,
   `PERMISSION_MANAGE_PERMISSIONS`), which today only `admin`/`super_admin`
   hold (data.sql:534), so it grants no *new* capability against the shipped
   seed — but it means any deployment that grants `permissions:manage` to a
   custom, lower-priority "IT admin" role (exactly what the RBAC screen exists
   to let an operator do) lets that role grant itself/any role below its
   priority *any* permission in the system, including ones the actor does not
   hold and has no domain clearance for (e.g. `payments:refund`,
   `ekyc:override`), as long as the target role's priority is below the
   actor's. Severity: medium (gated by an admin-tier permission today, but a
   real absent invariant, same class as the blocker).
   File: `hotel-app-be/src/services/rbac.rs:111-149`.

3. **`delete_permission`/`delete_role` don't check for dangling references
   inside `route_access_policies`' JSONB permission/role-name arrays.**
   `role_count_for_permission`/`user_count_for_role` checks (rbac.rs:280-286,
   230-236) only look at the relational `role_permissions`/`user_roles`
   tables. `route_access_policies.required_permissions`/`nav_permissions`/
   `required_roles`/etc. store permission/role *names* as JSONB text, with no
   FK. Deleting a custom (non-system) permission or role that a custom route
   policy references would silently leave that policy referencing a
   non-existent name — `unknown_route_permission_count`/
   `unknown_route_role_count` (data.sql:1168-1199) only run once, during the
   `data.sql` bootstrap, not on every runtime mutation. Low severity — data
   integrity/nav breakage, not an escalation risk (the route policy table is
   documented elsewhere in this repo's own lessons as nav-only, not an API
   authorization gate). File: `hotel-app-be/src/services/rbac.rs:269-291`.
