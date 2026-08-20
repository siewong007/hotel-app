# Database Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one authoritative, checksummed V1 PostgreSQL patch lifecycle that safely converges existing server and desktop databases with the current baseline and restores truthful PostgreSQL verification.

**Architecture:** Keep `0001_v1_baseline.sql` and `seed.sql` authoritative for fresh databases. Add a manifest-driven SQL catalog whose shared control scripts own locking, revision validation, skip/conflict behavior, and transaction boundaries; a small Bash runner serves server/local installations, while desktop Rust verifies and streams the same catalog to bundled `psql`. Deployment patches after backup and before application activation, and backend startup remains schema-read-only.

**Tech Stack:** PostgreSQL 19/psql, Bash, Rust 1.95, SQLx 0.8, SHA-256 (`sha2`), Tauri 2, Bun, GitHub Actions.

## Global Constraints

- Work only in the current repository and preserve every unrelated dirty worktree change; never revert or overwrite the modified ledger, payment, analytics, or frontend files.
- PostgreSQL 19 is the only database engine. Patch SQL is PostgreSQL-only and must not introduce a second application database abstraction.
- Fresh schema changes remain in `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`; compatible live changes also receive an idempotent catalog patch.
- Ordinary backend startup validates schema but never applies patches.
- Patch metadata and DDL commit or roll back together under one transaction-scoped advisory lock.
- Published patch versions and byte checksums are immutable. A changed patch receives a new generation-1 version.
- Do not rewrite historical financial/currency rows, drop the eleven unexplained live tables, rewrite Git history, or delete eKYC files in this workstream.
- Do not add dependencies except a direct desktop `sha2 = "0.10"` declaration for verifying bundled patch bytes; this exact version already exists in the desktop lockfile transitively.
- Do not hand-edit synchronized desktop SQL resources. Change backend resources, then run the sync script.
- Every SQL/process failure is fatal and visible. Never use ignored `let _ = ...` or shell `|| true` around patch application.
- Run real PostgreSQL tests with `DATABASE_URL`; report exact passed, failed, and ignored counts rather than relying on process exit code alone.
- Pass `DATABASE_URL` explicitly to every PostgreSQL test command. Do not `source` the whole `.env`; it contains human-readable values that are not shell-quoted.

---

## File Map

### Authoritative PostgreSQL resources

- Create `hotel-app-be/database/postgres/patches/manifest.tsv`: ordered generation/version/name/SHA-256/file catalog.
- Create `hotel-app-be/database/postgres/patches/_begin.sql`: transaction, advisory lock, V1 revision validation, checksum-conflict detection, and psql conditional opening.
- Create `hotel-app-be/database/postgres/patches/_end.sql`: revision insert, applied/skipped output, conditional close, and transaction commit.
- Create `hotel-app-be/database/postgres/patches/0002_google_subject.sql`: compatible Google-subject convergence.
- Create `hotel-app-be/database/postgres/patches/0003_payment_idempotency.sql`: compatible payment-idempotency convergence.
- Create `hotel-app-be/database/postgres/patches/0004_booking_status_vocabulary.sql`: booking constraint convergence.
- Create `hotel-app-be/database/postgres/apply-patches.sh`: catalog validation and psql/Docker execution.
- Create `hotel-app-be/database/postgres/schema-inventory.sql`: deterministic, read-only schema inventory.
- Create `hotel-app-be/database/postgres/report-schema-drift.sh`: compare target and known-baseline inventories without target writes.

### Backend verification

- Create `hotel-app-be/tests/postgres_patch_catalog.rs`: static manifest, byte-integrity, bundle-wiring, and runner check-mode tests.
- Create `hotel-app-be/tests/postgres_patch_lifecycle.rs`: disposable-PostgreSQL convergence, idempotency, rollback, checksum, concurrency, and drift-report tests.
- Modify `hotel-app-be/tests/status_vocabulary.rs`: replace the obsolete “no patches directory” assertion with the new lifecycle contract.

### Desktop

- Create `hotel-desktop/src-tauri/src/postgres/patches.rs`: manifest parser, SHA-256 verifier, psql streamer, and focused tests.
- Delete `hotel-desktop/src-tauri/src/postgres/schema.rs`: remove the duplicated inline payment DDL after the generic catalog is wired.
- Modify `hotel-desktop/src-tauri/src/postgres.rs`: declare `mod patches` and apply the catalog after fresh/V1 recognition but before backend launch.
- Modify `hotel-desktop/src-tauri/Cargo.toml` and `Cargo.lock`: add direct `sha2 = "0.10"` without changing the resolved version.
- Modify `hotel-desktop/scripts/sync-desktop-resources.mjs`: sync manifest, control SQL, and every manifest-listed patch.
- Create `hotel-desktop/scripts/sync-desktop-resources.test.mjs`: verify complete byte-for-byte synchronization.
- Modify `hotel-desktop/src-tauri/tauri.conf.json`: package `database/postgres/patches/**/*`.
- Generate `hotel-desktop/src-tauri/database/postgres/patches/*` only through `bun run sync:resources:force`.

### Operations and documentation

- Modify `Makefile`: add `db-patch` and make `db-setup` record the current patch level.
- Modify `deploy/deploy.sh`: install the catalog, start/wait for PostgreSQL only, apply after backup, then activate application containers.
- Modify `.github/workflows/deploy.yml`: include the runner/catalog in the checksummed release bundle.
- Modify `.github/workflows/ci.yml`: run catalog and live patch lifecycle verification.
- Modify `hotel-app-be/database/README.md`: make the patch catalog the canonical installed-V1 lifecycle.
- Modify `docs/guides/deployment.md`: replace executable one-off SQL copies with the single runner command and recovery notes.

---

### Task 1: Authoritative Patch Catalog and Static Contract

**Files:**
- Create: `hotel-app-be/tests/postgres_patch_catalog.rs`
- Create: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Create: `hotel-app-be/database/postgres/patches/_begin.sql`
- Create: `hotel-app-be/database/postgres/patches/_end.sql`
- Create: `hotel-app-be/database/postgres/patches/0002_google_subject.sql`
- Create: `hotel-app-be/database/postgres/patches/0003_payment_idempotency.sql`
- Create: `hotel-app-be/database/postgres/patches/0004_booking_status_vocabulary.sql`
- Modify: `hotel-app-be/tests/status_vocabulary.rs:184-202`

**Interfaces:**
- Consumes: `hotel_schema_revisions(generation, version, name, checksum, applied_at, app_build)` and baseline checksum `sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d`.
- Produces: tab-separated manifest rows `generation<TAB>version<TAB>name<TAB>sha256:<64 lowercase hex><TAB>file`; psql variables `patch_generation`, `patch_version`, `patch_name`, and `patch_checksum` consumed by `_begin.sql`/`_end.sql`.

- [ ] **Step 1: Write the failing static catalog test**

Create a focused parser in `postgres_patch_catalog.rs` and assert the exact catalog:

```rust
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
struct PatchEntry {
    generation: i32,
    version: i32,
    name: String,
    checksum: String,
    file: String,
}

fn postgres_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("database/postgres")
}

fn manifest_entries() -> Vec<PatchEntry> {
    let manifest = std::fs::read_to_string(postgres_dir().join("patches/manifest.tsv"))
        .expect("patch manifest must exist");
    manifest
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let fields = line.split('\t').collect::<Vec<_>>();
            assert_eq!(fields.len(), 5, "manifest row must have five tab-separated fields: {line}");
            PatchEntry {
                generation: fields[0].parse().expect("generation must be an integer"),
                version: fields[1].parse().expect("version must be an integer"),
                name: fields[2].to_owned(),
                checksum: fields[3].to_owned(),
                file: fields[4].to_owned(),
            }
        })
        .collect()
}

#[test]
fn postgres_patch_manifest_is_ordered_complete_and_checksummed() {
    let entries = manifest_entries();
    assert_eq!(
        entries.iter().take(3).map(|entry| (entry.generation, entry.version, entry.name.as_str())).collect::<Vec<_>>(),
        vec![(1, 2, "google-subject"), (1, 3, "payment-idempotency"), (1, 4, "booking-status-vocabulary")]
    );
    assert!(entries.iter().all(|entry| entry.generation == 1));
    assert_eq!(entries.first().map(|entry| entry.version), Some(2));
    assert!(entries.windows(2).all(|pair| pair[1].version == pair[0].version + 1));
    for entry in entries {
        let bytes = std::fs::read(postgres_dir().join("patches").join(&entry.file))
            .expect("manifest-listed patch must exist");
        let actual = format!("sha256:{:x}", Sha256::digest(bytes));
        assert_eq!(actual, entry.checksum, "checksum mismatch for {}", entry.file);
    }
    assert!(postgres_dir().join("patches/_begin.sql").is_file());
    assert!(postgres_dir().join("patches/_end.sql").is_file());
}
```

Change `postgres_initialization_has_only_baseline_and_seed` to
`postgres_initialization_has_baseline_seed_and_ordered_patches` and assert the patch
directory exists while `data.sql` and `upgrade/` remain absent.

- [ ] **Step 2: Run the static test to prove RED**

Run:

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog postgres_patch_manifest_is_ordered_complete_and_checksummed -- --exact
```

Expected: FAIL because `database/postgres/patches/manifest.tsv` does not exist.

- [ ] **Step 3: Add the shared transaction and revision controls**

`_begin.sql` must contain the complete preamble below. The advisory key is stable for
all generation-1 patch runners:

```sql
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE hotel_patch_context (
    generation integer NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL
) ON COMMIT DROP;

INSERT INTO hotel_patch_context (generation, version, name, checksum)
VALUES (:patch_generation, :patch_version, :'patch_name', :'patch_checksum');

SELECT pg_advisory_xact_lock(8246773601043201);

DO $patch_guard$
DECLARE
    expected_v1_checksum constant text :=
        'sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d';
    baseline_checksum text;
    recorded_checksum text;
    context_row hotel_patch_context%ROWTYPE;
BEGIN
    SELECT * INTO STRICT context_row FROM hotel_patch_context;
    SELECT checksum INTO baseline_checksum
    FROM public.hotel_schema_revisions
    WHERE generation = 1 AND version = 1;

    IF baseline_checksum IS DISTINCT FROM expected_v1_checksum THEN
        RAISE EXCEPTION 'unsupported V1 baseline checksum: %', COALESCE(baseline_checksum, '<missing>');
    END IF;

    SELECT checksum INTO recorded_checksum
    FROM public.hotel_schema_revisions
    WHERE generation = context_row.generation AND version = context_row.version;

    IF recorded_checksum IS NOT NULL AND recorded_checksum <> context_row.checksum THEN
        RAISE EXCEPTION 'patch %.% checksum mismatch: database %, catalog %',
            context_row.generation, context_row.version, recorded_checksum, context_row.checksum;
    END IF;
END;
$patch_guard$;

SELECT NOT EXISTS (
    SELECT 1
    FROM public.hotel_schema_revisions AS revision
    JOIN hotel_patch_context AS context
      ON revision.generation = context.generation
     AND revision.version = context.version
     AND revision.checksum = context.checksum
) AS hotel_patch_needed
\gset

\if :hotel_patch_needed
```

`_end.sql` must close the same psql conditional and commit metadata atomically:

```sql
INSERT INTO public.hotel_schema_revisions (generation, version, name, checksum, app_build)
SELECT generation, version, name, checksum, NULL
FROM hotel_patch_context;
\echo applied patch :patch_generation.:patch_version :patch_name
\else
\echo skipped patch :patch_generation.:patch_version :patch_name
\endif

COMMIT;
```

- [ ] **Step 4: Add patch 0002 for Google subject**

The SQL must first reject a present-but-incompatible column, then add the known missing
column and create/verify the exact baseline index:

```sql
DO $google_subject_preflight$
DECLARE
    found_type text;
    found_length integer;
    found_nullable text;
    found_index text;
    expected_index constant text :=
        'CREATE UNIQUE INDEX uq_users_google_subject ON public.users USING btree (google_subject) WHERE (google_subject IS NOT NULL)';
BEGIN
    SELECT data_type, character_maximum_length, is_nullable
    INTO found_type, found_length, found_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'google_subject';

    IF found_type IS NOT NULL AND
       (found_type <> 'character varying' OR found_length <> 255 OR found_nullable <> 'YES') THEN
        RAISE EXCEPTION 'users.google_subject has incompatible shape: type %, length %, nullable %',
            found_type, found_length, found_nullable;
    END IF;

    SELECT pg_get_indexdef(to_regclass('public.uq_users_google_subject')) INTO found_index;
    IF found_index IS NOT NULL AND found_index <> expected_index THEN
        RAISE EXCEPTION 'uq_users_google_subject has incompatible definition: %', found_index;
    END IF;
END;
$google_subject_preflight$;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS google_subject character varying(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_subject
    ON public.users USING btree (google_subject)
    WHERE google_subject IS NOT NULL;
```

- [ ] **Step 5: Add patch 0003 for payment idempotency**

Preflight all four columns as nullable `character varying` with lengths 160/64. Accept
only an absent index, the known pre-patch global receipt index, or the exact final
definitions. The recognized old receipt definition is:

```text
CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''::text))
```

After preflight, execute exactly these convergent changes:

```sql
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS idempotency_key character varying(160),
    ADD COLUMN IF NOT EXISTS idempotency_fingerprint character varying(64);

ALTER TABLE public.customer_ledger_payments
    ADD COLUMN IF NOT EXISTS idempotency_key character varying(160),
    ADD COLUMN IF NOT EXISTS idempotency_fingerprint character varying(64);

DO $receipt_index_upgrade$
DECLARE
    found_index text := pg_get_indexdef(to_regclass('public.idx_customer_ledger_payments_receipt_unique'));
    old_index constant text :=
        'CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''''::text))';
BEGIN
    IF found_index = old_index THEN
        EXECUTE 'DROP INDEX public.idx_customer_ledger_payments_receipt_unique';
    END IF;
END;
$receipt_index_upgrade$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_ledger_payments_receipt_unique
    ON public.customer_ledger_payments USING btree
    (ledger_id, lower(TRIM(BOTH FROM receipt_number)))
    WHERE receipt_number IS NOT NULL AND TRIM(BOTH FROM receipt_number) <> ''::text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_payments_ledger_idempotency
    ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> ''::text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_booking_idempotency
    ON public.payments USING btree (booking_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> ''::text;
```

The preflight must raise before any DDL for incompatible existing column types or index
definitions. It must not coerce unknown data or rebuild an already-current index.

- [ ] **Step 6: Add patch 0004 for booking status vocabulary**

Read `pg_get_constraintdef` for `bookings_status_check`. Accept only the exact current
baseline definition or the documented pre-`db9e36d1e` definition. When the old
definition is present, replace it inside the outer transaction with the current
baseline expression containing these values:

```sql
ALTER TABLE public.bookings
    DROP CONSTRAINT bookings_status_check;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_status_check CHECK (
        status::text = ANY (
            ARRAY[
                'pending'::character varying,
                'pending_payment'::character varying,
                'pending_confirmation'::character varying,
                'confirmed'::character varying,
                'checked_in'::character varying,
                'auto_checked_in'::character varying,
                'checked_out'::character varying,
                'no_show'::character varying,
                'completed'::character varying,
                'comp_void'::character varying,
                'partial_complimentary'::character varying,
                'fully_complimentary'::character varying,
                'voided'::character varying
            ]::text[]
        )
    );
```

Use a `DO` block with dynamic `ALTER TABLE` so an already-current fresh database is
verified but not rewritten.

- [ ] **Step 7: Generate immutable manifest checksums**

Run from `hotel-app-be/database/postgres/patches`:

```bash
shasum -a 256 0002_google_subject.sql 0003_payment_idempotency.sql 0004_booking_status_vocabulary.sql
```

Use `apply_patch` to create `manifest.tsv`. Its non-comment rows must carry these exact
identity fields, with each `sha256` field set to `sha256:` followed by the corresponding
literal 64-character output from the immediately preceding command:

```text
# generation  version  name                       file
1             2        google-subject             0002_google_subject.sql
1             3        payment-idempotency        0003_payment_idempotency.sql
1             4        booking-status-vocabulary  0004_booking_status_vocabulary.sql
```

The committed file remains tab-separated and includes the SHA-256 column between name
and filename, as defined by the interface above.

- [ ] **Step 8: Run static tests to prove GREEN**

Run:

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog
cargo test --test status_vocabulary postgres_initialization_has_baseline_seed_and_ordered_patches -- --exact
```

Expected: both test commands PASS.

- [ ] **Step 9: Commit the catalog contract**

```bash
git add hotel-app-be/database/postgres/patches hotel-app-be/tests/postgres_patch_catalog.rs hotel-app-be/tests/status_vocabulary.rs
git commit -m "feat(database): add ordered V1 patch catalog"
```

---

### Task 2: Server and Local Patch Runner

**Files:**
- Create: `hotel-app-be/database/postgres/apply-patches.sh`
- Modify: `hotel-app-be/tests/postgres_patch_catalog.rs`

**Interfaces:**
- Consumes: `PATCH_CATALOG_DIR` override for tests, otherwise sibling `patches/`; `DATABASE_URL` for local mode; or `--container <name> --user <role> --database <db>` for deployment mode.
- Produces: `--check` integrity-only mode; exit `0` for a valid/applied catalog and nonzero for malformed catalog, byte mismatch, psql failure, or incompatible database.

- [ ] **Step 1: Write failing runner check-mode tests**

Add tests that invoke the script without a database:

```rust
#[test]
fn patch_runner_check_mode_validates_the_committed_catalog() {
    let status = std::process::Command::new(postgres_dir().join("apply-patches.sh"))
        .arg("--check")
        .status()
        .expect("patch runner must start");
    assert!(status.success());
}
```

Add a second test that copies the catalog into a process-unique temporary directory,
changes one byte in `0004_booking_status_vocabulary.sql`, sets `PATCH_CATALOG_DIR`, and
asserts `--check` exits nonzero with `checksum mismatch` on stderr. Remove only that
validated temporary directory at test teardown.

- [ ] **Step 2: Run runner tests to prove RED**

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog patch_runner -- --nocapture
```

Expected: FAIL because `apply-patches.sh` does not exist.

- [ ] **Step 3: Implement argument parsing and validate the entire catalog before connecting**

The script must use strict mode, resolve paths relative to itself, support GNU
`sha256sum` and macOS `shasum -a 256`, and collect every row before running any patch.
Use indexed arrays, reject extra fields, and validate each value with these exact
patterns:

```bash
[[ $generation =~ ^[1-9][0-9]*$ ]]
[[ $version =~ ^[1-9][0-9]*$ ]]
[[ $name =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
[[ $checksum =~ ^sha256:[0-9a-f]{64}$ ]]
[[ $file =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]]
```

Reject duplicate/non-increasing versions, require generation 1, require the first patch
to be version 2, and require every later version to increment by exactly one. The
initial catalog ends at 1.4, but the parser must accept contiguous future versions.
Resolve every file below the catalog directory and compare its exact SHA-256 before
checking `DATABASE_URL` or invoking Docker/psql. `--check` exits after this validation.

- [ ] **Step 4: Implement local and Docker psql transports**

For local mode, require a non-empty `DATABASE_URL` and invoke:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  --set="patch_generation=$generation" \
  --set="patch_version=$version" \
  --set="patch_name=$name" \
  --set="patch_checksum=$checksum"
```

For deployment mode, invoke the same psql arguments through:

```bash
docker exec -i "$container" psql -X -U "$database_user" -d "$database_name"
```

For each patch, stream `_begin.sql`, the manifest-listed SQL, and `_end.sql` into one
psql process in that order. Do not interpolate SQL in Bash and do not log the database
URL. Stop on the first nonzero psql exit.

After all patches, query and print generation-1 revisions ordered by version. The final
query is diagnostic only but still fails the command if psql fails.

- [ ] **Step 5: Run runner tests to prove GREEN**

```bash
chmod +x hotel-app-be/database/postgres/apply-patches.sh
cd hotel-app-be
cargo test --test postgres_patch_catalog patch_runner -- --nocapture
```

Expected: valid catalog PASS; byte-corrupted copy PASS by observing the intended
nonzero runner exit.

- [ ] **Step 6: Commit the runner**

```bash
git add hotel-app-be/database/postgres/apply-patches.sh hotel-app-be/tests/postgres_patch_catalog.rs
git commit -m "feat(database): add checked PostgreSQL patch runner"
```

---

### Task 3: Live PostgreSQL Patch Lifecycle Tests

**Files:**
- Create: `hotel-app-be/tests/postgres_patch_lifecycle.rs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `DATABASE_URL`, current baseline/seed, `apply-patches.sh`, and `PATCH_CATALOG_DIR` for injected test catalogs.
- Produces: disposable database tests named `postgres_v1_patches_converge_and_are_idempotent`, `postgres_v1_patch_failures_roll_back`, and `postgres_v1_patch_runners_serialize`.

- [ ] **Step 1: Write the failing convergence test and disposable-database helpers**

Copy the proven URL parsing/database creation pattern from
`status_vocabulary.rs::postgres_smoke`, but keep helpers local to the new file. Build
two disposable databases from `POSTGRES_SCHEMA` + `POSTGRES_SEED`. On the upgrade-path
database execute this exact documented downgrade:

```sql
DELETE FROM hotel_schema_revisions WHERE generation = 1 AND version > 1;

DROP INDEX IF EXISTS uq_users_google_subject;
ALTER TABLE users DROP COLUMN IF EXISTS google_subject;

DROP INDEX IF EXISTS uq_payments_booking_idempotency;
DROP INDEX IF EXISTS uq_ledger_payments_ledger_idempotency;
DROP INDEX IF EXISTS idx_customer_ledger_payments_receipt_unique;
ALTER TABLE payments
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS idempotency_fingerprint;
ALTER TABLE customer_ledger_payments
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS idempotency_fingerprint;
CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique
    ON customer_ledger_payments (lower(TRIM(BOTH FROM receipt_number)))
    WHERE receipt_number IS NOT NULL AND TRIM(BOTH FROM receipt_number) <> ''::text;

ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (
    status::text = ANY (
        ARRAY[
            'pending'::character varying,
            'confirmed'::character varying,
            'checked_in'::character varying,
            'auto_checked_in'::character varying,
            'checked_out'::character varying,
            'no_show'::character varying,
            'completed'::character varying,
            'comp_void'::character varying,
            'partial_complimentary'::character varying,
            'fully_complimentary'::character varying,
            'voided'::character varying
        ]::text[]
    )
);
```

Invoke `apply-patches.sh` with the upgrade database URL, assert revisions 2/3/4 and all
final catalog objects, capture their OIDs/definitions, invoke it again, and assert no
OID, definition, or revision timestamp changed.

- [ ] **Step 2: Run the convergence test to prove RED against incomplete patch SQL**

```bash
cd hotel-app-be
cargo test --test postgres_patch_lifecycle postgres_v1_patches_converge_and_are_idempotent -- --exact --nocapture
```

Expected: FAIL until every patch accepts the documented old shape and converges it.

- [ ] **Step 3: Correct only catalog compatibility defects exposed by the test**

Update the relevant patch preflight/DDL, recalculate only that patch's SHA-256, and
update its manifest row. Do not weaken unexpected-shape checks. Re-run the static
checksum test after each byte change.

- [ ] **Step 4: Add checksum, unsupported-schema, and rollback tests**

Prove three independent fatal paths:

1. Insert revision `(1, 2)` with checksum `sha256:` followed by 64 zeroes; runner exits
   nonzero and does not add `google_subject`.
2. Run against an empty database without `hotel_schema_revisions`; runner exits nonzero
   without creating application objects.
3. Copy the catalog to a process-unique temp directory, append version 5 whose SQL is
   `CREATE TABLE patch_failure_sentinel(id integer); SELECT 1 / 0;`, calculate its real
   hash, run the catalog, and assert both `to_regclass('patch_failure_sentinel')` and
   revision `(1,5)` are absent afterward.

- [ ] **Step 5: Add the concurrent-runner test**

Start two `tokio::process::Command` instances against the same downgraded disposable
database. Assert both exit successfully, revisions 2/3/4 each occur exactly once, and
all final schema definitions match the baseline. This directly verifies the shared
transaction-scoped advisory lock.

- [ ] **Step 6: Add full schema convergence comparison**

Run `pg_dump --schema-only --no-owner --no-privileges` for the fresh and patched
disposable databases. Normalize only database names and volatile dump headers. Assert
both dumps contain `CREATE TABLE public.bookings` and then assert equality. Do not
filter real objects, constraints, indexes, or column order.

- [ ] **Step 7: Run live tests to prove GREEN**

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog
cargo test --test postgres_patch_lifecycle -- --nocapture
```

Expected: all catalog/lifecycle tests PASS and disposable databases are removed in a
finally-style cleanup even after assertion failure.

- [ ] **Step 8: Wire the focused live lifecycle into CI**

In the PostgreSQL smoke job, after baseline/seed installation, add a step that runs:

```bash
cargo test --test postgres_patch_lifecycle -- --nocapture
```

Keep the existing full PostgreSQL job unchanged; this is an additional explicit
lifecycle gate, not a replacement.

- [ ] **Step 9: Commit live lifecycle verification**

```bash
git add hotel-app-be/tests/postgres_patch_lifecycle.rs hotel-app-be/database/postgres/patches .github/workflows/ci.yml
git commit -m "test(database): prove V1 patch convergence"
```

---

### Task 4: Generic Desktop Patch Runner

**Files:**
- Create: `hotel-desktop/src-tauri/src/postgres/patches.rs`
- Delete: `hotel-desktop/src-tauri/src/postgres/schema.rs`
- Modify: `hotel-desktop/src-tauri/src/postgres.rs:14,1026-1064`
- Modify: `hotel-desktop/src-tauri/Cargo.toml`
- Modify: `hotel-desktop/src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: `patch_dir: &Path`, `psql_path: &Path`, and `PsqlConnection { host, port, user, database, password }`.
- Produces: `pub(super) async fn apply_catalog(psql_path: &Path, connection: &PsqlConnection, patch_dir: &Path) -> Result<(), PostgresError>` and private `parse_manifest(&str) -> Result<Vec<PatchManifestEntry>, PostgresError>`.

- [ ] **Step 1: Write failing desktop parser and hash tests**

In `patches.rs`, define:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
struct PatchManifestEntry {
    generation: i32,
    version: i32,
    name: String,
    checksum: String,
    file: String,
}
```

Add unit tests for the exact committed 1.2/1.3/1.4 list, malformed field count,
duplicate/non-increasing versions, path traversal such as `../bad.sql`, uppercase or
wrong-length checksum, missing files, and byte mismatch.

- [ ] **Step 2: Run desktop tests to prove RED**

```bash
cd hotel-desktop/src-tauri
cargo test postgres::patches::tests -- --nocapture
```

Expected: compilation FAIL because `postgres::patches` is not implemented.

- [ ] **Step 3: Implement parsing and byte verification**

Add `sha2 = "0.10"` as a direct dependency and use `Sha256::digest` on exact file
bytes. Reject any path whose `components()` is not exactly one `Component::Normal`.
Require generation 1, a first version of 2, and contiguous increments thereafter; also
assert that the committed prefix is versions 2/3/4 with the approved names. Read and
verify the entire catalog, including existence of `_begin.sql` and `_end.sql`, before
starting psql.

- [ ] **Step 4: Implement psql streaming**

For each verified entry, concatenate `_begin.sql`, the patch bytes, and `_end.sql` in
memory with newline boundaries. Spawn bundled `psql` with `stdin(Stdio::piped())`,
`stdout/stderr(Stdio::piped())`, the existing connection arguments, `-X`,
`ON_ERROR_STOP=1`, and the four `--set` variables. Write with
`tokio::io::AsyncWriteExt`, close stdin, await output, and map any nonzero exit through
`command_output_details` into `PostgresError::MigrationFailed` containing the patch
version/name.

Do not include the password in command arguments or errors; keep it in `PGPASSWORD`.

- [ ] **Step 5: Replace desktop's inline payment upgrade**

Change `mod schema;` to `mod patches;`. Move `PsqlConnection` into `patches.rs`. In
`run_database_setup`, retain the `Fresh` and `Unversioned` branches, remove the V1-only
inline payment call, then run the complete catalog after the match for both `Fresh` and
`V1`:

```rust
let pgsql_bin = get_pgsql_bin_dir(app_handle);
let psql_path = pgsql_bin.join(format!("psql{}", EXE_SUFFIX));
let connection = patches::PsqlConnection::new(
    "localhost",
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_DB,
    read_or_create_postgres_password()?,
);
patches::apply_catalog(
    &psql_path,
    &connection,
    &resource_dir.join("database/postgres/patches"),
)
.await?;
```

Delete `schema.rs` only after grep confirms its types/functions have no remaining
callers.

- [ ] **Step 6: Convert existing live desktop tests**

Replace the payment-specific tests with catalog tests using
`DESKTOP_TEST_V1_DATABASE`, `DESKTOP_TEST_EMPTY_DATABASE`, and optional
`DESKTOP_TEST_PATCH_DIR`. Preserve assertions that a second run does not rebuild the
receipt index and that an empty database propagates a fatal error.

- [ ] **Step 7: Run desktop verification**

```bash
cd hotel-desktop/src-tauri
cargo fmt --check
cargo test postgres::patches -- --nocapture
cargo check
cargo clippy -- -D warnings
```

Expected: all commands PASS; `Cargo.lock` retains `sha2 0.10.9` without adding another
SHA-2 version.

- [ ] **Step 8: Commit desktop runner**

```bash
git add hotel-desktop/src-tauri/src/postgres.rs hotel-desktop/src-tauri/src/postgres/patches.rs hotel-desktop/src-tauri/src/postgres/schema.rs hotel-desktop/src-tauri/Cargo.toml hotel-desktop/src-tauri/Cargo.lock
git commit -m "fix(desktop): apply the shared V1 patch catalog"
```

---

### Task 5: Desktop Resource Synchronization and Packaging

**Files:**
- Modify: `hotel-desktop/scripts/sync-desktop-resources.mjs`
- Create: `hotel-desktop/scripts/sync-desktop-resources.test.mjs`
- Modify: `hotel-desktop/src-tauri/tauri.conf.json:46-54`
- Generate: `hotel-desktop/src-tauri/database/postgres/patches/*`

**Interfaces:**
- Consumes: backend `patches/manifest.tsv`, `_begin.sql`, `_end.sql`, and every listed filename.
- Produces: exact desktop resource copies and a Tauri resource glob `database/postgres/patches/**/*`.

- [ ] **Step 1: Write the failing Bun synchronization test**

Use `bun:test`, run `bun scripts/sync-desktop-resources.mjs --force`, parse non-comment
manifest rows, and compare `Uint8Array` contents for manifest, both control files, and
all three patch files between backend and desktop paths. Also assert the Tauri config
contains `database/postgres/patches/**/*`.

- [ ] **Step 2: Run the test to prove RED**

```bash
cd hotel-desktop
bun test scripts/sync-desktop-resources.test.mjs
```

Expected: FAIL because patch resources are neither synchronized nor packaged.

- [ ] **Step 3: Extend the sync script from the manifest**

Read the manifest as UTF-8, reject malformed rows with a clear filename/line error,
and append sync entries for `manifest.tsv`, `_begin.sql`, `_end.sql`, and each fifth
field. Keep the existing `sameFileContent` skip behavior and create parent directories.
Do not recursively copy arbitrary unlisted SQL files.

- [ ] **Step 4: Package and generate resources**

Add `database/postgres/patches/**/*` to `tauri.conf.json`, then run:

```bash
cd hotel-desktop
bun run sync:resources:force
bun test scripts/sync-desktop-resources.test.mjs
```

Expected: sync reports all resources copied; the Bun test PASSes.

- [ ] **Step 5: Commit resource wiring**

```bash
git add hotel-desktop/scripts/sync-desktop-resources.mjs hotel-desktop/scripts/sync-desktop-resources.test.mjs hotel-desktop/src-tauri/tauri.conf.json hotel-desktop/src-tauri/database/postgres/patches
git commit -m "chore(desktop): bundle PostgreSQL patch resources"
```

---

### Task 6: Deployment, Release Bundle, and Local Entry Point

**Files:**
- Modify: `deploy/deploy.sh:46-64,175-190,450-500`
- Modify: `.github/workflows/deploy.yml:113-142`
- Modify: `Makefile:8-15,122-138`
- Modify: `hotel-app-be/tests/postgres_patch_catalog.rs`

**Interfaces:**
- Consumes: `apply-patches.sh --container saliminn-db --user hotel_admin --database hotel_management` and `DATABASE_URL` for Make.
- Produces: release payload `database/apply-patches.sh` plus `database/patches/*`; deployment ordering `backup_existing_database` → `prepare_database_for_release`/patch → `deploy_tag`.

- [ ] **Step 1: Write failing static deployment-order and bundle tests**

In `postgres_patch_catalog.rs`, read `deploy/deploy.sh` and `.github/workflows/deploy.yml`.
Assert all manifest files and `apply-patches.sh` are represented in the release bundle,
and compare string offsets to prove:

```text
backup_existing_database
prepare_database_for_release
deploy_tag "$TAG"
```

occur in that order in the executable tail of `deploy.sh`.

- [ ] **Step 2: Run deployment static tests to prove RED**

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog deployment -- --nocapture
```

Expected: FAIL because the release does not contain or invoke the catalog.

- [ ] **Step 3: Bundle and checksum database patch resources**

In deploy workflow bundle creation, create `database/patches`, copy the runner and the
complete authoritative patch directory, and include every copied file in `SHA256SUMS`.
In `deploy.sh`, add these exact required payload roots:

```text
database/apply-patches.sh
database/patches/manifest.tsv
database/patches/_begin.sql
database/patches/_end.sql
```

Install them under `/opt/saliminn/database/` with the runner mode `0750`, directories
`0755`, manifest/control/patch files `0644`, and no wildcard that can copy an unlisted
file.

- [ ] **Step 4: Add database preparation before application activation**

Define:

```bash
prepare_database_for_release() {
  local compose_tag=${1:-$TAG}
  export IMAGE_TAG=$compose_tag
  compose config >/dev/null
  compose up --detach postgres
  wait_for_healthy saliminn-db
  "$APP_DIR/database/apply-patches.sh" \
    --container saliminn-db \
    --user hotel_admin \
    --database hotel_management
}
```

Read `previous_tag` before calling this function. Call it after backup, verified file
installation, and image loading, but before `deploy_tag "$TAG"`. If the function
fails, exit before replacing backend/frontend containers. On a first install, use
`$TAG` only to satisfy Compose interpolation while starting the `postgres` service
alone.

- [ ] **Step 5: Add the local Make entry point**

Add `db-patch` to `.PHONY` and implement:

```make
db-patch: ## Apply verified V1 compatibility patches (requires DATABASE_URL)
	DATABASE_URL="$(DATABASE_URL)" hotel-app-be/database/postgres/apply-patches.sh
```

Append `$(MAKE) db-patch DATABASE_URL="$(DATABASE_URL)"` to `db-setup` after seed so a
fresh local database records revisions 2/3/4.

- [ ] **Step 6: Run deployment/local verification**

```bash
bash -n deploy/deploy.sh
bash -n hotel-app-be/database/postgres/apply-patches.sh
cd hotel-app-be
cargo test --test postgres_patch_catalog deployment -- --nocapture
```

Expected: syntax checks and static ordering/bundle tests PASS.

- [ ] **Step 7: Commit operations wiring**

```bash
git add deploy/deploy.sh .github/workflows/deploy.yml Makefile hotel-app-be/tests/postgres_patch_catalog.rs
git commit -m "fix(deploy): patch V1 databases before activation"
```

---

### Task 7: Read-Only Schema Drift Report

**Files:**
- Create: `hotel-app-be/database/postgres/schema-inventory.sql`
- Create: `hotel-app-be/database/postgres/report-schema-drift.sh`
- Modify: `hotel-app-be/tests/postgres_patch_lifecycle.rs`
- Modify: `Makefile`

**Interfaces:**
- Consumes: `TARGET_DATABASE_URL` and `BASELINE_DATABASE_URL`, which must be distinct; both are queried in read-only transactions.
- Produces: deterministic unified diff; exit `0` for no drift, `2` for reported drift, and another nonzero code for connection/query misuse.

- [ ] **Step 1: Write the failing live drift-report test**

Create two baseline disposable databases. Add only
`CREATE TABLE public.audit_extra_table(id bigint PRIMARY KEY)` to the target. Invoke
the report script with both URLs and assert exit `2`, stdout contains
`audit_extra_table`, and both databases still have the same revision rows and original
objects after reporting.

- [ ] **Step 2: Run the test to prove RED**

```bash
cd hotel-app-be
cargo test --test postgres_patch_lifecycle schema_drift_report_is_read_only -- --exact --nocapture
```

Expected: FAIL because the report script does not exist.

- [ ] **Step 3: Add deterministic read-only inventory SQL**

Start with `BEGIN TRANSACTION READ ONLY;` and emit tab-separated `kind`, `identity`, and
base64-encoded definition rows for:

- public ordinary/partitioned tables and views;
- every public column with ordinal, type, nullability, default, identity, and generated expression;
- primary/unique/foreign/check constraints using `pg_get_constraintdef`;
- indexes using `pg_get_indexdef`;
- public functions using identity arguments and `pg_get_functiondef`.

Order by `kind, identity`, then `COMMIT`. Exclude `hotel_schema_revisions` row data but
not its table definition. Do not inventory owners, ACLs, statistics, OIDs, or timestamps.

- [ ] **Step 4: Implement the comparison script**

Require both URLs, reject equality, create two mode-`0600` `mktemp` files, and install a
trap that removes only those exact files. Run `psql -XAt -v ON_ERROR_STOP=1 -f
schema-inventory.sql` against baseline and target, then `diff -u --label baseline
--label target`. Preserve exit `0`; translate diff exit `1` to report exit `2`; propagate
other errors. Never print either URL.

- [ ] **Step 5: Add a Make target and prove GREEN**

Add:

```make
db-schema-drift: ## Compare target schema with a current-baseline database (read-only)
	TARGET_DATABASE_URL="$(TARGET_DATABASE_URL)" BASELINE_DATABASE_URL="$(BASELINE_DATABASE_URL)" hotel-app-be/database/postgres/report-schema-drift.sh
```

Run:

```bash
cd hotel-app-be
cargo test --test postgres_patch_lifecycle schema_drift_report_is_read_only -- --exact --nocapture
```

Expected: PASS by observing exit `2` and the extra-table report while both databases
remain intact.

- [ ] **Step 6: Commit drift reporting**

```bash
git add hotel-app-be/database/postgres/schema-inventory.sql hotel-app-be/database/postgres/report-schema-drift.sh hotel-app-be/tests/postgres_patch_lifecycle.rs Makefile
git commit -m "feat(database): add read-only schema drift report"
```

---

### Task 8: Maintenance Audit Fixture Isolation

**Files:**
- Modify: `hotel-app-be/tests/rooms_housekeeping.rs:273-318,984-1057`

**Interfaces:**
- Consumes: room-scoped housekeeping/maintenance task IDs and their audit rows.
- Produces: `cleanup_room` that removes audit rows by task resource ID before deleting the task rows, including legacy audit rows whose `user_id` is null.

- [ ] **Step 1: Reproduce the isolated RED test with PostgreSQL enabled**

Extract only the configured URL without executing the rest of `.env`:

```bash
cd hotel-app-be
configured_database_url=$(sed -n 's/^DATABASE_URL=//p' .env | head -n 1)
configured_database_url=${configured_database_url#\"}
configured_database_url=${configured_database_url%\"}
test -n "$configured_database_url"
DATABASE_URL="$configured_database_url" cargo test \
  --test rooms_housekeeping \
  postgres_tests::postgres_maintenance_ticket_lifecycle \
  -- --exact --nocapture
```

Expected before the fix: FAIL at the audit-count assertion. The verified persistent
fixture state has three legacy `maintenance_ticket_updated` rows with `user_id IS NULL`
plus the current run's three rows for the same reused ticket ID.

- [ ] **Step 2: Delete task audit rows before deleting room tasks**

In `cleanup_room`, before `DELETE FROM housekeeping_tasks`, add:

```rust
sqlx::query(
    "DELETE FROM audit_logs \
     WHERE resource_type = 'housekeeping' \
       AND resource_id IN (SELECT id FROM housekeeping_tasks WHERE room_id = $1)",
)
.bind(room_id)
.execute(pool)
.await
.unwrap();
```

Before `DELETE FROM maintenance_tickets`, add the corresponding exact cleanup:

```rust
sqlx::query(
    "DELETE FROM audit_logs \
     WHERE resource_type = 'maintenance' \
       AND resource_id IN (SELECT id FROM maintenance_tickets WHERE room_id = $1)",
)
.bind(room_id)
.execute(pool)
.await
.unwrap();
```

This scopes deletion to the test room's task IDs and handles both current actor-linked
rows and legacy null-actor rows. Do not change the expected count of three updates.

- [ ] **Step 3: Prove rerun isolation GREEN**

Run the exact command from Step 1 twice. Expected: both runs PASS with
`updated_audit_count == 3`.

- [ ] **Step 4: Commit the fixture fix**

```bash
git add hotel-app-be/tests/rooms_housekeeping.rs
git commit -m "test(backend): isolate room workflow audit fixtures"
```

---

### Task 9: Canonical Documentation and Live Development Convergence

**Files:**
- Modify: `hotel-app-be/database/README.md`
- Modify: `docs/guides/deployment.md:285-390`
- Verify only: all files changed in Tasks 1-8 plus the existing dirty worktree.

**Interfaces:**
- Consumes: `make db-patch`, `make db-schema-drift`, configured development `DATABASE_URL`.
- Produces: one canonical lifecycle reference, a verified pre-patch backup, applied revisions 2/3/4 on the development database, and truthful full-gate counts.

- [ ] **Step 1: Write failing documentation assertions**

Extend `postgres_patch_catalog.rs` to assert the database README describes baseline →
seed → patches, contains `make db-patch`, and no longer says the directory stays two
files. Assert the deployment guide contains no executable copies of
`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_subject` or
`ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key`.

- [ ] **Step 2: Run documentation assertions to prove RED**

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog documentation -- --nocapture
```

Expected: FAIL on the obsolete two-file lifecycle and duplicated operator SQL.

- [ ] **Step 3: Make documentation canonical**

Update `database/README.md` with fresh install, compatible V1 patching, immutable
version/checksum rules, server/desktop application points, failure recovery, and drift
report usage. Replace both one-time SQL sections in `deployment.md` with:

```bash
make db-patch DATABASE_URL="$DATABASE_URL"
```

Document that the command is safe to rerun, aborts unsupported schemas, performs no
historical financial rewrite, and requires a verified backup before production use.
Document drift reporting with distinct target and scratch-baseline URLs.

- [ ] **Step 4: Run documentation and focused tests**

```bash
cd hotel-app-be
cargo test --test postgres_patch_catalog
cargo test --test postgres_patch_lifecycle -- --nocapture
cargo test --test status_vocabulary
```

Expected: all PASS.

- [ ] **Step 5: Create and verify a protected development-database backup**

Resolve `DATABASE_URL` without printing it or sourcing the entire `.env`. Create an
explicit mode-`0600` temporary backup path and retain it until the workstream is
accepted:

```bash
configured_database_url=${DATABASE_URL:-}
if [[ -z "$configured_database_url" ]]; then
  configured_database_url=$(sed -n 's/^DATABASE_URL=//p' .env | head -n 1)
  configured_database_url=${configured_database_url#\"}
  configured_database_url=${configured_database_url%\"}
fi
test -n "$configured_database_url"
umask 077
patch_backup_path=$(mktemp "${TMPDIR:-/tmp}/hotel-v1-prepatch.XXXXXX.dump")
pg_dump --format=custom --no-owner --no-acl --file "$patch_backup_path" "$configured_database_url"
pg_restore --list "$patch_backup_path" >/dev/null
printf 'verified pre-patch backup: %s\n' "$patch_backup_path"
```

Do not proceed if either command fails.

- [ ] **Step 6: Apply the verified catalog to the development database**

```bash
make db-patch DATABASE_URL="$configured_database_url"
psql "$configured_database_url" -XAt -v ON_ERROR_STOP=1 -c \
  "SELECT generation || '.' || version || E'\t' || name FROM hotel_schema_revisions WHERE generation = 1 ORDER BY version;"
psql "$configured_database_url" -XAt -v ON_ERROR_STOP=1 -c \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_status_check';"
```

Expected: revisions `1.1` through `1.4`; the constraint contains both pending statuses.

- [ ] **Step 7: Re-run the ten formerly schema-blocked integration cases**

Run these three PostgreSQL-enabled binaries:

```bash
DATABASE_URL="$configured_database_url" cargo test --test booking_service -- --nocapture
DATABASE_URL="$configured_database_url" cargo test --test guest_portal_credits -- --nocapture
DATABASE_URL="$configured_database_url" cargo test --test payment_characterization -- --nocapture
```

Verify that these exact formerly failing names are now green:

```text
postgres_guest_portal_race_tests::postgres_concurrent_portal_booking_allows_only_one_success
postgres_tests::a_booking_with_no_credits_is_not_flagged_complimentary
postgres_tests::a_partly_credited_stay_still_goes_through_payment
postgres_tests::stays_search_filters_server_side_and_escapes_wildcards
approve_payment_only_transitions_from_pending
capture_paypal_payment_boundary_checks_without_network
concurrent_approval_and_rejection_have_one_terminal_transition_without_deadlock
concurrent_bank_transfer_claims_create_at_most_one_active_payment
concurrent_legacy_payment_approvals_complete_at_most_one_payment
reject_payment_requires_reason_and_never_moves_money
```

Expected: all ten PASS. If one still fails, verify its current SQL constraint from the
same connection before changing application code.

- [ ] **Step 8: Run all backend and desktop gates with real counts**

```bash
cd hotel-app-be
cargo check --all-features
cargo clippy --all-features -- -D warnings
DATABASE_URL="$configured_database_url" cargo test --all-features --no-fail-fast

cd ../hotel-desktop/src-tauri
cargo check
cargo clippy -- -D warnings
cargo test -- --nocapture

cd ..
bun test scripts/sync-desktop-resources.test.mjs
```

Record each exit code and the exact passed/failed/ignored totals. A run count near only
the library-test count is not a full PostgreSQL run. Confirm
`postgres_maintenance_ticket_lifecycle` passes in the full run; do not relax its
expected audit count or hide the test.

- [ ] **Step 9: Run the quality-floor inspection**

```bash
git diff --stat HEAD~9..HEAD
git diff HEAD~9..HEAD | rg "unwrap\(\)|println!|console\.log|\$[0-9]+|\?[0-9]+|NOW\(\)|fetch\(|toISOString\(\)" || true
git status --short
```

Review every match in context. Confirm the diff contains no unrelated dirty files and
that generated desktop resources exactly match backend sources.

- [ ] **Step 10: Commit documentation**

```bash
git add hotel-app-be/database/README.md docs/guides/deployment.md hotel-app-be/tests/postgres_patch_catalog.rs
git commit -m "docs(database): document installed V1 patching"
```

- [ ] **Step 11: Report the workstream result**

Report: applied/skipped patch versions; backup location; live booking constraint;
schema-drift summary without deletions; exact backend/desktop test counts; any remaining
failure with its evidence; and the next risk-first workstream (authorization exposure).
Do not claim the overall Critical/High program is complete after this first workstream.
