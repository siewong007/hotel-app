-- Restricted runtime capabilities. Table allowlist mirrors data_transfer/service.rs.
-- No general SQL, ownership, or role switching is exposed to the runtime.
-- Fresh baseline installs already contain these definitions. Refuse to
-- replace an unexpected function with the same name on an existing database.
DO $capability_guard$
DECLARE
    expected_owner oid := current_user::regrole;
    function_body_hash text;
    function_owner oid;
    function_is_definer boolean;
    function_config text[];
BEGIN
    IF to_regprocedure('public.transfer_import_ddl(text,text,text,text)') IS NOT NULL THEN
        SELECT md5(prosrc), proowner, prosecdef, proconfig
        INTO function_body_hash, function_owner, function_is_definer, function_config
        FROM pg_proc
        WHERE oid = 'public.transfer_import_ddl(text,text,text,text)'::regprocedure;
        IF function_body_hash <> '95a60fa200b86b990d989cddde138290'
           OR function_owner <> expected_owner
           OR NOT function_is_definer
           OR function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[] THEN
            RAISE EXCEPTION 'Unexpected pre-existing transfer_import_ddl definition';
        END IF;
    END IF;
    IF to_regprocedure('public.maintain_audit_partition(date)') IS NOT NULL THEN
        SELECT md5(prosrc), proowner, prosecdef, proconfig
        INTO function_body_hash, function_owner, function_is_definer, function_config
        FROM pg_proc
        WHERE oid = 'public.maintain_audit_partition(date)'::regprocedure;
        IF function_body_hash <> '562266b3b2accba8763a64804f2edf58'
           OR function_owner <> expected_owner
           OR NOT function_is_definer
           OR function_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[] THEN
            RAISE EXCEPTION 'Unexpected pre-existing maintain_audit_partition definition';
        END IF;
    END IF;
END
$capability_guard$;

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

-- Keep the runtime capability aligned with the current partition upkeep
-- algorithm. The definer owns the required DDL rights; the application role
-- receives EXECUTE only through the deployment grant.
CREATE OR REPLACE FUNCTION public.maintain_audit_partition(p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    start_date date := date_trunc('month', p_month)::date;
    end_date date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
    part_name text := format('audit_logs_%s', to_char(start_date, 'YYYY_MM'));
    late_month boolean;
    partition_row record;
BEGIN
    IF p_month IS NULL OR NOT isfinite(p_month) THEN
        RAISE EXCEPTION 'Invalid partition month' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        late_month := EXISTS (
            SELECT 1
            FROM public.audit_logs_default
            WHERE created_at >= start_date::timestamptz
              AND created_at < end_date::timestamptz
        );
        IF late_month THEN
            EXECUTE 'ALTER TABLE public.audit_logs DETACH PARTITION public.audit_logs_default';
        END IF;
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
            part_name, start_date, end_date
        );
        IF late_month THEN
            WITH moved AS (
                DELETE FROM public.audit_logs_default
                WHERE created_at >= start_date::timestamptz
                  AND created_at < end_date::timestamptz
                RETURNING *
            )
            INSERT INTO public.audit_logs OVERRIDING SYSTEM VALUE
            SELECT * FROM moved;
            EXECUTE 'ALTER TABLE public.audit_logs ATTACH PARTITION public.audit_logs_default DEFAULT';
        END IF;
    END IF;
    -- TRUNCATE statement triggers are not cloned onto partitions. Keep this
    -- DDL inside the pinned SECURITY DEFINER capability so hotel_app does not
    -- need direct trigger privileges or EXECUTE on an invoker helper.
    FOR partition_row IN
        SELECT partition_schema.nspname AS schema_name,
               partition_table.relname AS table_name
        FROM pg_inherits AS link
        JOIN pg_class AS partition_table ON partition_table.oid = link.inhrelid
        JOIN pg_namespace AS partition_schema
          ON partition_schema.oid = partition_table.relnamespace
        WHERE link.inhparent = 'public.audit_logs'::regclass
          AND NOT EXISTS (
              SELECT 1
              FROM pg_trigger AS guard
              WHERE guard.tgrelid = partition_table.oid
                AND guard.tgname = 'trg_audit_logs_no_truncate'
          )
        ORDER BY partition_table.relname
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_mutation()',
            partition_row.schema_name, partition_row.table_name
        );
    END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.maintain_audit_partition(date) FROM PUBLIC;
