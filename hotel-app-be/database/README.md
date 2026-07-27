# Hotel App PostgreSQL Resources

PostgreSQL is the application's only database engine.

```text
database/postgres/
├── migrations/0001_v1_baseline.sql
├── seed.sql
├── patches/YYYY-MM-DD-<change>.sql
└── optimization/pg19_beta2*.sql
```

## V1 lifecycle

For a new PostgreSQL database, execute these files once in order:

```bash
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
```

`seed.sql` creates all required system/reference records and fresh-install
bootstrap records, then records the completed V1 revision. It is not a startup
task and is not safe to rerun against an existing V1 database.

Older database layouts are not upgraded in place. Export any data that must be
retained, initialize a fresh PostgreSQL 19 database from the current baseline
and seed, then import the compatible application data.

## Same-generation patches

The baseline is the single source of truth: a new column or index is added to
`migrations/0001_v1_baseline.sql`, so every fresh install — CI, Docker, desktop,
deploy — receives it automatically. A database that is already on the current
V1 generation cannot re-run the baseline, so each such change also ships an
additive, idempotent patch under `patches/`, applied by an operator:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/postgres/patches/2026-07-28-users-google-subject.sql
```

Patches are additive only (new nullable column, new index, new bootstrap row).
Anything that retypes or drops an existing object is a schema-generation change
and follows the rebuild path above instead. A patched database and a fresh
install must produce an identical `pg_dump --schema-only`; verify that before
shipping a patch. Patches are not applied automatically anywhere — the desktop
launcher in particular never alters an existing database.

## PostgreSQL 19 physical design (2026-07-26)

The baseline is PG19-native: every bigint surrogate key is `GENERATED ALWAYS AS
IDENTITY` (original `<table>_<col>_seq` sequence names preserved, so
`pg_get_serial_sequence`, `setval` and direct sequence reads keep working),
generated columns are virtual (computed on read), and every persisted timestamp
is `timestamptz`. Explicit-id INSERTs — seeds, JSON imports, test fixtures —
must say `OVERRIDING SYSTEM VALUE`.

The backend validates schema-critical columns and tables at startup. It refuses
legacy layouts rather than mutating them automatically.

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

Docker and desktop bundles use the same V1 sequence: baseline, then seed, only
for a new empty PostgreSQL database. The desktop launcher does not alter a
non-empty unversioned or legacy database. Recovery is a manual, backup-first
export and fresh rebuild. Optimization scripts are never bundled or applied
automatically.
