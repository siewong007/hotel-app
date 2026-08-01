# Hotel App PostgreSQL Resources

PostgreSQL is the application's only database engine.

```text
database/postgres/
├── migrations/0001_v1_baseline.sql
├── seed.sql
└── optimization/pg19_beta2*.sql
```

Those two SQL files are the whole install set. Nothing here reads a second
migration file, so an additional `000N_*.sql` would never be applied — see
"Same-generation additive changes" below for where such a change actually goes.

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

## Same-generation additive changes

The baseline is the single source of truth: a new column or index is added to
`migrations/0001_v1_baseline.sql`, so every fresh install — CI, Docker, desktop,
deploy — receives it automatically.

This directory stays two files. There is no `patches/`, `upgrade/` or `data.sql`
directory, and `tests/status_vocabulary.rs::postgres_initialization_has_only_baseline_and_seed`
enforces that — adding one turns the suite red.

A database already on the current V1 generation cannot re-run the baseline, so an
additive change (new nullable column, new index, new bootstrap row) also needs a
one-time operator step. Document it as runnable SQL under "Database Setup" in
[`docs/guides/deployment.md`](../../docs/guides/deployment.md), dated, stating
that fresh installs need nothing. Anything that retypes or drops an existing
object is a schema-generation change and follows the rebuild path above instead.

Before shipping such a change, prove convergence: scratch-install the new
baseline + seed, scratch-install the previous baseline + seed + your SQL, then
`pg_dump --schema-only --no-owner --no-privileges` both and diff. The diff must
be empty — and check the dumps are non-trivial first, because two failed dumps
also diff to zero. Declare a new column in the position `ALTER TABLE ADD COLUMN`
produces (last in the table body) or fresh and patched schemas diverge forever.

Nothing is applied automatically anywhere — the desktop launcher in particular
never alters an existing database.

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
