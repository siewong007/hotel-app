-- Multi-room guest bookings: `booking_groups` plus nullable
-- `bookings.booking_group_id`.
--
-- A group is one guest booking holding up to N rooms. Every room stays an
-- ordinary single-room `bookings` row, so room status, night audit, folios,
-- the same-room overlap constraint and every existing reader keep working;
-- the group carries the shared payment status, totals and unpaid-hold expiry.
-- Purely additive and backward-compatible: existing bookings keep a NULL
-- group id and behave exactly as before.
--
-- The import capability's table allowlist gains `public.booking_groups` so
-- data transfer can restore groups before their member bookings. Fresh
-- installs keep patch 0024's definition in the baseline (0024 guards it by
-- exact body), and this patch replaces it everywhere. Idempotent.

-- One guest booking that holds several rooms. Each room stays an ordinary
-- `bookings` row (room status, night audit, folio and the same-room overlap
-- constraint keep working per room); `bookings.booking_group_id` ties them to
-- this parent, which carries the shared payment state, the group-level
-- totals and the shared unpaid-hold expiry. Each member booking persists its
-- own allocated discount/credit/tax, so a single-room cancel or refund never
-- recomputes the group. Totals here are the sum over non-voided members.
CREATE TABLE IF NOT EXISTS public.booking_groups (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL UNIQUE,
    group_number character varying(50) NOT NULL UNIQUE,
    guest_id bigint NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
    check_in_date date NOT NULL,
    check_out_date date NOT NULL,
    source character varying(50) DEFAULT 'website'::character varying NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    payment_status character varying(30) DEFAULT 'unpaid'::character varying NOT NULL,
    payment_method character varying(100),
    room_count integer DEFAULT 0 NOT NULL,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    tourism_tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'MYR'::character varying NOT NULL,
    voucher_id bigint REFERENCES public.vouchers(id) ON DELETE SET NULL,
    hold_expires_at timestamp with time zone,
    portal_request_id character varying(128),
    created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT booking_groups_dates_check CHECK ((check_out_date > check_in_date)),
    CONSTRAINT booking_groups_room_count_check CHECK ((room_count >= 0)),
    CONSTRAINT booking_groups_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'voided'::character varying])::text[]))),
    CONSTRAINT booking_groups_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['unpaid'::character varying, 'unpaid_deposit'::character varying, 'paid_rate'::character varying, 'partial'::character varying, 'paid'::character varying, 'refunded'::character varying, 'void'::character varying])::text[])))
);

CREATE INDEX IF NOT EXISTS idx_booking_groups_guest ON public.booking_groups USING btree (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_groups_hold_expiry ON public.booking_groups USING btree (hold_expires_at)
    WHERE ((hold_expires_at IS NOT NULL) AND ((status)::text = 'active'::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_groups_portal_request ON public.booking_groups USING btree (guest_id, portal_request_id)
    WHERE (portal_request_id IS NOT NULL);

DO $booking_group_column$
DECLARE
    column_type text;
BEGIN
    SELECT format_type(atttypid, atttypmod) INTO column_type
    FROM pg_attribute
    WHERE attrelid = 'public.bookings'::regclass
      AND attname = 'booking_group_id'
      AND attnum > 0 AND NOT attisdropped;

    IF column_type IS NULL THEN
        ALTER TABLE public.bookings ADD COLUMN booking_group_id bigint;
    ELSIF column_type <> 'bigint' THEN
        RAISE EXCEPTION 'bookings.booking_group_id exists with unexpected type: %', column_type;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bookings_booking_group_id_fkey'
          AND conrelid = 'public.bookings'::regclass
    ) THEN
        ALTER TABLE ONLY public.bookings
            ADD CONSTRAINT bookings_booking_group_id_fkey FOREIGN KEY (booking_group_id)
            REFERENCES public.booking_groups(id) ON DELETE SET NULL;
    END IF;
END
$booking_group_column$;

CREATE INDEX IF NOT EXISTS idx_bookings_booking_group ON public.bookings USING btree (booking_group_id)
    WHERE (booking_group_id IS NOT NULL);

COMMENT ON COLUMN public.bookings.booking_group_id IS 'Parent multi-room booking group; NULL for a standalone single-room booking.';

DO $transfer_ddl_guard$
DECLARE
    function_body_hash text;
BEGIN
    SELECT md5(prosrc) INTO function_body_hash
    FROM pg_proc
    WHERE oid = 'public.transfer_import_ddl(text,text,text,text)'::regprocedure;
    IF function_body_hash NOT IN ('95a60fa200b86b990d989cddde138290', '8645775b1cddda21221ff56c9e90241f') THEN
        RAISE EXCEPTION 'Unexpected pre-existing transfer_import_ddl definition';
    END IF;
END
$transfer_ddl_guard$;

-- Table allowlist mirrors data_transfer/service.rs.
CREATE OR REPLACE FUNCTION public.transfer_import_ddl(p_schema text, p_table text, p_action text, p_constraint text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    target oid;
BEGIN
    IF p_schema IS NULL OR p_table IS NULL OR NOT (p_schema || '.' || p_table = ANY(ARRAY[
        'app.invalid_data_quarantine',
        'public.amenities',
        'public.audit_logs',
        'public.booking_channels',
        'public.booking_groups',
        'public.booking_guests',
        'public.booking_history',
        'public.booking_modifications',
        'public.booking_services',
        'public.bookings',
        'public.channel_commission_rules',
        'public.channel_pricing_rules',
        'public.channel_rate_plan_mappings',
        'public.channel_room_type_mappings',
        'public.companies',
        'public.consent_records',
        'public.corporate_account_contacts',
        'public.corporate_accounts',
        'public.customer_ledger_payments',
        'public.customer_ledgers',
        'public.ekyc_access_events',
        'public.ekyc_decision_history',
        'public.ekyc_idempotency_keys',
        'public.ekyc_notes',
        'public.ekyc_reason_codes',
        'public.ekyc_sensitive_reveals',
        'public.ekyc_verifications',
        'public.email_campaigns',
        'public.email_deliveries',
        'public.email_suppressions',
        'public.email_templates',
        'public.guest_complimentary_credits',
        'public.guest_documents',
        'public.guest_notes',
        'public.guest_portal_sessions',
        'public.guest_preferences',
        'public.guest_reviews',
        'public.guest_segments',
        'public.guests',
        'public.housekeeping_tasks',
        'public.invoices',
        'public.job_runs',
        'public.loyalty_accounts',
        'public.loyalty_members',
        'public.loyalty_memberships',
        'public.loyalty_program_rules',
        'public.loyalty_programs',
        'public.loyalty_redemptions',
        'public.loyalty_rewards',
        'public.loyalty_tiers',
        'public.loyalty_transactions',
        'public.maintenance_tickets',
        'public.night_audit_details',
        'public.night_audit_posted_nights',
        'public.night_audit_runs',
        'public.notification_consent_events',
        'public.notification_subscriptions',
        'public.online_inventory_allocations',
        'public.passkey_challenges',
        'public.passkeys',
        'public.payment_receipt_requests',
        'public.payment_retry_capabilities',
        'public.payments',
        'public.permissions',
        'public.points_transactions',
        'public.promotion_channels',
        'public.promotion_loyalty_tiers',
        'public.promotion_room_types',
        'public.promotions',
        'public.rate_limit_buckets',
        'public.rate_plans',
        'public.refresh_tokens',
        'public.reward_catalog',
        'public.reward_redemptions',
        'public.role_permissions',
        'public.roles',
        'public.room_changes',
        'public.room_events',
        'public.room_history',
        'public.room_rates',
        'public.room_status_change_log',
        'public.room_status_transitions',
        'public.room_type_amenities',
        'public.room_types',
        'public.rooms',
        'public.route_access_policies',
        'public.self_checkin_events',
        'public.services',
        'public.staff_notification_reads',
        'public.staff_notifications',
        'public.support_action_idempotency_keys',
        'public.support_conversations',
        'public.support_events',
        'public.support_guest_request_idempotency_keys',
        'public.support_messages',
        'public.system_settings',
        'public.team_members',
        'public.team_roles',
        'public.teams',
        'public.two_factor_challenges',
        'public.user_guests',
        'public.user_permissions',
        'public.user_roles',
        'public.user_sessions',
        'public.users',
        'public.voucher_redemption_allocations',
        'public.voucher_redemptions',
        'public.vouchers'
    ])) THEN
        RAISE EXCEPTION 'Table is not eligible for import' USING ERRCODE = '42501';
    END IF;
    SELECT c.oid INTO target FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=p_schema AND c.relname=p_table AND c.relkind IN ('r','p')
      AND NOT c.relispartition AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid);
    IF target IS NULL THEN
        RAISE EXCEPTION 'Table is not owned by the import capability owner' USING ERRCODE = '42501';
    END IF;
    IF p_action IN ('triggers_on','triggers_off') AND p_constraint IS NULL THEN
        EXECUTE format('ALTER TABLE %I.%I %s TRIGGER USER', p_schema, p_table,
            CASE p_action WHEN 'triggers_on' THEN 'ENABLE' ELSE 'DISABLE' END);
    ELSIF p_action IN ('fk_defer','fk_immediate') AND EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid=target AND conname=p_constraint AND contype='f'
    ) THEN
        EXECUTE format('ALTER TABLE %I.%I ALTER CONSTRAINT %I %s', p_schema, p_table, p_constraint,
            CASE p_action WHEN 'fk_defer' THEN 'DEFERRABLE INITIALLY DEFERRED'
            ELSE 'NOT DEFERRABLE INITIALLY IMMEDIATE' END);
    ELSE
        RAISE EXCEPTION 'Invalid import DDL operation or foreign key' USING ERRCODE = '22023';
    END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.transfer_import_ddl(text,text,text,text) FROM PUBLIC;
