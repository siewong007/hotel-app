-- Guest nickname: the anonymous booking identifier gets its real name.
--
-- `guests.full_name` never held a legal name for anonymous bookers. It held the
-- single unique string a guest typed to hold a room, while the legal first and
-- last name are collected later, at check-in. Calling that column `full_name`
-- made every reader assume the opposite, and it read as a sibling of the
-- genuinely legal `users.full_name` and `ekyc_verifications.full_name`, which
-- this patch deliberately leaves alone.
--
-- The rename is pure catalog metadata: no row is rewritten and the unique index
-- keeps its `lower(trim(...))` expression. Three dependent objects behave
-- differently, and a pg_dump convergence diff against a fresh install is what
-- proved it:
--
--   * `booking_summary` tracks the column by attribute number, so PostgreSQL
--     re-renders the view automatically -- nothing to do here.
--   * the NOT NULL constraint keeps its generated name. RENAME COLUMN leaves
--     `guests_full_name_not_null` behind, while a fresh install calls it
--     `guests_nick_name_not_null`, so it is renamed explicitly below.
--   * `hotel_graph` stores the exposed PROPERTY NAME, not just the column, so
--     after the rename it renders `nick_name AS full_name`. There is no ALTER
--     for a property rename, so the graph is dropped and recreated verbatim
--     from the baseline definition.
--
-- The result is byte-identical to the block in the V1 baseline used by fresh
-- installs, so `pg_dump --schema-only` of (baseline) and (older baseline + this
-- patch) must diff to nothing.
--
-- Every step is individually guarded, so re-running the patch on a database
-- that has already been renamed is a no-op rather than an error.
DO $guest_nick_name$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'guests'
    ) THEN
        RAISE EXCEPTION 'guest_nick_name preflight failed: guests is missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guests'
          AND column_name = 'full_name'
    ) THEN
        ALTER TABLE public.guests RENAME COLUMN full_name TO nick_name;
    END IF;

    IF to_regclass('public.idx_guests_full_name') IS NOT NULL THEN
        ALTER INDEX public.idx_guests_full_name RENAME TO idx_guests_nick_name;
    END IF;

    IF to_regclass('public.idx_guests_full_name_trgm') IS NOT NULL THEN
        ALTER INDEX public.idx_guests_full_name_trgm RENAME TO idx_guests_nick_name_trgm;
    END IF;

    IF to_regclass('public.idx_guests_full_name_unique') IS NOT NULL THEN
        ALTER INDEX public.idx_guests_full_name_unique RENAME TO idx_guests_nick_name_unique;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.guests'::regclass
          AND contype = 'n'
          AND conname = 'guests_full_name_not_null'
    ) THEN
        ALTER TABLE public.guests
            RENAME CONSTRAINT guests_full_name_not_null TO guests_nick_name_not_null;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_propgraph_property WHERE pgpname = 'full_name'
    ) THEN
        EXECUTE $ddl$DROP PROPERTY GRAPH public.hotel_graph$ddl$;
        EXECUTE $ddl$CREATE PROPERTY GRAPH public.hotel_graph
    VERTEX TABLES (
        public.companies KEY (id) LABEL company PROPERTIES (company_name, id),
        public.guests KEY (id) LABEL guest PROPERTIES (email, id, nick_name),
        public.rooms KEY (id) LABEL room PROPERTIES (id, room_number),
        public.users KEY (id) LABEL staff PROPERTIES (id, username)
    )
    EDGE TABLES (
        public.bookings KEY (id) SOURCE KEY (guest_id) REFERENCES guests (id) DESTINATION KEY (room_id) REFERENCES rooms (id) LABEL stayed_in PROPERTIES (check_in_date, check_out_date, id, status),
        public.user_guests KEY (id) SOURCE KEY (user_id) REFERENCES users (id) DESTINATION KEY (guest_id) REFERENCES guests (id) LABEL manages PROPERTIES (id, relationship_type)
    )$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guests'
          AND column_name = 'nick_name'
    ) THEN
        RAISE EXCEPTION 'guest_nick_name failed: guests.nick_name is missing after the rename';
    END IF;
END;
$guest_nick_name$;
