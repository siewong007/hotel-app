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
was folded into the baseline and the catalog republished from empty. Since
then it has grown again, one converge-style patch at a time. A fresh install
records revision 1 plus one row per manifest entry. The manifest is the only
list; read it rather than repeating it (`grep -vc '^#' patches/manifest.tsv`
counts the entries). As of 2026-10-06 it runs from version 2 to 16.
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
to production and is not part of `db-baseline`. It replaced the single
`staging.sql` file in 2026-09: each `sections/*.rs` module holds its fixture SQL
as `const` raw strings, ported verbatim and proven against the schema's
triggers. Rust computes only what SQL cannot, such as the encrypted TOTP
secret. Room and payment states are reached the real way: through booking
inserts, `update_room_status()`, and `payments` rows, so status triggers and
history journals fire as they do in production.

```bash
make db-baseline DATABASE_URL="$DATABASE_URL"   # once per fresh database
make db-seed     DATABASE_URL="$DATABASE_URL"   # apply; safe to rerun
```

Rerun semantics: the binary opens one transaction, takes an advisory lock,
guards on the recorded V1 revision and the environment (refuses production),
wipes every seed-owned row (child-first) inside the fixed id band
**800000-899999** (plus generated-id children and marker-tagged `job_runs`),
restarts the housekeeping-task id sequence at the band floor, inserts the
selected sections, then resyncs the band's identity sequences past the
inserted ids. The restart is what makes a fresh database's first run match
every rerun: `update_room_status()` gives each room it marks dirty or
reserved-dirty a housekeeping task whose id comes from that sequence, so those
rows get the same in-band ids (800001 up) every time. Every run therefore
yields the same in-band rows, ids included, and the same printed summary — a
reset of the staging dataset, never an append. CI applies it twice to a fresh
database and fails on any difference in the summary or in any table's in-band
ids; a section that starts generating rows in another table needs that
table's sequence added to `RESTART_GENERATED_IDS_SQL` in `src/bin/seed/engine.rs`.
Wall-clock values (`created_at` defaults, UUIDv7 columns such as
`bookings.uuid`) and the ids of out-of-band child rows such as `room_history`
still change between runs. It never touches bootstrap rows or ids outside the
band.
Explicit-id inserts use `OVERRIDING SYSTEM VALUE`, and nothing calls `random()`.

Scenarios (`cargo run --bin seed -- --list` prints this registry from
`registry.rs`). `--scenario` is repeatable and accepts comma lists. Each
scenario carries the sections it depends on, and sections always run in one
canonical order, whatever order the flags were given in.

| Scenario | Seeds |
|---|---|
| `basic` | Working hotel: staff, inventory, rates, guests, today's front-desk bookings |
| `availability` | Inventory grid: allocations, room-status spread, sold-out and one-left dates |
| `booking-lifecycle` | Every booking status, comp stays, anonymous bookings |
| `frontdesk` | Arrivals, departures, in-house, housekeeping board, maintenance |
| `payments` | Every payment state, invoices, city ledgers, refund/partial/retry/receipt fixtures |
| `webhooks` | Pending PayPal payments with deterministic order ids (`PAYID-STGORDER…`) for webhook replay. No webhook store exists, so only the targets are seeded. |
| `authentication` | Users for every role, locked/inactive/unverified accounts, a 2FA-enabled user, portal sessions |
| `audit` | Booking and room-status history, audit markers, night-audit runs, job history |
| `notifications` | Staff notifications with read markers, email delivery states, the suppression list |
| `edge-cases` | Adjacent, one-night and long stays, max occupancy, aging hold, sold-out date, retry-after-failure, anonymous flows |
| `operations` | Housekeeping board, maintenance tickets, room events, night-audit history |
| `marketing` | Promotions in every status, vouchers and redemptions, segments, email campaigns |
| `loyalty` | Members, tiers, points ledger, reward catalog, redemptions, complimentary credits |
| `guest-access` | Anonymous bookings with access tokens, guest-portal sessions, user–guest links |
| `full` | Everything. Bare `seed` and `--all` mean `full`. |

Safety (`guard.rs`): every run refuses when `APP_ENV`/`ENVIRONMENT` resolves to
production (`APP_ENV` wins, as in the app's own config). `--reset` on its own
wipes seed-owned rows and inserts nothing. Combined with `--all` or
`--scenario`, it wipes and then applies. Either way it additionally needs an
explicit development signal: either the environment is
`development`/`dev`/`local`/`test`/`testing`/`staging`, or no environment is
set and `DATABASE_URL` points at a loopback host. There is no override flag.
Resetting the schema itself is `make db-reset`'s job.

Reference date: every stay/schedule date derives from the hotel business date,
so the dataset never goes stale. Pin it for reproducible runs:

```bash
cargo run --bin seed -- --all --ref-date 2026-01-15
```

Auth fixtures: every seeded user shares the development-only password
`HotelStaging2026!` (`*.stg` / `*_stg` accounts such as `manager_stg`,
`frontdesk_amy`, `finance_mei`, `marketing_nadia`, `hk_siti`, plus a
`guest_portal` portal login, an inactive and a locked account). Never reuse
these credentials outside development or staging. The 2FA-enabled user's
TOTP secret is the public test vector `JBSWY3DPEHPK3PXP`. It is stored
encrypted when `TOTP_ENCRYPTION_KEY` is set, and as plaintext otherwise.

Coverage: `seed --all` printed this on a 2026-10-05 rerun (since the
first-run fix, every run prints the same): 20 users, 3 room types, 24
rooms, 11 amenities, 5 rate plans, 53 guests, 3 companies, 92 bookings, 74
payments, 8 invoices, 5 city-ledger entries, 11 housekeeping tasks (9 seeded
directly, 2 created by `update_room_status()`), 6 maintenance tickets, 14 night-audit runs, 10
promotions, 10 vouchers, 9 email deliveries, 6 loyalty members, 5 staff
notifications, and 10 audit events. Rerun it rather than trusting these
numbers. The variety is deliberate:

- Guests: VIP, corporate, foreign and local (for tourism tax), blacklisted,
  duplicate-name, long-name, minimal-profile, and bulk filler for pagination.
- Rooms in every status, including `maintenance`, `out_of_order`, and
  `reserved_dirty`.
- Bookings in every status: in-house, arriving, departing, no-show,
  voided+refunded, comp, partial-comp, a 30-night stay, a same-day walk-in,
  aging unpaid holds, adjacent same-room windows, and anonymous bookings with
  `pre_checkin_token`s.
- Promotions and vouchers in every claim and lifecycle state, plus
  permission-scoped voucher users (`voucher_audit` read-only,
  `voucher_noperm`).
- Portal sessions, including one with the known Bearer token
  `stg-portal-token-a`.

Deliberately not seeded:

- Payroll/HR tables (none exist; only `teams`/`team_members`).
- `cancelled`/`expired` booking statuses (the model uses `voided`, and the
  unpaid-hold scheduler handles expiry).
- Multi-room reservations (`bookings.room_id` is scalar).
- Overlapping same-room bookings. The exclusion constraint makes them
  impossible, so overlap rejection is tested through the API instead.
- Passkeys, eKYC evidence, and `two_factor_challenges` rows. Credentials
  cannot be fabricated meaningfully, and fake identity-verification records
  must not exist.

`audit_logs` is append-only, so seeded audit rows are id-guarded inserts that
survive reruns. They always attribute the bootstrap admin; the nominal actor
is recorded inside `details`.

## Compatible V1 patching

The catalog is live: every V1 convergence patch from the original lineage
(versions 2–23) was folded into `migrations/0001_v1_baseline.sql` and
`seed.sql`, and the catalog was republished from empty and has grown since.
`patches/manifest.tsv` is the catalog of record, so do not hardcode its
contents elsewhere. Fresh installs get
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
| Local Docker Compose | the one-shot `db-patches` service, which the `backend` container waits on; with only `postgres` up, run `docker compose run --rm db-patches` |
| Production deploy | `deploy/deploy.sh` — after the verified backup, after PostgreSQL alone is up, before the application containers are activated |
| Desktop | the Tauri launcher, after it recognizes a fresh or V1 database and before it starts the backend sidecar, streaming the bundled catalog to the bundled `psql` |
| Backend startup | never — it validates and refuses, it does not patch |

**The backend verifies the catalog at startup.** `src/core/schema_catalog.rs`
compiles `patches/manifest.tsv` into the binary, and `main` refuses to start
while any listed revision is missing from `hotel_schema_revisions` or recorded
with a different checksum, naming each one (`FATAL: database schema does not
match this build (1.8 distributed-state (missing)); apply the patch catalog
(make db-patch) and restart`). A missing revision is fixed by running the
catalog; a checksum mismatch needs the lineage reset in
`docs/guides/deployment.md`. Revisions newer than the build are accepted —
a deploy rollback runs the previous release against an already-patched
database. A baseline + seed install without the catalog step records only
revision 1, so the backend refuses it even though the structure is complete.

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

The baseline defines no SQL/PGQ property graph. It used to create
`public.hotel_graph` as pure query surface that no application code read, but
PostgreSQL 19 Beta 4 reverted SQL/PGQ, and the release candidate and GA follow:
they reject every `PROPERTY GRAPH` statement as a syntax error. Patch
`0015_drop_hotel_property_graph.sql` drops the graph from databases installed
earlier. Apply it while a database is still on 19beta3: a beta3 `pg_dump` of a
database that still holds the graph fails to restore onto beta4 or later.

`audit_logs` is append-only in the database, not just by convention. A
statement fires only the triggers of the table it names, so the guard has three
parts, all running `prevent_audit_log_mutation()`:

- a statement trigger on `audit_logs` (UPDATE, DELETE, TRUNCATE);
- a row trigger on `audit_logs` that PostgreSQL clones onto every partition, so
  an UPDATE or DELETE fails whether it names the parent or a partition;
- a statement-level `BEFORE TRUNCATE` trigger on each partition. TRUNCATE
  triggers cannot be row-level and are never cloned, so
  `ensure_audit_logs_truncate_guards()` adds them. Partition upkeep
  (`AuditRepository::ensure_upcoming_partitions`), the seed bin and the
  install-time loop call it right after `ensure_audit_logs_partition()`, and
  patch `0017_audit_logs_partition_guards.sql` ran it once on installed
  databases. It sits next to that function rather than inside it because
  patch 0016 accepts only its own two definitions of
  `ensure_audit_logs_partition()`. A partition created any other way refuses
  UPDATE and DELETE at once, and TRUNCATE from the next upkeep run.

Integration tests and the seed bin open the guard with
`SET app.allow_audit_mutation = 'on'`, which the users → `audit_logs`
`ON DELETE SET NULL` key also needs: deleting any user runs an UPDATE on
`audit_logs`. A data-transfer restore uses `ALTER TABLE … DISABLE TRIGGER USER`
instead, which also switches off the cloned row triggers. DDL (`DETACH`, `DROP`,
`DISABLE TRIGGER`) is out of scope: the guard stops accidental and
application-level mutation, not the database owner.

## PostgreSQL 19 optimization

The files under `postgres/optimization/` are opt-in, benchmark-gated profiles
(named `pg19_beta2*` because they were authored and benchmarked against Beta 2;
the deployed image has since moved to `postgres:19beta3`):

```bash
make db-pg19-tune DATABASE_URL="$DATABASE_URL"
make db-pg19-benchmark DATABASE_URL="$DATABASE_URL"
make db-pg19-tune-rollback DATABASE_URL="$DATABASE_URL"
```

`make db-pg19-tune` also raises `autovacuum_max_parallel_workers` to 4 via
`ALTER SYSTEM` (the rollback target resets it). Without that cluster GUC, the
profile's per-table `autovacuum_parallel_workers` settings do nothing.

On the `make docker-up-pg19-tuned` path, `ALTER SYSTEM` loses.
`docker-compose.pg19-tuned.yml` passes
`-c autovacuum_max_parallel_workers=${PG19_AUTOVACUUM_PARALLEL_WORKERS:-2}`, and
a command-line `-c` outranks `postgresql.auto.conf`, so the effective value
there is 2. On a bare database it is 4. The per-table settings engage either
way. To get 4 on the compose path, set `PG19_AUTOVACUUM_PARALLEL_WORKERS`.

The profile was re-validated on 19beta3 (2026-09-15) in two scratch
containers, vanilla versus tuned. It applies cleanly, every setting takes
effect (the io-concurrency GUCs show in `EXPLAIN` `Settings:` lines), the
three extended statistics and the per-table reloptions are created, and the
benchmark queries keep identical plan shapes. This ran on seed-sized data, so
it is evidence that the profile *engages*, not a latency result. Several
compose `-c` pins (`io_method=worker`, `io_min_workers=2`, `io_max_workers=8`,
`jit=off`, `default_toast_compression=lz4`) already match the beta3
defaults. They are harmless no-ops there.

For online table rebuilds, use `make db-repack TABLE=public.bookings`
(PostgreSQL 19 `REPACK CONCURRENTLY`), or `make db-repack-full` in a
maintenance window.

PostgreSQL 19 is prerelease software (`postgres:19beta3` in every compose
file). The profiles are for testing, not production.

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
