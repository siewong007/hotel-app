DO $google_subject_preflight$
DECLARE
    found_type text;
    found_length integer;
    found_nullable text;
    found_index text;
    expected_index constant text :=
        'CREATE UNIQUE INDEX uq_users_google_subject ON public.users USING btree (google_subject) WHERE (google_subject IS NOT NULL)';
BEGIN
    SELECT data_type, character_maximum_length, is_nullable
    INTO found_type, found_length, found_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'google_subject';

    IF found_type IS NOT NULL AND
       (found_type <> 'character varying' OR found_length <> 255 OR found_nullable <> 'YES') THEN
        RAISE EXCEPTION 'users.google_subject has incompatible shape: type %, length %, nullable %',
            found_type, found_length, found_nullable;
    END IF;

    SELECT pg_get_indexdef(to_regclass('public.uq_users_google_subject')) INTO found_index;
    IF found_index IS NOT NULL AND found_index <> expected_index THEN
        RAISE EXCEPTION 'uq_users_google_subject has incompatible definition: %', found_index;
    END IF;
END;
$google_subject_preflight$;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS google_subject character varying(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_subject
    ON public.users USING btree (google_subject)
    WHERE google_subject IS NOT NULL;
