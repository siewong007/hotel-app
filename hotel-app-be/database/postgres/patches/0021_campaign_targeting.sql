-- Revenue & Marketing phase 3: campaign lifecycle + targeting.
--
-- Adds the terminal `cancelled` promotion status, staff-only `internal_code`
-- and `objective` columns, and the channel/loyalty-tier targeting join tables.
-- Ships the `promotions:approve` permission that gates publishing and moves the
-- `/promotions` route policy to `/campaigns` inside the revenue nav group.
--
-- Fresh installs get all of this from the V1 baseline + seed.sql; installed
-- databases need it delivered here. The DDL is byte-identical to the baseline
-- additions so `pg_dump --schema-only` of (baseline) and (older baseline +
-- this patch) must diff to nothing. Every step is individually guarded so
-- re-running is a no-op rather than an error.
DO $campaign_targeting$
BEGIN
    IF to_regclass('public.promotions') IS NULL THEN
        RAISE EXCEPTION 'campaign_targeting preflight failed: promotions is missing';
    END IF;
    IF to_regclass('public.booking_channels') IS NULL THEN
        RAISE EXCEPTION 'campaign_targeting preflight failed: booking_channels is missing';
    END IF;
    IF to_regclass('public.loyalty_tiers') IS NULL THEN
        RAISE EXCEPTION 'campaign_targeting preflight failed: loyalty_tiers is missing';
    END IF;

    -- Terminal `cancelled` status. Drop + re-add is the idempotent shape for a
    -- check-constraint change; nothing else enforces the status list.
    EXECUTE $ddl$ALTER TABLE ONLY public.promotions
    DROP CONSTRAINT IF EXISTS promotions_status_check$ddl$;
    EXECUTE $ddl$ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'paused'::character varying, 'cancelled'::character varying, 'archived'::character varying])::text[])))$ddl$;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'promotions'
          AND column_name = 'internal_code'
    ) THEN
        EXECUTE $ddl$ALTER TABLE public.promotions
    ADD COLUMN internal_code character varying(64)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'promotions'
          AND column_name = 'objective'
    ) THEN
        EXECUTE $ddl$ALTER TABLE public.promotions
    ADD COLUMN objective character varying(24)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotions_objective_check'
          AND conrelid = 'public.promotions'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_objective_check CHECK (((objective IS NULL) OR ((objective)::text = ANY ((ARRAY['occupancy'::character varying, 'acquisition'::character varying, 'retention'::character varying, 'upsell'::character varying, 'loyalty'::character varying, 'other'::character varying])::text[]))))$ddl$;
    END IF;

    IF to_regclass('public.promotions_internal_code_key') IS NULL THEN
        EXECUTE $ddl$CREATE UNIQUE INDEX promotions_internal_code_key ON public.promotions USING btree (internal_code) WHERE (internal_code IS NOT NULL)$ddl$;
    END IF;

    -- Targeting join tables.
    IF to_regclass('public.promotion_channels') IS NULL THEN
        EXECUTE $ddl$CREATE TABLE public.promotion_channels (
    promotion_id bigint NOT NULL,
    booking_channel_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_channels_pkey'
          AND conrelid = 'public.promotion_channels'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotion_channels
    ADD CONSTRAINT promotion_channels_pkey PRIMARY KEY (promotion_id, booking_channel_id)$ddl$;
    END IF;

    IF to_regclass('public.idx_promotion_channels_channel') IS NULL THEN
        EXECUTE $ddl$CREATE INDEX idx_promotion_channels_channel ON public.promotion_channels USING btree (booking_channel_id, promotion_id)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_channels_promotion_id_fkey'
          AND conrelid = 'public.promotion_channels'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotion_channels
    ADD CONSTRAINT promotion_channels_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_channels_booking_channel_id_fkey'
          AND conrelid = 'public.promotion_channels'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotion_channels
    ADD CONSTRAINT promotion_channels_booking_channel_id_fkey FOREIGN KEY (booking_channel_id) REFERENCES public.booking_channels(id) ON DELETE RESTRICT$ddl$;
    END IF;

    IF to_regclass('public.promotion_loyalty_tiers') IS NULL THEN
        EXECUTE $ddl$CREATE TABLE public.promotion_loyalty_tiers (
    promotion_id bigint NOT NULL,
    loyalty_tier_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_loyalty_tiers_pkey'
          AND conrelid = 'public.promotion_loyalty_tiers'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotion_loyalty_tiers
    ADD CONSTRAINT promotion_loyalty_tiers_pkey PRIMARY KEY (promotion_id, loyalty_tier_id)$ddl$;
    END IF;

    IF to_regclass('public.idx_promotion_loyalty_tiers_tier') IS NULL THEN
        EXECUTE $ddl$CREATE INDEX idx_promotion_loyalty_tiers_tier ON public.promotion_loyalty_tiers USING btree (loyalty_tier_id, promotion_id)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_loyalty_tiers_promotion_id_fkey'
          AND conrelid = 'public.promotion_loyalty_tiers'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotion_loyalty_tiers
    ADD CONSTRAINT promotion_loyalty_tiers_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_loyalty_tiers_loyalty_tier_id_fkey'
          AND conrelid = 'public.promotion_loyalty_tiers'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.promotion_loyalty_tiers
    ADD CONSTRAINT promotion_loyalty_tiers_loyalty_tier_id_fkey FOREIGN KEY (loyalty_tier_id) REFERENCES public.loyalty_tiers(id) ON DELETE RESTRICT$ddl$;
    END IF;

    -- Publish approval gate. `promotions:manage` implies it via the
    -- <resource>:manage derivation, so existing holders keep working; the
    -- standalone permission enables an approve-only role later.
    INSERT INTO public.permissions (name, resource, action, description, is_system_permission)
    VALUES
        ('promotions:approve', 'promotions', 'approve', 'Approve and publish campaigns', true)
    ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        resource = EXCLUDED.resource,
        action = EXCLUDED.action,
        is_system_permission = EXCLUDED.is_system_permission;

    -- The /promotions workspace moves to /campaigns in the revenue nav group.
    DELETE FROM public.route_access_policies WHERE route_id = 'promotions';
    INSERT INTO public.route_access_policies (
        route_id, path, nav_label, nav_group, required_permissions, required_roles,
        excluded_roles, nav_permissions, nav_roles, nav_excluded_roles,
        is_navigation, is_system_policy
    )
    VALUES (
        'campaigns', '/campaigns', 'Campaigns', 'revenue',
        '["promotions:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        '["navigation_promotions:read","promotions:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
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
$campaign_targeting$;
