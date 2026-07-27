# PostgreSQL Two-File Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PostgreSQL initialization, patching, and PostgreSQL 18 upgrade resources with one canonical PostgreSQL 19 baseline and one canonical seed.

**Architecture:** Keep the existing PG19-native baseline as the sole schema source and fold required/reference data from `data.sql` ahead of bootstrap data in `seed.sql`. Desktop SQL files remain generated mirrors, while every runtime, build, CI, deployment, and documentation path is reduced to baseline followed by seed.

**Tech Stack:** PostgreSQL 19 SQL, Rust/Axum/SQLx, Tauri 2, Node.js resource scripts, Docker Compose, GitHub Actions.

## Global Constraints

- Only fresh PostgreSQL 19 databases initialized from the consolidated baseline and seed are supported.
- Older PostgreSQL 19 V1 databases, PostgreSQL 18.4 databases, and non-empty unversioned databases require a manual backup/export and fresh rebuild.
- Canonical SQL files are `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql` and `hotel-app-be/database/postgres/seed.sql`.
- Generated desktop mirrors are allowed; no other initialization, patch, or legacy upgrade SQL remains.
- PostgreSQL 19 optimization and benchmark SQL files remain unchanged.
- Preserve the current schema, public API behavior, seed identities, permissions, settings, and bootstrap records.
- Add no dependencies.

---

### Task 1: Prove the Consolidation Contract and Patch Convergence

**Files:**
- Modify: `hotel-app-be/tests/status_vocabulary.rs`
- Read: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Read: `hotel-app-be/database/postgres/data.sql`
- Read: `hotel-app-be/database/postgres/seed.sql`
- Read: `hotel-app-be/database/postgres/patches/*.sql`

**Interfaces:**
- Consumes: Current baseline, data, seed, upgrade, and patch SQL text through `include_str!`.
- Produces: Static regression tests whose only SQL inputs are `POSTGRES_SCHEMA` and `POSTGRES_SEED`.

- [ ] **Step 1: Inventory each patch's final-state responsibility**

Record a temporary review checklist from every patch header and statement:

```bash
for file in hotel-app-be/database/postgres/patches/*.sql; do
  sed -n '1,220p' "$file"
done
```

For each patch, locate the equivalent final DDL or data in baseline, `data.sql`,
or seed using `rg`. Do not delete a patch whose final state is absent.

- [ ] **Step 2: Write failing static resource-contract tests**

Remove `POSTGRES_UPGRADE` and change the tests that inspect upgrade SQL so they
inspect only the baseline and seed. Add a test that asserts the active database
directory has no `data.sql`, `patches`, or `upgrade` path after consolidation:

```rust
#[test]
fn postgres_initialization_has_only_baseline_and_seed() {
    let postgres_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("database/postgres");
    assert!(postgres_dir.join("migrations/0001_v1_baseline.sql").is_file());
    assert!(postgres_dir.join("seed.sql").is_file());
    assert!(!postgres_dir.join("data.sql").exists());
    assert!(!postgres_dir.join("patches").exists());
    assert!(!postgres_dir.join("upgrade").exists());
}
```

Keep status-vocabulary assertions that protect current booking and room states,
but remove assertions whose only subject is the deleted PG18 upgrade.

- [ ] **Step 3: Run the contract test and verify RED**

Run:

```bash
cd hotel-app-be
cargo test --test status_vocabulary postgres_initialization_has_only_baseline_and_seed -- --exact
```

Expected: FAIL because `data.sql`, `patches/`, and `upgrade/` still exist.

- [ ] **Step 4: Save the patch convergence evidence**

Before implementation, keep the inventory in the task notes or terminal output.
The required mapping is:

- Schema/table/function/physical-design changes resolve to the baseline.
- Permissions, settings, transitions, loyalty rows, vouchers, and route-policy
  changes resolve to the future consolidated seed.
- Deletion patches resolve by confirming the retired rows are absent from the
  future consolidated seed.

### Task 2: Build the Two Canonical SQL Files

**Files:**
- Modify: `hotel-app-be/database/postgres/seed.sql`
- Verify unchanged final DDL: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Delete: `hotel-app-be/database/postgres/data.sql`
- Delete: `hotel-app-be/database/postgres/patches/*.sql`
- Delete: `hotel-app-be/database/postgres/upgrade/pg18_4_to_v1.sql`

**Interfaces:**
- Consumes: The current `data.sql` transaction body followed by the current `seed.sql` transaction body.
- Produces: A one-shot `seed.sql` that owns all required/reference/bootstrap data and records schema revision V1.

- [ ] **Step 1: Merge required data before bootstrap data**

Create one seed transaction with:

```sql
\set ON_ERROR_STOP on

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('hotel_app_v1_fresh_bootstrap'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.hotel_schema_revisions
        WHERE generation = 1 AND version = 1
    ) THEN
        RAISE EXCEPTION
            'seed.sql is a one-time V1 installation step and must not run against an existing V1 database';
    END IF;
END;
$$;
```

Append the current `data.sql` body after its guard and before its `COMMIT`, then
append the current `seed.sql` body after its guard and before its `COMMIT`.
Keep one final revision insert and one `COMMIT`. Remove the restored-PG18
conditional language; fresh installs always create the configured bootstrap
records.

- [ ] **Step 2: Confirm every patch converges into baseline or seed**

Use exact domain identifiers from the inventory, including:

```bash
rg -n 'payments:approve|keycard_deposit|service_charge|pending_payment|payment_receipts|online_inventory|two_factor_challenges|sync_all_room_statuses|team_roles|team_members|loyalty:manage|tax_rate|ekyc:verify|my-bookings' \
  hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql \
  hotel-app-be/database/postgres/seed.sql
```

Inspect matches rather than treating presence alone as proof. Confirm retired
`ekyc:verify` and `my-bookings` records are not inserted.

- [ ] **Step 3: Delete obsolete SQL resources**

Delete `data.sql`, every dated patch, and the PG18 upgrade file with
`apply_patch`. Remove their empty directories only after `rg` confirms no
remaining caller needs them.

- [ ] **Step 4: Run the static contract test and verify GREEN**

Run:

```bash
cd hotel-app-be
cargo test --test status_vocabulary
```

Expected: PASS with no dependency on PG18 or patch SQL.

- [ ] **Step 5: Commit the canonical SQL consolidation**

```bash
git add hotel-app-be/database/postgres hotel-app-be/tests/status_vocabulary.rs
git commit -m "refactor(db): consolidate PostgreSQL initialization SQL"
```

### Task 3: Remove Runtime Patching and Update Every Consumer

**Files:**
- Modify: `hotel-desktop/src-tauri/src/postgres.rs`
- Modify: `hotel-desktop/scripts/sync-desktop-resources.mjs`
- Modify: `hotel-desktop/src-tauri/tauri.conf.json`
- Modify: `hotel-app-be/docker-compose.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `Makefile`
- Modify: `hotel-app-be/src/main.rs`
- Modify: `hotel-app-be/src/repositories/ledger.rs`
- Modify: `hotel-app-be/tests/rbac_profile.rs`
- Delete: `hotel-desktop/src-tauri/database/postgres/data.sql`
- Delete: `hotel-desktop/src-tauri/database/postgres/patches/*.sql`
- Modify generated mirror: `hotel-desktop/src-tauri/database/postgres/seed.sql`

**Interfaces:**
- Consumes: Canonical baseline and seed.
- Produces: Every initialization path executes exactly baseline then seed; desktop V1 startup validates but never patches.

- [ ] **Step 1: Reduce desktop resource syncing to two files**

Remove the `data.sql` and physical-design patch entries from `syncFiles`. Keep
only:

```javascript
const syncFiles = [
  {
    label: 'PostgreSQL V1 baseline',
    source: join(repoRoot, 'hotel-app-be', 'database', 'postgres', 'migrations', '0001_v1_baseline.sql'),
    target: join(desktopRoot, 'src-tauri', 'database', 'postgres', 'migrations', '0001_v1_baseline.sql'),
  },
  {
    label: 'PostgreSQL V1 seed',
    source: join(repoRoot, 'hotel-app-be', 'database', 'postgres', 'seed.sql'),
    target: join(desktopRoot, 'src-tauri', 'database', 'postgres', 'seed.sql'),
  },
];
```

Run `bun run sync:resources` from `hotel-desktop` to create the seed mirror.

- [ ] **Step 2: Remove desktop patch execution**

In `run_database_setup`:

- Fresh executes baseline then seed.
- Unversioned returns a fresh-rebuild-required error without PG18 instructions.
- V1 performs no migration; retain current schema validation performed before
  the backend starts.

Delete `apply_pg19_physical_design_patch_if_needed`. Do not delete generic
backup/restore commands used by the desktop UI.

- [ ] **Step 3: Reduce packaging, Docker, CI, deployment, and Make flows**

Change every ordered initialization list from:

```text
baseline -> data -> seed
```

to:

```text
baseline -> seed
```

Delete `db-upgrade-pg18_4-to-v1`. Update deployment bundle numbering/checksum
lists and Tauri resource entries so no deleted SQL path is packaged.

- [ ] **Step 4: Replace active patch-era diagnostics**

Keep backend schema guards, but change failures to say the database schema is
legacy and requires backup/export plus a fresh rebuild from baseline and seed.
Remove comments in `main.rs`, `ledger.rs`, tests, and desktop code that direct
operators to dated patches or PG18.

- [ ] **Step 5: Run targeted consumer checks**

Run:

```bash
cd hotel-desktop
bun run sync:resources
bun run desktop:prepare

cd ../hotel-app-be
cargo test --test status_vocabulary
```

Expected: desktop sync reports only baseline and seed; preparation and tests
exit 0.

- [ ] **Step 6: Commit runtime and consumer cleanup**

```bash
git add .github Makefile hotel-app-be hotel-desktop
git commit -m "refactor(db): remove PostgreSQL patch and upgrade paths"
```

### Task 4: Rewrite Active Documentation and Verify the Fresh Database

**Files:**
- Modify: `hotel-app-be/database/README.md`
- Modify: `docs/ongoing-dev.md`
- Modify if present: `AGENTS.md`
- Verify: `docs/superpowers/specs/2026-07-27-postgres-two-file-consolidation-design.md`

**Interfaces:**
- Consumes: The completed baseline-to-seed initialization flow.
- Produces: Operator documentation and fresh-database evidence matching the two-file contract.

- [ ] **Step 1: Update active documentation**

Document only:

```bash
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
```

State that legacy databases require backup/export and a fresh rebuild. Remove
active roadmap or repository instructions to retain PG18 or dated patches.
Leave historical `.claude/reports/` snapshots unchanged.

- [ ] **Step 2: Scan for forbidden active references**

Run:

```bash
rg -n -i --hidden \
  --glob '!**/.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/target/**' \
  --glob '!hotel-desktop/src-tauri/pgsql/**' \
  --glob '!.claude/reports/**' \
  'postgres(?:ql)?[ _@.-]*18|pg18|18\.4|database/postgres/data\.sql|database/postgres/patches|database/postgres/upgrade|patches/2026-' .
```

Expected: no active PostgreSQL/database matches. Ignore unrelated dependency
versions such as Cargo packages at `0.18.4` and Node.js 18 settings.

- [ ] **Step 3: Verify the two canonical and two mirrored SQL files**

Run:

```bash
find hotel-app-be/database/postgres hotel-desktop/src-tauri/database/postgres \
  -type f -name '*.sql' \
  ! -path '*/optimization/*' \
  -print | sort

cmp hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql \
  hotel-desktop/src-tauri/database/postgres/migrations/0001_v1_baseline.sql
cmp hotel-app-be/database/postgres/seed.sql \
  hotel-desktop/src-tauri/database/postgres/seed.sql
```

Expected: only canonical and mirrored baseline/seed are listed; both `cmp`
commands exit 0.

- [ ] **Step 4: Initialize a disposable PostgreSQL database**

Create an explicitly named disposable database on the configured PostgreSQL 19
server, apply only the two files, query the revision and representative schema
and seed records, then drop only that database:

```bash
createdb hotel_app_two_file_verify
psql -v ON_ERROR_STOP=1 -d hotel_app_two_file_verify \
  -f hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
psql -v ON_ERROR_STOP=1 -d hotel_app_two_file_verify \
  -f hotel-app-be/database/postgres/seed.sql
psql -v ON_ERROR_STOP=1 -d hotel_app_two_file_verify -c \
  "SELECT generation, version FROM hotel_schema_revisions;
   SELECT to_regclass('public.team_members');
   SELECT name FROM permissions WHERE name = 'loyalty:manage';
   SELECT key FROM system_settings WHERE key = 'tax_rate';"
dropdb hotel_app_two_file_verify
```

If no local PostgreSQL 19 server is available, report the exact connection or
tooling failure and rely on static SQL checks plus CI-equivalent compilation.

- [ ] **Step 5: Run full project verification**

Run:

```bash
cd hotel-app-be
cargo fmt -- --check
cargo test --test status_vocabulary
cargo check --all-features
cargo clippy --all-features -- -D warnings

cd ../hotel-desktop/src-tauri
cargo fmt -- --check
cargo check
```

Expected: every command exits 0 with no clippy warnings.

- [ ] **Step 6: Review the final diff and commit documentation**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Confirm only planned files changed and deleted SQL content is represented in
baseline or seed. Then:

```bash
git add hotel-app-be/database/README.md docs/ongoing-dev.md AGENTS.md
git commit -m "docs: describe two-file PostgreSQL initialization"
```
