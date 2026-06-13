# Hotel App Database

The active PostgreSQL database setup is intentionally small:

```text
database/
├── schema.sql
└── data.sql
```

## Scripts

- `schema.sql` creates or updates database objects. It is idempotent and contains the previous ordered schema history in one executable script.
- `data.sql` loads and maintains required system data. It validates system-owned seed records, quarantines invalid/obsolete system records in `app.invalid_data_quarantine`, preserves user-created and transactional data, and can be rerun.

## Local PostgreSQL

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/data.sql
```

## Docker

`docker-compose.yml` mounts only these two files into the Postgres entrypoint:

```text
01_schema.sql
02_data.sql
```

This keeps container initialization aligned with local/manual setup.

## Desktop

The desktop resource sync copies only `schema.sql` and `data.sql` into the Tauri bundle. The desktop PostgreSQL launcher runs `schema.sql` and then `data.sql` on startup.

## Notes

The SQLite migration directory is retained only for the backend's separate SQLite feature path. It is not part of the PostgreSQL deployment workflow.
