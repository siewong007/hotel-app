-- Notifications v2 (email triggers): widen email_deliveries kinds/topics for
-- the checkout-receipt and pre-arrival-reminder transactional emails, and
-- seed the reminder's system-settings keys.
--
-- Idempotent re-issue pattern per 0004: fetch pg_get_constraintdef, RAISE on
-- missing/diverged definitions, DROP+ADD only when the live definition matches
-- the documented pre-patch state.

DO $notifications_email_triggers$
DECLARE
    found_definition text;

    kind_check_old constant text :=
        $def$CHECK (((kind)::text = ANY (ARRAY[('campaign'::character varying)::text, ('birthday_voucher'::character varying)::text, ('booking_confirmation'::character varying)::text])))$def$;

    kind_check_new constant text :=
        $def$CHECK (((kind)::text = ANY (ARRAY[('campaign'::character varying)::text, ('birthday_voucher'::character varying)::text, ('booking_confirmation'::character varying)::text, ('checkout_receipt'::character varying)::text, ('pre_arrival_reminder'::character varying)::text])))$def$;

    campaign_link_old constant text :=
        $def$CHECK (((((kind)::text = 'campaign'::text) AND (campaign_id IS NOT NULL)) OR (((kind)::text = ANY (ARRAY[('birthday_voucher'::character varying)::text, ('booking_confirmation'::character varying)::text])) AND (campaign_id IS NULL))))$def$;

    campaign_link_new constant text :=
        $def$CHECK (((((kind)::text = 'campaign'::text) AND (campaign_id IS NOT NULL)) OR (((kind)::text = ANY (ARRAY[('birthday_voucher'::character varying)::text, ('booking_confirmation'::character varying)::text, ('checkout_receipt'::character varying)::text, ('pre_arrival_reminder'::character varying)::text])) AND (campaign_id IS NULL))))$def$;

    topic_check_old constant text :=
        $def$CHECK (((topic)::text = ANY (ARRAY[('announcement'::character varying)::text, ('promotion'::character varying)::text, ('birthday_voucher'::character varying)::text, ('booking_confirmation'::character varying)::text])))$def$;

    topic_check_new constant text :=
        $def$CHECK (((topic)::text = ANY (ARRAY[('announcement'::character varying)::text, ('promotion'::character varying)::text, ('birthday_voucher'::character varying)::text, ('booking_confirmation'::character varying)::text, ('checkout_receipt'::character varying)::text, ('pre_arrival_reminder'::character varying)::text])))$def$;
BEGIN
    -- email_deliveries_kind_check ------------------------------------------------
    SELECT pg_get_constraintdef(c.oid) INTO found_definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'email_deliveries'
      AND c.conname = 'email_deliveries_kind_check';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'email_deliveries_kind_check has incompatible definition: <missing>';
    ELSIF found_definition = kind_check_old THEN
        EXECUTE $c$
            ALTER TABLE public.email_deliveries DROP CONSTRAINT email_deliveries_kind_check
        $c$;
        EXECUTE $c$
            ALTER TABLE public.email_deliveries
            ADD CONSTRAINT email_deliveries_kind_check CHECK (
                ((kind)::text = ANY (ARRAY[
                    ('campaign'::character varying)::text,
                    ('birthday_voucher'::character varying)::text,
                    ('booking_confirmation'::character varying)::text,
                    ('checkout_receipt'::character varying)::text,
                    ('pre_arrival_reminder'::character varying)::text
                ]))
            )
        $c$;
    ELSIF found_definition <> kind_check_new THEN
        RAISE EXCEPTION 'email_deliveries_kind_check has incompatible definition: %', found_definition;
    END IF;

    -- email_deliveries_kind_campaign_link ----------------------------------------
    SELECT pg_get_constraintdef(c.oid) INTO found_definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'email_deliveries'
      AND c.conname = 'email_deliveries_kind_campaign_link';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'email_deliveries_kind_campaign_link has incompatible definition: <missing>';
    ELSIF found_definition = campaign_link_old THEN
        EXECUTE $c$
            ALTER TABLE public.email_deliveries DROP CONSTRAINT email_deliveries_kind_campaign_link
        $c$;
        EXECUTE $c$
            ALTER TABLE public.email_deliveries
            ADD CONSTRAINT email_deliveries_kind_campaign_link CHECK (
                (
                    ((kind)::text = 'campaign'::text) AND (campaign_id IS NOT NULL)
                )
                OR (
                    ((kind)::text = ANY (ARRAY[
                        ('birthday_voucher'::character varying)::text,
                        ('booking_confirmation'::character varying)::text,
                        ('checkout_receipt'::character varying)::text,
                        ('pre_arrival_reminder'::character varying)::text
                    ]))
                    AND (campaign_id IS NULL)
                )
            )
        $c$;
    ELSIF found_definition <> campaign_link_new THEN
        RAISE EXCEPTION 'email_deliveries_kind_campaign_link has incompatible definition: %', found_definition;
    END IF;

    -- email_deliveries_topic_check ------------------------------------------------
    SELECT pg_get_constraintdef(c.oid) INTO found_definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'email_deliveries'
      AND c.conname = 'email_deliveries_topic_check';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'email_deliveries_topic_check has incompatible definition: <missing>';
    ELSIF found_definition = topic_check_old THEN
        EXECUTE $c$
            ALTER TABLE public.email_deliveries DROP CONSTRAINT email_deliveries_topic_check
        $c$;
        EXECUTE $c$
            ALTER TABLE public.email_deliveries
            ADD CONSTRAINT email_deliveries_topic_check CHECK (
                ((topic)::text = ANY (ARRAY[
                    ('announcement'::character varying)::text,
                    ('promotion'::character varying)::text,
                    ('birthday_voucher'::character varying)::text,
                    ('booking_confirmation'::character varying)::text,
                    ('checkout_receipt'::character varying)::text,
                    ('pre_arrival_reminder'::character varying)::text
                ]))
            )
        $c$;
    ELSIF found_definition <> topic_check_new THEN
        RAISE EXCEPTION 'email_deliveries_topic_check has incompatible definition: %', found_definition;
    END IF;
END;
$notifications_email_triggers$;

INSERT INTO public.system_settings (key, value)
VALUES ('pre_arrival_reminder_enabled', 'false'),
       ('pre_arrival_reminder_hours_before', '48')
ON CONFLICT (key) DO NOTHING;
