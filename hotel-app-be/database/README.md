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
├── apply-patches.sh                    # server/local catalog executor
├── report-schema-drift.sh              # read-only schema comparison
└── optimization/pg19_beta2*.sql        # opt-in, benchmark-gated profiles
```

The baseline and seed install a **new** database. The patch catalog converges a
database that is **already** on V1. Nothing here discovers loose SQL: only files
listed in `patches/manifest.tsv` are ever executed, only in manifest order, and
only through a catalog executor. `apply-patches.sh` is the server/local executor;
the desktop Rust patch executor applies the same bundled catalog. Dropping a
`000N_*.sql` into `patches/` without a manifest row leaves it dead.

## V1 lifecycle

Baseline → seed → patches. The ordered patch catalog is
`patches/manifest.tsv`. From the repository root, the canonical command is:

```bash
make db-baseline DATABASE_URL="$DATABASE_URL"
```

(`make db-setup` remains as a deprecated alias for `db-baseline`.)

The equivalent by hand, once and in this order:

```bash
psql "$DATABASE_URL" -f hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f hotel-app-be/database/postgres/seed.sql
make db-patch DATABASE_URL="$DATABASE_URL"
```

The final `make db-patch` step reads `patches/manifest.tsv` and applies its
catalog in order. The original V1 convergence catalog (versions 2 through 23)
was folded into the baseline and the catalog republished from empty; it now
carries seven converge-style patches (versions 2–8 — `deposit-forfeited`,
`guest-relations-phase2`, `consent-locale-zh`, `data-transfer-permissions`,
`channel-pricing`, `consent-locale-zh-tw`, `distributed-state`), so a fresh
install records revisions 1 through 8.
A database that still records the pre-fold 1.2+ lineage aborts on a
checksum-mismatch guard; the one-time lineage reset runbook is in
`docs/guides/deployment.md`. An empty catalog is also valid state: the
runner then prints `patch catalog is empty; nothing to apply` and records
nothing beyond the baseline revision.

`seed.sql` creates all required system/reference records and fresh-install
bootstrap records, then records the completed V1 revision. It is not a startup
task and is not safe to rerun against an existing V1 database.

While the catalog is non-empty it is also what makes the two paths converge:
a fresh install already has every patched object from the baseline, so each
patch's DDL is a no-op — but the patch still runs and records its revision row.
That recorded patch level gives fresh and patched-forward databases the same
supported revision and compatible schema, and `skipped` appears when the
revision is already recorded, which is what makes a rerun a no-op.
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

## Staging dataset (`seed` binary)

The canonical staging/demo dataset lives in the `seed` binary
(`src/bin/seed/`): a comprehensive, deterministic, **re-runnable** population
of every application module on top of a completed V1 lifecycle. It never ships
to production and is not part of `db-baseline`.

```bash
make db-baseline DATABASE_URL="$DATABASE_URL"   # once per fresh database
make db-seed     DATABASE_URL="$DATABASE_URL"   # apply; safe to rerun
```

Rerun semantics: the binary opens one transaction, takes an advisory lock,
guards on the recorded V1 revision and the environment (refuses production),
wipes every staging-owned row (child-first) inside the fixed id band
**800000-899999** (plus generated-id children and marker-tagged `job_runs`),
then inserts the selected sections. A rerun therefore yields identical counts
— it is a reset of the staging dataset, never an append. It never touches
bootstrap rows or ids outside the band.

Scenarios: `cargo run --bin seed -- --list` shows the named subsets
(`basic`, `availability`, `frontdesk`, `payments`, …). Apply one or more with
`--scenario NAME`; `--all` (and bare `seed`) applies everything; `--reset`
wipes seed-owned rows only and is refused outside development/test
environments.

Reference date: every stay/schedule date derives from the hotel business date
(`staging_ref`), so the dataset never goes stale. Pin it for reproducible runs:

```bash
cargo run --bin seed -- --all --ref-date 2026-01-15
```

Auth fixtures: every staging user shares the staging-only password
`HotelStaging2026!` (`*.stg` / `*_stg` accounts such as `manager_stg`,
`frontdesk_amy`, `finance_mei`, `marketing_nadia`, `hk_siti`, plus a
`guest_portal` portal login, an inactive and a locked account). Never reuse
these credentials outside staging.

Coverage highlights: 50 guests (VIP, corporate, foreign/local for tourism tax,
blacklisted, duplicate-name, long-name, minimal-profile, bulk filler for
pagination), 24 rooms across all statuses including maintenance/out-of-order,
~77 bookings covering every status (in-house, arriving, departing, no-show,
voided+refunded, comp, partial-comp, 30-night long stay, same-day walk-in,
aging unpaid holds, adjacent same-room windows), payments/invoices/ledgers in
every state, housekeeping & maintenance boards, 14 days of night-audit history,
promotions in every claim state (draft, paused, archived, claim-window-closed,
claim-limit-reached, private) plus vouchers in every lifecycle (available,
redeemed, revoked, reversed, expired) with booking-backed redemptions,
permission-scoped voucher users (`voucher_audit` read-only, `voucher_noperm`),
campaigns + deliveries + suppressions,
loyalty members/points/redemptions, portal sessions (incl. one known-token
session, Bearer `stg-portal-token-a`), staff notifications, and
an append-only audit trail.

Limitations: there are no payroll/HR tables — only `teams`/`team_members` are
seeded. The exclusion constraint makes double-booked rooms DB-impossible, so
overlap rejection is exercised through API tests, not fixtures. `audit_logs`
is append-only: staging audit rows are id-guarded inserts that survive reruns
and always attribute the bootstrap admin (the real actor is recorded inside
`details`).

## Compatible V1 patching

The catalog is live: every V1 convergence patch from the original lineage
(versions 2–23) was folded into `migrations/0001_v1_baseline.sql` and
`seed.sql`, and the catalog was republished from empty. It currently ships
seven patches, versions 2–8 (see `patches/manifest.tsv` — it is the catalog of
record; do not hardcode its contents elsewhere). Fresh installs get
every patched object from the baseline, so each patch body is a no-op there —
but the patch still runs and records its revision row, keeping fresh and
patched-forward databases on the same supported revision. Databases that
still record pre-fold 1.2+ revisions hit the checksum-mismatch guard and
converge by the one-time lineage reset in `docs/guides/deployment.md`;
unversioned or legacy layouts converge by rebuild, not patching. Future
additive changes append to the catalog exactly as described below.

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
| Server / local | `make db-patch DATABASE_URL="…"` (also the last step of `make db-baseline`) |
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
database freshly built by `make db-baseline`. Exit `0` means no drift, `2` means
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

## PostgreSQL 19 optimization

The files under `postgres/optimization/` are opt-in, benchmark-gated profiles
(named `pg19_beta2*` because they were authored and benchmarked against Beta 2;
the deployed image has since moved to `postgres:19beta3`):

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

PostgreSQL 19 is prerelease software (`postgres:19beta3` in every compose
file) — the profiles are for testing, not production.

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
