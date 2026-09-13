-- Revenue & Marketing phase 4: dynamic guest segments + campaign targeting.
--
-- Adds `guest_segments` (JSONB rule sets evaluated live — membership is never
-- materialized) and `email_campaigns.segment_id` so a campaign's audience is
-- the intersection of segment rules, topic consent, and the suppression list.
-- Ships the `segments:read`/`segments:manage`/`navigation_segments:read`
-- permissions and the `/segments` route policy in the revenue nav group.
--
-- Fresh installs get all of this from the V1 baseline + seed.sql; installed
-- databases need it delivered here. The DDL is byte-identical to the baseline
-- additions so `pg_dump --schema-only` of (baseline) and (older baseline +
-- this patch) must diff to nothing. Every step is individually guarded so
-- re-running is a no-op rather than an error.
DO $guest_segments$
DECLARE
    missing_roles text;
BEGIN
    IF to_regclass('public.guests') IS NULL THEN
        RAISE EXCEPTION 'guest_segments preflight failed: guests is missing';
    END IF;
    IF to_regclass('public.email_campaigns') IS NULL THEN
        RAISE EXCEPTION 'guest_segments preflight failed: email_campaigns is missing';
    END IF;
    IF to_regclass('public.loyalty_tiers') IS NULL THEN
        RAISE EXCEPTION 'guest_segments preflight failed: loyalty_tiers is missing';
    END IF;

    SELECT string_agg(expected.name, ', ') INTO missing_roles
    FROM (VALUES ('admin'::text), ('super_admin')) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.name = expected.name);

    IF missing_roles IS NOT NULL THEN
        RAISE EXCEPTION 'guest_segments preflight failed: roles missing: %', missing_roles;
    END IF;

    IF to_regclass('public.guest_segments') IS NULL THEN
        EXECUTE $ddl$CREATE TABLE public.guest_segments (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(160) NOT NULL,
    description text,
    rules jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by bigint,
    updated_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'guest_segments_name_not_blank'
          AND conrelid = 'public.guest_segments'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.guest_segments
    ADD CONSTRAINT guest_segments_name_not_blank CHECK ((length(btrim(name::text)) > 0))$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'guest_segments_rules_shape'
          AND conrelid = 'public.guest_segments'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.guest_segments
    ADD CONSTRAINT guest_segments_rules_shape CHECK ((jsonb_typeof(rules) = 'object'::text))$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guest_segments'
          AND column_name = 'id' AND is_identity = 'YES'
    ) THEN
        EXECUTE $ddl$ALTER TABLE public.guest_segments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'guest_segments_pkey'
          AND conrelid = 'public.guest_segments'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.guest_segments
    ADD CONSTRAINT guest_segments_pkey PRIMARY KEY (id)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'guest_segments_slug_key'
          AND conrelid = 'public.guest_segments'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.guest_segments
    ADD CONSTRAINT guest_segments_slug_key UNIQUE (slug)$ddl$;
    END IF;

    IF to_regclass('public.idx_guest_segments_active') IS NULL THEN
        EXECUTE $ddl$CREATE INDEX idx_guest_segments_active ON public.guest_segments USING btree (is_active) WHERE (is_active = true)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'guest_segments_created_by_fkey'
          AND conrelid = 'public.guest_segments'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.guest_segments
    ADD CONSTRAINT guest_segments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'guest_segments_updated_by_fkey'
          AND conrelid = 'public.guest_segments'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.guest_segments
    ADD CONSTRAINT guest_segments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL$ddl$;
    END IF;

    -- Campaign audience targeting.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'email_campaigns'
          AND column_name = 'segment_id'
    ) THEN
        EXECUTE $ddl$ALTER TABLE public.email_campaigns
    ADD COLUMN segment_id bigint$ddl$;
    END IF;

    IF to_regclass('public.idx_email_campaigns_segment') IS NULL THEN
        EXECUTE $ddl$CREATE INDEX idx_email_campaigns_segment ON public.email_campaigns USING btree (segment_id) WHERE (segment_id IS NOT NULL)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'email_campaigns_segment_id_fkey'
          AND conrelid = 'public.email_campaigns'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.guest_segments(id) ON DELETE RESTRICT$ddl$;
    END IF;

    -- Permissions + route policy. Segments stay admin-only, matching the
    -- campaigns workspace (manager holds neither promotions nor segments).
    INSERT INTO public.permissions (name, resource, action, description, is_system_permission)
    VALUES
        ('segments:read', 'segments', 'read', 'View guest segments and segment previews', true),
        ('segments:manage', 'segments', 'manage', 'Create and manage guest segments', true),
        ('navigation_segments:read', 'navigation:segments', 'read', 'Show Segments navigation', true)
    ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        resource = EXCLUDED.resource,
        action = EXCLUDED.action,
        is_system_permission = EXCLUDED.is_system_permission;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.name IN ('admin', 'super_admin')
      AND p.name IN ('segments:read', 'segments:manage', 'navigation_segments:read')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO public.route_access_policies (
        route_id, path, nav_label, nav_group, required_permissions, required_roles,
        excluded_roles, nav_permissions, nav_roles, nav_excluded_roles,
        is_navigation, is_system_policy
    )
    VALUES (
        'segments', '/segments', 'Segments', 'revenue',
        '["segments:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
        '["navigation_segments:read","segments:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
        true, true
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
END;
$guest_segments$;
