# Hotel App PostgreSQL Resources

PostgreSQL is the application's only database engine.

```text
database/postgres/
├── migrations/0001_v1_baseline.sql
├── data.sql
├── seed.sql
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

## PostgreSQL 19 Beta 2 optimization

The files under `postgres/optimization/` are opt-in, benchmark-gated profiles:

```bash
make db-pg19-tune DATABASE_URL="$DATABASE_URL"
make db-pg19-benchmark DATABASE_URL="$DATABASE_URL"
make db-pg19-tune-rollback DATABASE_URL="$DATABASE_URL"
```

PostgreSQL 19 Beta 2 is prerelease software for testing, not production.

## Docker and desktop

Docker and desktop bundles use the same V1 sequence: baseline, data, then seed,
only for a new empty PostgreSQL database. The desktop launcher does not alter a
non-empty unversioned database. Recovery is a manual, backup-first operation.
Optimization scripts are never bundled or applied automatically.
