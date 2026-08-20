\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE hotel_patch_context (
    generation integer NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL
) ON COMMIT DROP;

INSERT INTO hotel_patch_context (generation, version, name, checksum)
VALUES (:patch_generation, :patch_version, :'patch_name', :'patch_checksum');

SELECT pg_advisory_xact_lock(8246773601043201);

DO $patch_guard$
DECLARE
    expected_v1_checksum constant text :=
        'sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d';
    baseline_checksum text;
    recorded_checksum text;
    context_row hotel_patch_context%ROWTYPE;
BEGIN
    SELECT * INTO STRICT context_row FROM hotel_patch_context;
    SELECT checksum INTO baseline_checksum
    FROM public.hotel_schema_revisions
    WHERE generation = 1 AND version = 1;

    IF baseline_checksum IS DISTINCT FROM expected_v1_checksum THEN
        RAISE EXCEPTION 'unsupported V1 baseline checksum: %', COALESCE(baseline_checksum, '<missing>');
    END IF;

    SELECT checksum INTO recorded_checksum
    FROM public.hotel_schema_revisions
    WHERE generation = context_row.generation AND version = context_row.version;

    IF recorded_checksum IS NOT NULL AND recorded_checksum <> context_row.checksum THEN
        RAISE EXCEPTION 'patch %.% checksum mismatch: database %, catalog %',
            context_row.generation, context_row.version, recorded_checksum, context_row.checksum;
    END IF;
END;
$patch_guard$;

SELECT NOT EXISTS (
    SELECT 1
    FROM public.hotel_schema_revisions AS revision
    JOIN hotel_patch_context AS context
      ON revision.generation = context.generation
     AND revision.version = context.version
     AND revision.checksum = context.checksum
) AS hotel_patch_needed
\gset

\if :hotel_patch_needed
