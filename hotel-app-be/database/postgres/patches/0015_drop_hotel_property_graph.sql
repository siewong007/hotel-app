-- Drop the SQL/PGQ property graph `public.hotel_graph` from installed databases.
--
-- PostgreSQL 19 Beta 4 reverted SQL/PGQ support, and the revert carries into
-- the release candidate and GA: those servers reject every PROPERTY GRAPH
-- statement as a syntax error. Nothing in the application queried the graph,
-- but databases created from the earlier V1 baseline still hold it, and a
-- pg_dump taken on 19beta3 replays CREATE PROPERTY GRAPH, so restoring that
-- dump onto beta4 or later fails. Fresh installs no longer create the graph.
-- Apply this while the database is still on 19beta3, before the engine move.
--
-- The DROP goes through EXECUTE on purpose: PL/pgSQL syntax-checks a static
-- statement when it compiles the block, even in a branch that never runs, so
-- a literal DROP PROPERTY GRAPH would fail on a server without SQL/PGQ. There
-- no relation can have relkind 'g', the guard is false, and this patch only
-- records its revision. The DROP keeps the default RESTRICT: an object built
-- on the graph makes the patch fail rather than vanish with it. Idempotent.

DO $drop_hotel_graph$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'hotel_graph'
          AND relation.relkind = 'g'
    ) THEN
        EXECUTE 'DROP PROPERTY GRAPH public.hotel_graph';
    END IF;
END
$drop_hotel_graph$;
