-- Guest Relations: interaction log fields on guest_notes, preference upsert
-- key, service_request/complaint support categories, guests:reveal permission,
-- and route policies for the /guest-relations workspace.
--
-- The DDL below is byte-identical to the block added to the V1 baseline for
-- fresh installs. Every step is individually guarded.
DO $guest_relations$
BEGIN
    IF to_regclass('public.guest_notes') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: guest_notes is missing';
    END IF;
    IF to_regclass('public.guest_preferences') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: guest_preferences is missing';
    END IF;
    IF to_regclass('public.support_conversations') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: support_conversations is missing';
    END IF;
    IF to_regclass('public.system_settings') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: system_settings is missing';
    END IF;
    IF to_regclass('public.permissions') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: permissions is missing';
    END IF;
    IF to_regclass('public.roles') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: roles is missing';
    END IF;
    IF to_regclass('public.role_permissions') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: role_permissions is missing';
    END IF;
    IF to_regclass('public.route_access_policies') IS NULL THEN
        RAISE EXCEPTION 'guest_relations preflight failed: route_access_policies is missing';
    END IF;

    -- guest_notes becomes the guest interaction log.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='subject') THEN
        ALTER TABLE public.guest_notes ADD COLUMN subject character varying(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='interaction_type') THEN
        ALTER TABLE public.guest_notes
            ADD COLUMN interaction_type character varying(50) NOT NULL DEFAULT 'note';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='booking_id') THEN
        ALTER TABLE public.guest_notes ADD COLUMN booking_id bigint;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='follow_up_at') THEN
        ALTER TABLE public.guest_notes ADD COLUMN follow_up_at timestamp with time zone;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='follow_up_completed_at') THEN
        ALTER TABLE public.guest_notes ADD COLUMN follow_up_completed_at timestamp with time zone;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guest_notes' AND column_name='assigned_to') THEN
        ALTER TABLE public.guest_notes ADD COLUMN assigned_to bigint;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname='guest_notes_interaction_type_check'
          AND conrelid='public.guest_notes'::regclass) THEN
        ALTER TABLE public.guest_notes ADD CONSTRAINT guest_notes_interaction_type_check
            CHECK (interaction_type IN ('note','call','email','in_person','follow_up'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='idx_guest_notes_guest_created') THEN
        CREATE INDEX idx_guest_notes_guest_created
            ON public.guest_notes (guest_id, created_at DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='idx_guest_notes_follow_up_open') THEN
        CREATE INDEX idx_guest_notes_follow_up_open
            ON public.guest_notes (follow_up_at)
            WHERE follow_up_at IS NOT NULL AND follow_up_completed_at IS NULL;
    END IF;

    -- Preference upsert key. Dedup defensively before creating the index.
    DELETE FROM public.guest_preferences a
    USING public.guest_preferences b
    WHERE a.guest_id = b.guest_id AND a.category = b.category
      AND a.preference_key = b.preference_key AND a.id < b.id;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='uq_guest_preferences_key') THEN
        CREATE UNIQUE INDEX uq_guest_preferences_key
            ON public.guest_preferences (guest_id, category, preference_key);
    END IF;

    -- Support categories: service_request + complaint ride the same workflow.
    ALTER TABLE public.support_conversations
        DROP CONSTRAINT IF EXISTS support_conversations_category_check;
    ALTER TABLE public.support_conversations
        ADD CONSTRAINT support_conversations_category_check
        CHECK (category IN ('booking','stay','billing','loyalty','technical','other','service_request','complaint'));

    UPDATE public.system_settings
    SET value = '["booking","stay","billing","loyalty","technical","other","service_request","complaint"]',
        updated_at = CURRENT_TIMESTAMP
    WHERE key = 'support_categories'
      AND position('"service_request"' in value) = 0;

    -- Sensitive guest field reveal permission; admin/super_admin pick it up via
    -- their all-permissions grant. Manager explicitly.
    INSERT INTO public.permissions (name, resource, action, description, is_system_permission)
    VALUES ('guests:reveal', 'guests', 'reveal',
            'Reveal sensitive guest identification fields', true)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
    WHERE r.name IN ('admin','super_admin','manager') AND p.name = 'guests:reveal'
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- Navigation policies for the Guest Relations workspace.
    INSERT INTO public.route_access_policies (
        route_id, path, nav_label, nav_group, required_permissions, required_roles,
        excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy
    ) VALUES
        ('guest-relations', '/guest-relations/guests', 'Guest Relations', 'operations',
         '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
         '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
        ('guest-relations-detail', '/guest-relations/guests/$guestId', NULL, NULL,
         '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
         '[]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, false, true)
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
$guest_relations$;
