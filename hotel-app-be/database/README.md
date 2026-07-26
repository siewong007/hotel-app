# Hotel App PostgreSQL Resources

PostgreSQL is the application's only database engine.

```text
database/postgres/
├── migrations/0001_v1_baseline.sql
├── data.sql
├── seed.sql
├── patches/<date>-*.sql
├── upgrade/pg18_4_to_v1.sql
└── optimization/pg19_beta2*.sql
```

## V1 lifecycle

For a new PostgreSQL database, execute these files once in order:

```bash
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/data.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
```

`data.sql` creates required system and reference records. `seed.sql` creates
fresh-install bootstrap records. Neither file is a startup task or safe to
rerun against an existing V1 database.

`postgres/upgrade/pg18_4_to_v1.sql` is retained only for the controlled legacy
upgrade path referenced by `tests/status_vocabulary.rs`, the
`db-upgrade-pg18_4-to-v1` Make target, and desktop recovery messaging.
Dated files under `patches/` bring already-initialized V1 databases (including
one upgraded from 18.4) up to date; apply them in date order.

## PostgreSQL 19 physical design (2026-07-26)

The baseline is PG19-native: every bigint surrogate key is `GENERATED ALWAYS AS
IDENTITY` (original `<table>_<col>_seq` sequence names preserved, so
`pg_get_serial_sequence`, `setval` and direct sequence reads keep working),
generated columns are virtual (computed on read), and every persisted timestamp
is `timestamptz`. Explicit-id INSERTs — seeds, JSON imports, test fixtures —
must say `OVERRIDING SYSTEM VALUE`.

Existing V1 databases converge via
`patches/2026-07-26-pg19-native-physical-design.sql` (idempotent; interprets
the legacy naive ledger timestamps in the `system_settings` hotel timezone).
Apply it BEFORE starting a backend built at or after 2026-07-26: the backend
decodes the customer-ledger timestamp columns as `timestamptz` and refuses to
start against an unpatched database (startup schema guard in `main.rs`).

The baseline also defines `public.hotel_graph`, a native SQL/PGQ property
graph (guests/rooms/staff/companies vertices; bookings `stayed_in` and
user_guests `manages` edges) for `GRAPH_TABLE` multi-hop queries. It is pure
query surface over the existing tables — no storage, no application coupling.

## PostgreSQL 19 Beta 2 optimization

The files under `postgres/optimization/` are opt-in, benchmark-gated profiles:

```bash
make db-pg19-tune DATABASE_URL="$DATABASE_URL"
make db-pg19-benchmark DATABASE_URL="$DATABASE_URL"
make db-pg19-tune-rollback DATABASE_URL="$DATABASE_URL"
```

`make db-pg19-tune` also raises `autovacuum_max_parallel_workers` via
ALTER SYSTEM (the rollback target resets it) — without that cluster GUC the
profile's per-table `autovacuum_parallel_workers` settings are inert. For
online table rebuilds use `make db-repack TABLE=public.bookings` (PostgreSQL
19 `REPACK CONCURRENTLY`) or `make db-repack-full` in a maintenance window.

PostgreSQL 19 Beta 2 is prerelease software for testing, not production.

## Docker and desktop

Docker and desktop bundles use the same V1 sequence: baseline, data, then seed,
only for a new empty PostgreSQL database. The desktop launcher does not alter a
non-empty unversioned database. Recovery is a manual, backup-first operation.
Optimization scripts are never bundled or applied automatically.

The desktop bundle also ships the pg19 physical-design patch
(`sync-desktop-resources.mjs` mirrors it into `src-tauri/database/postgres/patches/`).
At startup, an existing V1 desktop database that still predates the patch is
backed up (`pg_dump` into the app's backups directory) and patched in place
before the backend sidecar launches, so the sidecar's schema guard passes.
