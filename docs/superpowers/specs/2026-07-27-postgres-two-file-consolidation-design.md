# PostgreSQL Two-File Consolidation Design

## Goal

Replace the current PostgreSQL initialization and upgrade resources with two
canonical backend SQL files:

1. `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
2. `hotel-app-be/database/postgres/seed.sql`

The desktop bundle may contain generated mirrors of these two files. No
PostgreSQL patch or legacy upgrade SQL remains.

## Compatibility Boundary

Only a fresh PostgreSQL 19 database initialized from the consolidated baseline
and seed is supported.

The following databases require a manual backup/export followed by a fresh
rebuild:

- PostgreSQL 18.4 databases.
- PostgreSQL 19 databases created from an older V1 baseline.
- Non-empty databases without the current schema revision.

The application will not patch or upgrade those databases automatically.

## SQL Ownership

### Baseline

`0001_v1_baseline.sql` owns the complete current schema and PostgreSQL 19
physical design:

- Tables, columns, constraints, indexes, views, functions, triggers, and
  property graph definitions.
- Every schema change previously represented by a dated patch.
- The schema revision table, but not the completed revision row.

The baseline must not contain application bootstrap or reference records.

### Seed

`seed.sql` owns all required and bootstrap data:

- System roles and permissions.
- Role-permission mappings and route access policies.
- Settings, reference rows, and transition matrices.
- Loyalty bootstrap records and vouchers.
- Initial operator accounts and property sample records.
- The completed V1 schema revision row.

The current `data.sql` body will run before the current `seed.sql` body inside
one transaction and under one one-time installation guard. This preserves
dependency order while exposing one seed entrypoint.

## Deleted Resources

Delete:

- `hotel-app-be/database/postgres/data.sql`.
- `hotel-app-be/database/postgres/patches/`.
- `hotel-app-be/database/postgres/upgrade/pg18_4_to_v1.sql`.
- All generated desktop mirrors of those resources.
- Make targets, runtime paths, packaging entries, tests, comments, and
  documentation that describe or execute PostgreSQL 18 upgrades, `data.sql`,
  or dated patches.

Historical reports under `.claude/reports/` are evidence snapshots rather than
runtime configuration. They will not be rewritten unless they are part of an
active build, test, or documentation path.

## Runtime and Packaging Flow

Fresh database initialization becomes:

1. Execute `0001_v1_baseline.sql`.
2. Execute `seed.sql`.
3. Apply desktop-only password randomization/repair as currently implemented.

Existing current databases are accepted after schema validation. Existing
legacy databases are rejected with a fresh-rebuild-required error. The desktop
launcher no longer looks for, backs up for, or applies a patch file.

Docker Compose, CI, deployment bundles, Make targets, Tauri resources, and the
desktop sync script will reference only baseline and seed. The sync script
remains the single way to derive desktop SQL mirrors.

## Error Handling

- Both SQL files use `ON_ERROR_STOP`.
- Initialization remains transactional so a seed failure cannot leave a
  partially completed V1 installation.
- Non-empty unversioned or legacy-schema databases fail closed with a concise
  rebuild instruction.
- Missing bundled baseline or seed resources produce explicit packaging
  errors.

## Verification

The implementation must verify:

1. Each dated patch's intended final schema or data state is present in the
   consolidated baseline or seed before the patch is deleted.
2. No active source, build, test, packaging, or documentation path references
   PostgreSQL 18.4, the legacy upgrade script, `data.sql`, or a patch SQL file.
3. Backend and desktop baseline/seed mirrors are byte-identical after resource
   sync.
4. A fresh empty PostgreSQL database initializes successfully using only
   baseline then seed.
5. Backend formatting, checks, clippy, and relevant tests pass.
6. Desktop resource preparation, formatting, and Rust checks pass.

The opt-in PostgreSQL 19 optimization and benchmark SQL files are outside this
consolidation. They are neither initialization patches nor PostgreSQL 18
compatibility resources.
