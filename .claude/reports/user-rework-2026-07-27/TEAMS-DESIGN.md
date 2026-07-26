# Teams domain — design

Commander-authored 2026-07-27. The audit workflow did not cover this (Teams was
scoped in after launch), so nothing here comes from a subagent report.

## Decision: teams confer roles; leads get one bounded scope check

Three models were available:

| model | what it means | verdict |
|---|---|---|
| A. Pure grouping | teams are an org chart + a filter; permissions stay global | too weak — "Front Desk vs Housekeeping team leads" implies authority, not labels |
| B. Teams confer roles | membership in a team grants that team's roles; resolution is a UNION | **chosen** |
| C. Fully scoped permissions | every check becomes `(permission, scope)`; every resource gains a team column | rejected — touches all ~400 `check_permission` call sites and every domain table, for value a hotel does not need |

**Chosen: B, plus exactly one scoped rule for leads.** A team lead may manage the
*membership* of their own team without holding global `users:manage`. That is the single
scoped capability, implemented as one helper — not a general scope engine. Everything else
(granting roles, editing teams, deleting teams) stays on global permissions.

This is what makes the feature real without making authorization unreviewable.

## Schema (3 tables, all new)

Per lesson 2026-07-24, each goes in three places in the pg_dump-shaped baseline:
`CREATE TABLE` (no inline PK/FK) → `ADD CONSTRAINT …_pkey` → `ADD CONSTRAINT …_fkey`.
Identity columns use `GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME …)` per 2026-07-26c.

```sql
CREATE TABLE public.teams (
    id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.teams_id_seq),
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL,
    code character varying(50) NOT NULL,      -- 'front_desk'
    name character varying(100) NOT NULL,     -- 'Front Desk'
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint,
    deleted_at timestamp with time zone,
    CONSTRAINT valid_team_code CHECK (((code)::text ~ '^[a-z][a-z0-9_]*$'))
);
-- partial unique: code is unique among live rows only, so a deleted team's
-- code can be reused (mirrors users.deleted_at soft-delete semantics)
CREATE UNIQUE INDEX teams_code_live_key ON public.teams (code) WHERE deleted_at IS NULL;

CREATE TABLE public.team_members (
    team_id bigint NOT NULL,
    user_id bigint NOT NULL,
    is_lead boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    added_by bigint,                          -- WRITTEN, unlike user_roles.assigned_by (C2)
    expires_at timestamp with time zone       -- HONOURED, unlike user_roles.expires_at (C1)
);
-- PK (team_id, user_id); FKs to teams(id) ON DELETE CASCADE, users(id) ON DELETE CASCADE,
-- added_by -> users(id) ON DELETE SET NULL

CREATE TABLE public.team_roles (
    team_id bigint NOT NULL,
    role_id bigint NOT NULL,
    granted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    granted_by bigint                          -- WRITTEN
);
-- PK (team_id, role_id); FKs to teams(id) ON DELETE CASCADE, roles(id) ON DELETE CASCADE,
-- granted_by -> users(id) ON DELETE SET NULL
```

Indices: `team_members(user_id)` (the resolution query's driving predicate),
`team_roles(role_id)` (for "which teams grant this role" on role delete).

## Permission resolution — one query, and it fixes C1 on the way

`core/rbac_cache.rs::resolve` currently runs two expiry-blind queries. Both become:

```sql
WITH effective_roles AS (
    SELECT ur.role_id
      FROM user_roles ur
     WHERE ur.user_id = $1
       AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP)
    UNION
    SELECT tr.role_id
      FROM team_roles tr
      JOIN team_members tm ON tm.team_id = tr.team_id
      JOIN teams t         ON t.id = tm.team_id
     WHERE tm.user_id = $1
       AND t.is_active
       AND t.deleted_at IS NULL
       AND (tm.expires_at IS NULL OR tm.expires_at > CURRENT_TIMESTAMP)
)
SELECT DISTINCT p.name
  FROM permissions p
  JOIN role_permissions rp ON p.id = rp.permission_id
  JOIN effective_roles er  ON er.role_id = rp.role_id
```

One place gains teams; one place fixes expiry. `AuthService::check_permission`
(`core/auth.rs:459`) and `get_user_roles` (`:475`) must be changed identically or the two
resolution paths disagree — and per the audit they are *both* live.

**Cache-expiry interaction.** With `expires_at` honoured, a 30s-TTL cache means access can
outlive its expiry by up to 30s. Store the minimum future `expires_at` alongside the entry
and expire the cache entry at `min(loaded_at + ttl, earliest_expiry)`. Cheap, and it makes
the expiry claim true rather than approximately true.

## Escalation guard — extend, don't add a second one

The existing guard `services/rbac.rs::ensure_actor_can_manage_roles` is priority-only,
which the audit proved exploitable (a `manager`, priority 80, can self-assign
`senior_reviewer`, priority 75, and gain `ekyc:override`). The fix is a **permission-superset
rule**, and it is the same rule teams need:

> An actor may grant a role R to any principal (user or team) only if
> `permissions(R) ⊆ effective_permissions(actor)` **and** `priority(R) < max_priority(actor)`.

Both conditions, not either. Superset alone would let a peer-priority actor act on a peer;
priority alone is today's hole. Applying it to `team_roles` grants means teams cannot become
a laundering path around the user-role guard — which is the obvious way a naive teams
feature would reintroduce RBAC-1.

## The one scoped rule

```rust
/// True when the actor may change *membership* of this team:
/// either they hold the global permission, or they lead this specific team.
async fn actor_can_manage_team_membership(pool, actor_id, team_id) -> Result<bool>
```

Holds for: add member, remove member, set/unset lead within one's own team.
Does **not** hold for: creating/deleting teams, granting roles to a team, editing team
attributes. Those require `teams:create` / `teams:delete` / `teams:update` globally, and
role grants additionally pass the superset guard above.

## Seeded permissions and bootstrap wiring

Six permissions: `teams:read`, `teams:create`, `teams:update`, `teams:delete`,
`teams:manage`, `teams:assign` (membership changes).

Verified against the baseline's `valid_action` CHECK: `create`, `read`, `update`, `delete`,
`manage`, `assign` are **all already in the allowlist**, so no `valid_action` edit is needed
— which per lesson 2026-07-15 would otherwise have meant touching five separate copies of
that constraint. This is why `assign` was chosen over a new verb like `enroll`.

Bootstrap touch-list (all inside `data.sql`'s single `BEGIN…COMMIT`, before the validation
DO block — appending after `COMMIT` fails, per 2026-07-15):
1. `expected_system_permissions` — 6 new `('teams:x')` rows
2. the `permissions` INSERT — 6 rows `(name, resource, action, description, true)`
3. role grants: `admin`/`super_admin` get all six via the existing `CROSS JOIN`;
   `manager` gets `teams:read` + `teams:assign`; `receptionist`/`housekeeping` get `teams:read`
4. `expected_route_access_policies` — `('teams')`
5. `route_access_policies` — the `teams` nav row
6. seed data: three starter teams (`front_desk`, `housekeeping`, `maintenance`) go in
   `data.sql` only if they are policy-neutral defaults; otherwise `seed.sql`. Per lesson
   2026-07-27 (loyalty), anything read with `fetch_one` must be bootstrap data — teams are
   read with `fetch_all` and an empty list is valid, so starter teams belong in `seed.sql`.

Plus: an idempotent `patches/2026-07-27-teams.sql` in the same commit for existing DBs
(VPS + desktop), and the byte-identical mirror into `hotel-desktop/src-tauri/database/postgres/`.

## What this deliberately does not do

- No team-scoped filtering of bookings/rooms/tasks. `team_members` is available to any
  future query that wants it, but no existing domain query changes. Scoping housekeeping
  tasks by team is a separate, larger decision with real operational consequences.
- No nested teams / hierarchy. A flat set of teams covers hotel departments; hierarchy is
  the kind of speculative generality that never gets used.
- No per-team permission overrides. Teams grant whole roles. Anything finer belongs in a
  role.
