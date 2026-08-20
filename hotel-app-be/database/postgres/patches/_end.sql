INSERT INTO public.hotel_schema_revisions (generation, version, name, checksum, app_build)
SELECT generation, version, name, checksum, NULL
FROM hotel_patch_context;
\echo applied patch :patch_generation.:patch_version :patch_name
\else
\echo skipped patch :patch_generation.:patch_version :patch_name
\endif

COMMIT;
