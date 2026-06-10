-- ============================================================================
-- MIGRATION 015: PG 18 EXTENSIONS, uuidv7(), HARDENING
-- ============================================================================
-- Description:
--   * Enables observability + text-search extensions (defensive — bundled
--     desktop PostgreSQL may not have them; each CREATE is wrapped).
--   * Adds gen_uuidv7() helper that prefers PostgreSQL 18's native uuidv7()
--     and falls back to gen_random_uuid() on older clusters. New tables
--     should default UUID columns to gen_uuidv7().
--   * Hardens update_updated_at_column() with a pinned search_path.
--
-- Postgres-only. SQLite migrations are unaffected.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions (defensive — bundled desktop builds may omit them)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_stat_statements not available — query observability disabled';
END
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available — fuzzy text search GIN indexes will not be created';
END
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "btree_gin";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gin not available — mixed-type GIN indexes will not be created';
END
$$;

-- ----------------------------------------------------------------------------
-- gen_uuidv7() — prefers PG 18 native uuidv7(), falls back to v4
-- ----------------------------------------------------------------------------
-- New code should reference gen_uuidv7() so existing rows continue to use
-- whatever default they had, and new inserts pick up the better algorithm
-- whenever uuidv7() exists in the server.
CREATE OR REPLACE FUNCTION gen_uuidv7()
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- PG 18+: prefer native uuidv7()
    RETURN uuidv7();
EXCEPTION
    WHEN undefined_function THEN
        -- Fallback for older servers (older bundled desktop builds, dev VMs)
        RETURN gen_random_uuid();
END;
$$;

COMMENT ON FUNCTION gen_uuidv7() IS
    'Time-ordered UUIDv7 (PostgreSQL 18+) with a v4 fallback for older clusters. '
    'Prefer this for new UUID column defaults so writes land sequentially in btree pages.';

-- ----------------------------------------------------------------------------
-- Harden update_updated_at_column() with a pinned search_path
-- ----------------------------------------------------------------------------
-- The previous definition picked up search_path from the caller, which is a
-- mild function-hijack vector and lints warn about it. Behavior is unchanged.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;
