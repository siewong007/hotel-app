-- Staff notification bell for databases created before the table existed.
--
-- Fresh installs create `staff_notifications` in the V1 baseline. Databases
-- that were already running when that table was folded into the baseline
-- never received a patch for it, so a guest support message or a bank-transfer
-- claim fails with "relation staff_notifications does not exist". Idempotent:
-- a database that already has the tables is unchanged.

CREATE TABLE IF NOT EXISTS public.staff_notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    audience_permission character varying(100) NOT NULL,
    kind character varying(50) NOT NULL,
    subject character varying(200),
    title character varying(300) NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_notifications_audience
    ON public.staff_notifications USING btree (audience_permission, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_notifications_kind_subject
    ON public.staff_notifications USING btree (kind, subject, created_at DESC);

CREATE TABLE IF NOT EXISTS public.staff_notification_reads (
    notification_id bigint NOT NULL REFERENCES public.staff_notifications(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (notification_id, user_id)
);
