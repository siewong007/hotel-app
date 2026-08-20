# Database Convergence Design

**Date:** 2026-08-21
**Status:** Approved for implementation planning
**Workstream:** 1 of the risk-first Critical/High remediation program

## Purpose

Restore a dependable path from the V1 PostgreSQL baseline to already-installed V1
databases. The repository currently updates the baseline for fresh installations but
has no general mechanism that applies the same changes to live server and desktop
databases. That gap is already visible in the development database: its
`bookings_status_check` constraint lacks `pending_payment` and
`pending_confirmation`, causing ten integration-test failures even though the current
baseline accepts both values.

This workstream establishes an ordered, idempotent patch lifecycle and uses it to
consolidate the known V1 compatibility changes. It does not change financial records,
drop unexplained live objects, rewrite Git history, or implement the later
authorization, authentication, accounting, audit, and performance fixes.

## Current State

- Fresh PostgreSQL databases run `0001_v1_baseline.sql` and `seed.sql` once.
- Server deployment, Docker initialization, CI, and desktop packaging hardcode those
  two resources.
- Existing server databases receive ad hoc operator SQL copied from the deployment
  guide.
- Desktop has one narrowly hardcoded payment-idempotency upgrade in Rust.
- `hotel_schema_revisions` records the V1 baseline but is not used as an ordered patch
  ledger.
- The live database has 107 public tables while the baseline defines 96. Those extra
  objects have not been classified and must not be deleted by inference.

## Chosen Approach

Use an ordered, checksummed patch catalog applied by deployment and desktop lifecycle
code, while keeping ordinary backend startup read-only with respect to schema.

The rejected alternatives are:

1. A backend-startup migrator. This makes every process capable of schema mutation and
   creates avoidable coordination risk when multiple instances start concurrently.
2. Manual-only patch scripts. This retains the current failure mode: a valid baseline
   change can ship without ever reaching an installed database.
3. A single consolidated migration. This is hard to audit, cannot represent already
   applied compatibility work accurately, and makes future changes repeat the same
   problem.

## Source Layout

The backend database resources remain authoritative:

```text
hotel-app-be/database/postgres/
  migrations/0001_v1_baseline.sql
  seed.sql
  patches/
    manifest.tsv
    0002_google_subject.sql
    0003_payment_idempotency.sql
    0004_booking_status_vocabulary.sql
```

`manifest.tsv` contains one ordered row per patch with these fields:

```text
generation  version  name  sha256  file
```

Versions are immutable within generation 1. A changed patch must receive a new
version; an already-published file is never edited in place. The SHA-256 value covers
the exact patch bytes. CI, the server/local runner, and desktop verify manifest/file
agreement before execution. The desktop may add `sha2` as a direct dependency to
verify its signed bundled resources; that crate is already present transitively in the
desktop lockfile, and this is a security boundary rather than a general utility
dependency.

## Patch Contract

Every patch is independently rerunnable and follows the same contract:

1. Require the recognized generation 1, version 1 baseline revision.
2. Acquire one transaction-scoped PostgreSQL advisory lock shared by all V1 patches.
3. Read the `(generation, version)` revision row.
4. Skip without DDL when the recorded checksum matches.
5. Abort when the version exists with a different checksum.
6. Accept only documented compatible pre-patch shapes. Abort with a diagnostic when an
   object has an unexpected type, constraint, or index definition.
7. Apply all DDL inside the same transaction.
8. Insert the revision row last, then commit.

The revision row and schema change therefore succeed or roll back together. A patch
also recognizes a compatible schema that was updated manually before the catalog
existed: it verifies the final shape and records the revision without destructive
rework.

Patches use PostgreSQL catalog checks and parameter-free DDL only. They do not contain
application data, financial corrections, or best-effort statements that hide errors.

## Initial Catalog

### 0002 — Google subject

Consolidate the deployment guide's existing Google guest sign-in operator step. Ensure
`users.google_subject` has the baseline type/nullability and ensure its partial unique
index matches the baseline. A compatible manually upgraded database is recorded
without rebuilding the index.

### 0003 — Payment idempotency

Move the existing server operator SQL and desktop inline Rust upgrade into one patch.
Ensure both payment tables have the expected idempotency columns and the three expected
unique indexes. Preserve the current transactional replacement of receipt uniqueness;
never leave the old index dropped after a failed replacement.

After this patch is integrated, desktop code no longer owns a duplicate DDL string and
the deployment guide no longer owns an executable copy of the change.

### 0004 — Booking status vocabulary

Bring installed V1 databases to the current baseline definition of
`bookings_status_check`, including `pending_payment` and `pending_confirmation`.
This broadens the accepted vocabulary and does not rewrite existing booking rows.

The V1 baseline remains the source of truth for fresh databases and continues to
contain the final form of all three changes.

## Execution Flows

### Server deployment

1. Verify the release bundle and patch manifest.
2. Create and durably publish the existing pre-deploy database backup.
3. Wait for PostgreSQL readiness.
4. Apply all pending patches in manifest order.
5. Activate the new application containers.
6. Run the existing health checks.

Patches are backward-compatible with the previous application version. If validation
or patching fails, deployment stops before application activation, the failed patch
transaction is rolled back, and the previous application version remains active.

For a new database, the baseline and seed already create the final schema. Deployment
still runs the catalog after PostgreSQL initialization and before the backend's first
activation, allowing each patch to verify the final shape and record its revision.

### Desktop startup

1. Classify the database as fresh, unversioned, or recognized V1 using the existing
   logic.
2. Initialize a fresh database from baseline and seed when appropriate.
3. Verify the bundled manifest and patch bytes.
4. Apply pending patches to a recognized V1 database before launching the backend.
5. Launch the backend only after all patches succeed.

An unversioned or unsupported database remains a manual, backup-first recovery case.
A patch failure prevents backend launch and surfaces a recovery-oriented error; it is
never downgraded to a warning.

The desktop sync script copies the complete patch catalog from backend resources, and
Tauri packages the manifest and SQL files as resources. Tests enforce byte equality
between source and synchronized copies.

### Local and self-managed installations

Add one `make db-patch` entrypoint that invokes the same server runner against
`DATABASE_URL`. The command prints the recognized baseline, applied/skipped patch
versions, and final revision level. It returns nonzero on any integrity, compatibility,
or SQL failure.

Ordinary backend startup continues to validate required schema and refuses an
incompatible database; it does not apply patches.

## Failure Handling

- Missing manifest/file, malformed manifest, duplicate version, non-monotonic order,
  or SHA-256 mismatch: abort before connecting or applying DDL.
- Missing or mismatched V1 baseline revision: abort without mutation.
- Applied revision with a different checksum: abort and require operator review.
- Unexpected live object shape: abort with the object name and observed mismatch.
- SQL failure: roll back the complete patch, leave its revision absent, and stop later
  patches.
- Concurrent runners: the advisory lock serializes them; the second runner observes
  and skips the committed revision.
- Deployment patch failure: do not activate the new application version.
- Desktop patch failure: do not launch the backend.

Errors exposed to operators include the patch version and safe recovery action. Logs
retain detailed SQL/process diagnostics without exposing database credentials.

## Schema Drift Reporting

Add a read-only reporting command for a target `DATABASE_URL`. It compares target
catalog metadata with a scratch database built from the current baseline and seed and
reports missing, changed, and additional public objects.

The report must not issue DDL or DML against the target database. In particular, this
workstream does not drop, rename, or otherwise alter the eleven additional live tables.
Their ownership and retention policy require separate review.

## Verification

### Catalog and runner tests

- Manifest parsing rejects malformed rows, duplicate versions, gaps or disorder, and
  missing files.
- Exact patch bytes match every manifest SHA-256 value.
- Backend and desktop copies remain byte-for-byte identical.
- Server release bundles contain the runner, manifest, and every listed patch.
- Deployment invokes patching after backup and before new application activation.

### Live PostgreSQL tests

Create a disposable current-baseline database, deliberately return only the affected
objects to their documented pre-patch V1 shapes, then prove:

- all three patches apply successfully;
- their revision rows are inserted once;
- a second complete run performs no schema change;
- checksum mismatch is rejected;
- an unsupported/unversioned schema is rejected;
- an injected patch failure rolls back both DDL and revision metadata;
- concurrent attempts serialize and finish with one revision row;
- schema-only dumps from current baseline + seed and downgraded V1 + patches are
  equivalent after normalization and are both non-trivial.

The booking integration cases using `pending_payment` and `pending_confirmation` must
turn green against the patched database.

### Verification gates

Run and report the real exit code and exact pass/fail/ignored counts for:

```text
cargo check --all-features
cargo clippy --all-features -- -D warnings
cargo test --all-features --no-fail-fast
desktop Rust tests
desktop resource synchronization verification
live PostgreSQL patch/convergence tests
```

The suite is not called green based only on exit code. If the previously observed
maintenance audit-count test still fails after the schema correction, diagnose and
isolate its own records rather than relaxing assertions, deleting the test, or hiding
the failure. Full-gate results must distinguish product failures, test-isolation
failures, and ignored fix-gated tests.

## Acceptance Criteria

1. Fresh baseline installations and patched compatible V1 installations converge on
   the same relevant schema.
2. Every known V1 compatibility change has exactly one authoritative patch file.
3. Server deployment applies pending patches only after a successful backup and before
   activating new application code.
4. Desktop applies the same catalog before backend launch.
5. Reapplication is a no-op and concurrent runners are safe.
6. Integrity or compatibility failures are explicit and leave no partial patch.
7. The ten booking-status integration failures are resolved by schema convergence.
8. Full verification reports exact run counts and does not claim a false green gate.
9. Live schema drift is reported without deleting objects or rewriting historical
   records.

## Out of Scope

- Dropping or adopting the eleven unexplained live tables.
- Rewriting historical financial or currency data.
- Applying the later `customer_ledgers.guest_id` foreign-key correction; that requires
  its own data preflight and belongs to the financial-integrity workstream.
- Rewriting Git history for eKYC files.
- Authorization exposure, passkey and lockout races, payment-capture verification,
  billable-total consolidation, currency propagation, ledger reversal behavior, RBAC
  audit transactionality, query performance, and frontend pagination. Each receives a
  separate spec-plan-implementation cycle after this foundation is verified.
