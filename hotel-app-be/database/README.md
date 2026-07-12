# Hotel App Database

The active PostgreSQL database setup is intentionally small:

```text
database/
├── schema.sql
├── data.sql
├── sqlite_schema.sql
├── sqlite_data.sql
├── pg19_speculative_tuning.sql
├── pg19_speculative_tuning_rollback.sql
└── pg19_benchmark.sql
```

## Scripts

- `schema.sql` creates or updates database objects. It is idempotent and contains the previous ordered schema history in one executable script.
- `data.sql` loads and maintains required system data. It validates system-owned seed records, quarantines invalid/obsolete system records in `app.invalid_data_quarantine`, preserves user-created and transactional data, and can be rerun.
- `sqlite_schema.sql` contains append-only, numbered SQLite DDL sections. The backend applies each pending section transactionally and records it in `hotel_schema_versions`.
- `sqlite_data.sql` contains SQLite system seeds, policy updates, status normalization, and guarded legacy backfills. It runs after the schema is current and is safe to rerun.
- `pg19_speculative_tuning.sql` applies opt-in physical storage, statistics, and autovacuum experiments after the base schema.
- `pg19_speculative_tuning_rollback.sql` removes those experiments without rewriting existing values.
- `pg19_benchmark.sql` captures live PostgreSQL 19 settings and representative `EXPLAIN` plans.

PostgreSQL 19 is currently a beta development target. Do not point this schema
or the speculative profile at a production database until PostgreSQL 19 reaches
general availability and the upgrade has been rehearsed against a backup.

## Local PostgreSQL

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/data.sql
```

## Speculative PostgreSQL 19 profile

Run the full development stack with the server and schema experiments enabled:

```bash
make docker-up-pg19-tuned
```

For an existing PostgreSQL 19 development database, apply, measure, and roll
back the schema-level profile explicitly:

```bash
make db-pg19-tune DATABASE_URL="$DATABASE_URL"
make db-pg19-benchmark DATABASE_URL="$DATABASE_URL"
make db-pg19-tune-rollback DATABASE_URL="$DATABASE_URL"
```

The Compose override intentionally avoids fixed memory sizes so the same
profile can be measured on a laptop or a small Oracle Ampere instance. Worker
counts and concurrency can be overridden with the `PG19_*` environment values
defined in `docker-compose.pg19-tuned.yml`.

## Docker

The base `docker-compose.yml` mounts only these two files into the Postgres entrypoint:

```text
01_schema.sql
02_data.sql
```

This keeps container initialization aligned with local/manual setup.

`docker-compose.pg19-tuned.yml` is an explicit development override. Its
one-shot tuner applies the opt-in SQL after the database is healthy and before
the backend starts.

## Desktop

The desktop resource sync copies only `schema.sql` and `data.sql` into the Tauri bundle. The desktop PostgreSQL launcher runs `schema.sql` and then `data.sql` on startup. Speculative tuning is never bundled automatically.

## SQLite

SQLite resources are embedded in the backend binary and applied automatically by
`create_pool`. Existing databases that used SQLx migrations are adopted by
importing successful `_sqlx_migrations` versions into `hotel_schema_versions`;
historical destructive sections are not replayed. Add future DDL as a new,
strictly increasing `-- @migration <version> <name>` section and keep all
rerunnable seed or backfill statements in `sqlite_data.sql`.
