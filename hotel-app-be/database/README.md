# Hotel App PostgreSQL Resources

PostgreSQL is the application's only database engine.

```text
database/postgres/
├── migrations/0001_v1_baseline.sql     # fresh install: schema
├── seed.sql                            # fresh install: system/bootstrap records
├── patches/manifest.tsv                # ordered, checksummed patch catalog
├── patches/_begin.sql                  # shared control: lock, guard, skip
├── patches/_end.sql                    # shared control: record, commit
├── patches/000N_<name>.sql             # one compatible convergence step each
├── apply-patches.sh                    # the only executor of the catalog
├── report-schema-drift.sh              # read-only schema comparison
└── optimization/pg19_beta2*.sql        # opt-in, benchmark-gated profiles
```

The baseline and seed install a **new** database. The patch catalog converges a
database that is **already** on V1. Nothing here discovers loose SQL: only files
listed in `patches/manifest.tsv` are ever executed, only in manifest order, and
only through `apply-patches.sh`. Dropping a `000N_*.sql` into `patches/` without
a manifest row leaves it dead.

## V1 lifecycle

Baseline → seed → patches. From the repository root, one command runs all
three against a new PostgreSQL database:

```bash
make db-setup DATABASE_URL="$DATABASE_URL"
```

The equivalent by hand, once and in this order:

```bash
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
make db-patch DATABASE_URL="$DATABASE_URL"
```

`seed.sql` creates all required system/reference records and fresh-install
bootstrap records, then records the completed V1 revision. It is not a startup
task and is not safe to rerun against an existing V1 database.

The patch step is what makes the two paths converge. A fresh install already has
every patched object from the baseline, so each patch detects its recorded
revision and reports `skipped`; the run exists to record the patch level, so
that database is afterwards indistinguishable from one that was patched forward.
Ordinary backend startup never applies patches — it validates the schema and
refuses layouts it does not recognize.

Older database layouts are not upgraded in place. Export any data that must be
retained, initialize a fresh PostgreSQL 19 database from the current baseline
and seed, then import the compatible application data.

## Same-generation additive changes

The baseline is the single source of truth: a new column or index is added to
`migrations/0001_v1_baseline.sql`, so every fresh install — CI, Docker, desktop,
deploy — receives it automatically.

A database already on the current V1 generation cannot re-run the baseline, so an
additive change (new nullable column, new index, new bootstrap row) needs a
second home: **the baseline for fresh installs, and a catalog patch for installed
databases.** Both, every time — a baseline-only change silently skips every live
database, and a patch-only change silently skips every fresh install.

`tests/status_vocabulary.rs::postgres_initialization_has_baseline_seed_and_ordered_patches`
pins the install set to baseline, seed and `patches/`; there is no `upgrade/` or
`data.sql` directory, and adding one turns the suite red. Anything that retypes
or drops an existing object is a schema-generation change and follows the rebuild
path above instead — it is not a compatible patch.

Before shipping such a change, prove convergence: scratch-install the new
baseline + seed, scratch-install the previous baseline + seed + your SQL, then
`pg_dump --schema-only --no-owner --no-privileges` both and diff. The diff must
be empty — and check the dumps are non-trivial first, because two failed dumps
also diff to zero. Declare a new column in the position `ALTER TABLE ADD COLUMN`
produces (last in the table body) or fresh and patched schemas diverge forever.

## Compatible V1 patching

`patches/manifest.tsv` is the catalog. Each row is five tab-separated fields —
generation, version, name, `sha256:` checksum, file — and the runner rejects a
manifest whose versions are not contiguous, whose first version is not 2, or
whose file does not hash to the recorded checksum. It executes nothing until the
whole catalog validates, and it runs from a private snapshot of the bytes it
verified, so editing a patch file mid-run cannot change what reaches the server.

**Published versions and checksums are immutable.** Once a patch has shipped,
its bytes are frozen: `_begin.sql` compares the catalog checksum against the one
recorded in `hotel_schema_revisions` and aborts on a mismatch rather than
re-running altered SQL over a database that already applied the original. A
patch that needs to change gets a **new version**, never an edit.

Each patch is executed as `_begin.sql` + the patch + `_end.sql` in one
transaction:

1. `BEGIN`, then `pg_advisory_xact_lock` — concurrent runners serialize, and the
   lock is released by the transaction end either way.
2. Guard: the recorded V1 baseline checksum must match the supported one, or the
   run aborts with `unsupported V1 baseline checksum`. This is what refuses
   legacy and unversioned databases.
3. Skip detection: if the revision is already recorded with the same checksum,
   the patch body is skipped via `\if` and the run reports `skipped patch 1.N`.
4. Otherwise the patch body runs, `_end.sql` inserts the revision row, and the
   run reports `applied patch 1.N`.
5. `COMMIT` — DDL and the revision row commit or roll back together. There is no
   partially applied patch.

The runner finishes by printing the full `hotel_schema_revisions` table for
generation 1, which is the authoritative record of what a database has.

Where it is applied:

| Context | Application point |
|---|---|
| Server / local | `make db-patch DATABASE_URL="…"` (also the last step of `make db-setup`) |
| Production deploy | `deploy/deploy.sh` — after the verified backup, after PostgreSQL alone is up, before the application containers are activated |
| Desktop | the Tauri launcher, after it recognizes a fresh or V1 database and before it starts the backend sidecar, streaming the bundled catalog to the bundled `psql` |
| Backend startup | never — it validates and refuses, it does not patch |

**Failure recovery.** Every failure is fatal and visible; nothing is swallowed.
The failing patch rolled back whole, so the database is still at the last
successfully recorded revision and rerunning after the fix is safe — already
applied patches skip. Read the error first:

- `unsupported V1 baseline checksum: <missing>` — the target is not a V1
  database. Do not patch it; export and rebuild from the current baseline.
- `patch 1.N checksum mismatch: database …, catalog …` — the database applied a
  different build of that version. Do not edit the patch to match; ship a new
  version.
- `checksum mismatch for 000N_….sql` — the working tree's patch bytes do not
  match the manifest. Nothing was executed.

Take a verified backup before patching production: `pg_dump --format=custom`,
then `pg_restore --list` it to prove the dump is readable.

## Schema drift reporting

`report-schema-drift.sh` answers "does this database still match a current
baseline?" without writing to either side. Both databases are read in
`READ ONLY` transactions with canonical session settings, reduced to a
deterministic inventory of tables, views, columns, constraints, indexes and
functions, and diffed:

```bash
make db-schema-drift \
  TARGET_DATABASE_URL="$TARGET_DATABASE_URL" \
  BASELINE_DATABASE_URL="$BASELINE_DATABASE_URL"
```

The two URLs must be distinct — point `BASELINE_DATABASE_URL` at a scratch
database freshly built by `make db-setup`. Exit `0` means no drift, `2` means
drift was reported as a unified diff, and any other nonzero code is a connection
or query failure. It never prints either URL, and it reports differences only —
resolving them is a human decision.

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
for a new empty PostgreSQL database — then the same patch catalog. The desktop
bundle ships `patches/` as packaged resources; those copies are generated from
this directory by `bun run sync:resources:force` and must never be hand-edited.
Change the files here, then sync.

The desktop launcher applies the catalog to a recognized V1 database before
starting the backend. It does not alter a non-empty unversioned or legacy
database; recovery for those layouts is a manual, backup-first export and fresh
rebuild. Optimization scripts are never bundled or applied automatically.
