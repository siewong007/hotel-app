-- Channel pricing & distribution cost management.
--
-- Adds the channel-manager-ready pricing model on top of booking_channels:
-- effective-dated selling-price rules (channel_pricing_rules), effective-dated
-- commission overrides (channel_commission_rules), integration mapping tables
-- (channel_room_type_mappings / channel_rate_plan_mappings), channel identity
-- columns (abbreviation/code/integration_mode), the booking-time revenue
-- snapshot column (bookings.channel_pricing_snapshot), the dedicated
-- channels:* permission set, and the /channels route policy.
--
-- Fresh installs already carry every object from the V1 baseline; this patch
-- converges installed databases. All statements are idempotent: CREATE ... IF
-- NOT EXISTS, ADD COLUMN IF NOT EXISTS, DO-guarded constraint adds, and
-- ON CONFLICT inserts. booking_channels rows are intentionally untouched —
-- channels are hotel configuration, never seed data.

ALTER TABLE public.booking_channels
    ADD COLUMN IF NOT EXISTS abbreviation character varying(8),
    ADD COLUMN IF NOT EXISTS code character varying(40),
    ADD COLUMN IF NOT EXISTS integration_mode character varying(20) DEFAULT 'manual'::character varying NOT NULL;

DO $integration_mode_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'booking_channels'
          AND c.conname = 'booking_channels_integration_mode_check'
    ) THEN
        ALTER TABLE public.booking_channels
            ADD CONSTRAINT booking_channels_integration_mode_check
            CHECK ((integration_mode)::text = ANY ((ARRAY['manual'::character varying, 'channel_manager'::character varying, 'api'::character varying])::text[]));
    END IF;
END;
$integration_mode_check$;

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS channel_pricing_snapshot jsonb;

CREATE TABLE IF NOT EXISTS public.channel_pricing_rules (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id bigint NOT NULL REFERENCES public.booking_channels(id) ON DELETE CASCADE,
    room_type_id bigint REFERENCES public.room_types(id) ON DELETE CASCADE,
    rate_plan_id bigint REFERENCES public.rate_plans(id) ON DELETE CASCADE,
    rule_type character varying(24) NOT NULL,
    value numeric(12,2) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    min_price numeric(10,2),
    max_price numeric(10,2),
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    reason text,
    created_by bigint REFERENCES public.users(id),
    updated_by bigint REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT channel_pricing_rules_discount_range CHECK (((rule_type)::text <> 'discount_percent'::text) OR ((value >= (0)::numeric) AND (value <= (100)::numeric))),
    CONSTRAINT channel_pricing_rules_min_max_check CHECK (((min_price IS NULL) OR (max_price IS NULL) OR (min_price <= max_price))),
    CONSTRAINT channel_pricing_rules_type_check CHECK (((rule_type)::text = ANY ((ARRAY['markup_percent'::character varying, 'markup_fixed'::character varying, 'discount_percent'::character varying, 'fixed_price'::character varying, 'net_rate'::character varying])::text[]))),
    CONSTRAINT channel_pricing_rules_value_check CHECK ((value >= (0)::numeric)),
    CONSTRAINT channel_pricing_rules_window_check CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);

CREATE TABLE IF NOT EXISTS public.channel_commission_rules (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id bigint NOT NULL REFERENCES public.booking_channels(id) ON DELETE CASCADE,
    commission_type character varying(24) NOT NULL,
    value numeric(10,2) DEFAULT 0 NOT NULL,
    scope character varying(20) DEFAULT 'per_booking'::character varying NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    reason text,
    created_by bigint REFERENCES public.users(id),
    updated_by bigint REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT channel_commission_rules_percentage_range CHECK (((commission_type)::text <> 'percentage'::text) OR ((value >= (0)::numeric) AND (value <= (100)::numeric))),
    CONSTRAINT channel_commission_rules_scope_check CHECK (((scope)::text = ANY ((ARRAY['per_booking'::character varying, 'per_night'::character varying])::text[]))),
    CONSTRAINT channel_commission_rules_type_check CHECK (((commission_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed_amount'::character varying])::text[]))),
    CONSTRAINT channel_commission_rules_value_check CHECK ((value >= (0)::numeric)),
    CONSTRAINT channel_commission_rules_window_check CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);

CREATE TABLE IF NOT EXISTS public.channel_room_type_mappings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id bigint NOT NULL REFERENCES public.booking_channels(id) ON DELETE CASCADE,
    room_type_id bigint NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
    external_room_id character varying(100),
    external_room_name character varying(160),
    is_enabled boolean DEFAULT true NOT NULL,
    sync_status character varying(20),
    last_synced_at timestamp with time zone,
    created_by bigint REFERENCES public.users(id),
    updated_by bigint REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT channel_room_type_mappings_channel_id_room_type_id_key UNIQUE (channel_id, room_type_id)
);

CREATE TABLE IF NOT EXISTS public.channel_rate_plan_mappings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id bigint NOT NULL REFERENCES public.booking_channels(id) ON DELETE CASCADE,
    rate_plan_id bigint NOT NULL REFERENCES public.rate_plans(id) ON DELETE CASCADE,
    external_rate_plan_id character varying(100),
    external_rate_plan_name character varying(160),
    is_enabled boolean DEFAULT true NOT NULL,
    sync_status character varying(20),
    last_synced_at timestamp with time zone,
    created_by bigint REFERENCES public.users(id),
    updated_by bigint REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT channel_rate_plan_mappings_channel_id_rate_plan_id_key UNIQUE (channel_id, rate_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_pricing_rules_window
    ON public.channel_pricing_rules USING btree (channel_id, room_type_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_channel_commission_rules_window
    ON public.channel_commission_rules USING btree (channel_id, effective_from, effective_to);

-- Dedicated permission resource so revenue managers can own channel pricing
-- without settings:update or rooms:write. Actions stay inside the baseline
-- valid_action vocabulary, so no constraint rebuild is needed.
INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('channels:read', 'channels', 'read', 'View booking channels, pricing rules, and price previews', true),
    ('channels:write', 'channels', 'write', 'Create and edit channels, pricing rules, commission rules, and integration mappings', true),
    ('channels:manage', 'channels', 'manage', 'Full channel management including activation, deactivation, and deletion', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin', 'manager')
  AND p.name LIKE 'channels:%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy
)
VALUES (
    'channels', '/channels', 'Channels', 'revenue',
    '["channels:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
    '["navigation_revenue:read","channels:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
    true, true
)
ON CONFLICT (route_id) DO UPDATE SET
    path = EXCLUDED.path,
    nav_label = EXCLUDED.nav_label,
    nav_group = EXCLUDED.nav_group,
    required_permissions = EXCLUDED.required_permissions,
    nav_permissions = EXCLUDED.nav_permissions,
    is_navigation = EXCLUDED.is_navigation,
    is_system_policy = EXCLUDED.is_system_policy,
    updated_at = CURRENT_TIMESTAMP;
