# Hotel App Database Resources

Database resources are versioned by engine. V1 is the only active schema
version for both PostgreSQL and SQLite.

```text
database/
├── postgres/
│   ├── migrations/0001_v1_baseline.sql
│   ├── data.sql
│   ├── seed.sql
│   ├── upgrade/pg18_4_to_v1.sql
│   └── optimization/pg19_beta2*.sql
└── sqlite/
    ├── migrations/0001_v1_baseline.sql
    ├── data.sql
    └── seed.sql
```

## V1 lifecycle

For a new PostgreSQL database, execute these files once and in this exact
order:

```bash
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/data.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
```

`data.sql` creates required system and reference records. `seed.sql` creates
fresh-install bootstrap records. Neither is a startup task and neither should
be rerun against an existing V1 database.

SQLite embeds the equivalent V1 baseline, data, and seed resources in the
backend. They execute together only when a new empty SQLite database is first
opened. Existing V1 SQLite databases are verified and left unchanged. There is
no SQLite legacy migration or adoption flow.

V1 identifies the lifecycle version, not byte-for-byte engine parity. SQLite
keeps the application's lightweight/offline table shapes where handlers use
engine-specific SQL, while PostgreSQL keeps server-only operational models and
partitioning. `scripts/check-schema-drift.mjs` therefore remains a review
report for known engine differences; new domain changes must align both engines
or document an intentional exception instead of copying PostgreSQL DDL blindly.

The only historical upgrade supported here is the important PostgreSQL 18.4
database: first take and verify a logical backup, restore it into a PostgreSQL
19 Beta 2 cluster, then execute `postgres/upgrade/pg18_4_to_v1.sql`, followed
once by `postgres/data.sql` and `postgres/seed.sql`. Do not use that script for
other databases.

## PostgreSQL 19 Beta 2 optimization

`postgres/optimization/pg19_beta2.sql` is an opt-in, benchmark-gated profile
for physical storage, statistics, and autovacuum. Use its matching benchmark
and rollback files to measure a development workload before retaining it:

```bash
make db-pg19-tune DATABASE_URL="$DATABASE_URL"
make db-pg19-benchmark DATABASE_URL="$DATABASE_URL"
make db-pg19-tune-rollback DATABASE_URL="$DATABASE_URL"
```

PostgreSQL 19 Beta 2 is prerelease software for testing, not production.

## Docker and desktop

The Docker entrypoint and desktop resource bundle use the same V1 sequence:
baseline, data, then seed, only for a new empty database. The desktop launcher
does not alter a non-empty, unversioned database; the controlled PostgreSQL
18.4 upgrade remains a manual, backup-first operation. Optimization scripts are
never bundled or applied automatically.
