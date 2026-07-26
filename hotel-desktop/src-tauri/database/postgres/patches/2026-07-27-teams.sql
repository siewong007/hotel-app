-- Patch: teams (departments) with role conferral (PostgreSQL)
-- Date: 2026-07-27
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/migrations/0001_v1_baseline.sql, which now creates the
-- teams / team_members / team_roles trio and seeds the six `teams:*`
-- permissions plus the `teams` navigation route.
--
-- Model: a team confers ROLES on its members. Effective permissions become
-- the union of a user's direct `user_roles` and the roles granted to any
-- active team they belong to. `team_members.expires_at` is honoured by the
-- resolution query (unlike `user_roles.expires_at`, which this release also
-- starts honouring), and `added_by` / `granted_by` are actually written, so
-- "who put this person on the team, and when" is answerable from the tables.
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-27-teams.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- A department / working team. Soft-deleted like users, so a disbanded team
-- keeps its audit history; the partial unique index below lets its code be
-- reused afterwards.
CREATE TABLE IF NOT EXISTS teams (
    id BIGINT GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME teams_id_seq) PRIMARY KEY,
    uuid UUID DEFAULT gen_uuidv7() NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT valid_team_code CHECK (((code)::text ~ '^[a-z][a-z0-9_]*$'))
);

COMMENT ON TABLE teams IS 'Departments / working teams. Membership confers the roles in team_roles.';

CREATE UNIQUE INDEX IF NOT EXISTS teams_code_live_key
    ON teams (code) WHERE deleted_at IS NULL;

-- Membership. `is_lead` is the ONLY team-scoped capability in the system: a
-- lead may change their own team's membership without holding global
-- users:manage. It confers no permissions by itself.
CREATE TABLE IF NOT EXISTS team_members (
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_lead BOOLEAN DEFAULT false NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    added_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,
    PRIMARY KEY (team_id, user_id)
);

COMMENT ON COLUMN team_members.expires_at IS 'Membership lapses at this instant; the permission-resolution query filters on it.';

-- Roles a team confers on every current member.
CREATE TABLE IF NOT EXISTS team_roles (
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (team_id, role_id)
);

-- `team_members(user_id)` drives permission resolution on every request that
-- misses the RBAC cache; `team_roles(role_id)` answers "which teams confer
-- this role" when a role is deleted.
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_team_roles_role_id ON team_roles USING btree (role_id);

-- ---------------------------------------------------------------------------
-- 2. Permissions
--
-- Every action verb used here (create/read/update/delete/manage/assign) is
-- already in the permissions.valid_action CHECK constraint, so no constraint
-- rewrite is needed -- that constraint is declared in five places and each
-- copy would have had to change.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('teams:create', 'teams', 'create', 'Create teams', true),
    ('teams:read',   'teams', 'read',   'View teams and their membership', true),
    ('teams:update', 'teams', 'update', 'Update team details', true),
    ('teams:delete', 'teams', 'delete', 'Delete teams', true),
    ('teams:assign', 'teams', 'assign', 'Add or remove team members', true),
    ('teams:manage', 'teams', 'manage', 'Full control over teams', true)
ON CONFLICT (name) DO NOTHING;

-- admin and super_admin hold every system permission; mirror that here rather
-- than relying on the CROSS JOIN in data.sql, which only runs on a fresh install.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name LIKE 'teams:%'
ON CONFLICT DO NOTHING;

-- A manager runs the roster: reads teams and moves people between them, but
-- cannot create or delete teams, and cannot grant a team a role.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'manager'
  AND p.name IN ('teams:read', 'teams:assign')
ON CONFLICT DO NOTHING;

-- Front-of-house roles can see who is on which team.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('receptionist', 'housekeeping')
  AND p.name = 'teams:read'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Navigation route
--
-- `nav_permissions` deliberately reuses `teams:read` rather than introducing a
-- `navigation_teams:read`; the existing navigation_* names are declared in
-- data.sql but never inserted, and this release is closing that gap rather
-- than widening it.
-- ---------------------------------------------------------------------------

INSERT INTO route_access_policies (
    route_id,
    path,
    nav_label,
    nav_group,
    required_permissions,
    required_roles,
    excluded_roles,
    nav_permissions,
    nav_roles,
    nav_excluded_roles,
    is_navigation,
    is_system_policy
)
VALUES (
    'teams',
    '/teams',
    'Teams',
    'config',
    '["teams:read"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["teams:read"]'::jsonb,
    '[]'::jsonb,
    '["guest"]'::jsonb,
    true,
    true
)
ON CONFLICT (route_id) DO UPDATE SET
    path = EXCLUDED.path,
    nav_label = EXCLUDED.nav_label,
    nav_group = EXCLUDED.nav_group,
    required_permissions = EXCLUDED.required_permissions,
    required_roles = EXCLUDED.required_roles,
    excluded_roles = EXCLUDED.excluded_roles,
    nav_permissions = EXCLUDED.nav_permissions,
    nav_roles = EXCLUDED.nav_roles,
    nav_excluded_roles = EXCLUDED.nav_excluded_roles,
    is_navigation = EXCLUDED.is_navigation,
    is_system_policy = EXCLUDED.is_system_policy,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
