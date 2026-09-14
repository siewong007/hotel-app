# Data Transfer — JSON Backup and Restore

The data-transfer feature exports the hotel's business data as a single
versioned JSON document (`hotel-backup` v3) and restores it through a staged
`upload → preview → execute → poll` pipeline. It is the operator-facing backup
format: portable across environments, self-describing (every file carries a
manifest of what it contains and what was deliberately excluded), and safe to
diff against a destination before anything is written.

It is **not** a replacement for `pg_dump`. `pg_dump` captures the whole
database — credentials, sessions, audit history, schema bookkeeping — and is
the recovery point of last resort (see the nightly `saliminn-backup.timer`
dumps in [deployment.md](deployment.md#backup-and-recovery)). A `hotel-backup`
file deliberately carries *business data only*: it never contains password
hashes, sessions, tokens, or eKYC evidence, so it is safe to move between
environments and to restore into a database that already has users.

## Table of Contents

1. [Architecture](#architecture)
2. [The `hotel-backup` v3 file format](#the-hotel-backup-v3-file-format)
3. [Entity coverage](#entity-coverage)
4. [API endpoints](#api-endpoints)
5. [Import semantics](#import-semantics)
6. [Large-data strategy](#large-data-strategy)
7. [Configuration](#configuration)
8. [Security and retention](#security-and-retention)
9. [Recovery runbook](#recovery-runbook)
10. [Troubleshooting](#troubleshooting)
11. [Older file formats (v1, v2)](#older-file-formats-v1-v2)

---

## Architecture

The domain follows the flat-by-layer layout —
`src/{routes,handlers,services,repositories,models}/data_transfer.rs` — plus
one extra service file for the staged-import pipeline:

| Layer | File | Role |
|---|---|---|
| Routes | `src/routes/data_transfer.rs` | Path registration, auth guards, the 256 MB `DefaultBodyLimit` on the upload route |
| Handlers | `src/handlers/data_transfer.rs` | Thin HTTP translation; maps `StageUploadError::PayloadTooLarge` to 413 (the `ApiError` enum has no such variant) |
| Service | `src/services/data_transfer.rs` | Entity catalog (`TABLE_INSERT_ORDER`, `EXCLUDED_TABLES`, `EXCLUDED_EXPORT_COLUMNS`), the streaming v3 export writer, the legacy v1/v2 import paths |
| Service | `src/services/data_transfer_jobs.rs` | Staged uploads, format detection, import preview, the process-local job registry, and the background import runner |
| Repository | `src/repositories/data_transfer.rs` | All SQL: catalog introspection (`pg_class`/`pg_constraint`/`information_schema`), the export cursor, `insert_transfer_row`, FK relax/restore, sequence resets |
| Models | `src/models/data_transfer.rs` | The v3 document structs (`BackupFile` et al.) and every request/response DTO |

Request flow for an export: route guard (`settings:manage`) →
`export_booking_data_handler` → `export_booking_data_body` → `stream_export`,
which returns a `Body` stream the handler wraps with a `Content-Disposition`
attachment filename.

Request flow for an import: route guard (super-admin) → handler →
`data_transfer_jobs`, which writes/reads staged files under
`private_uploads/data-transfer/` and — for `execute` — spawns a `tokio` task
rather than holding the request open. The job's state lives in a process-local
registry (`static IMPORT_JOBS: OnceLock<Mutex<HashMap<Uuid, …>>>`) that the
status endpoint polls; finished jobs expire from the registry after one hour.

Two registries matter operationally:

- **Staged files** — `private_uploads/data-transfer/upload-<uuid>.json` on disk,
  written through a `upload-<uuid>.part` temp file so a preview or job never
  opens a half-written body. Files older than 24 h are swept at startup and on
  every new upload; a finished job deletes its own file.
- **Import jobs** — the in-memory registry above. It is *not* durable: a
  backend restart loses every running and finished job (the staged file is
  left for the sweep; the database itself is untouched mid-job only if the
  transaction had already committed — see [Import semantics](#import-semantics)).

## The `hotel-backup` v3 file format

One JSON object, emitted in a fixed key order. Downloaded as
`saliminn-backup-<YYYYmmddTHHMMSSZ>.json` (UTC timestamp) with
`Content-Type: application/json`.

```json
{
  "format": "hotel-backup",
  "version": 3,
  "kind": "business-data",
  "exportId": "3f8a2c1e-7b9d-4e5f-9a1c-0d2e4f6a8b0c",
  "exportedAt": "2026-09-14T09:25:30.123456+00:00",
  "applicationVersion": "0.2.0",
  "source": {"environment": "production", "databaseProvider": "postgresql"},
  "manifest": {
    "entities": [
      {"name": "public.amenities", "primaryKey": ["id"], "columns": ["id", "name", "created_at"]}
    ],
    "exclusions": [
      {"name": "public.users", "reason": "credentials_and_auth_state"}
    ]
  },
  "tables": {
    "public.amenities": [{"id": 1, "name": "Wi-Fi", "created_at": "2026-01-01T00:00:00+00:00"}],
    "public.bookings": []
  },
  "integrity": {
    "entities": 75,
    "rows": 49069,
    "entityRows": {"public.amenities": 12, "public.bookings": 8021},
    "completedAt": "2026-09-14T09:25:31.700000+00:00"
  }
}
```

Field by field:

| Field | Value |
|---|---|
| `format` | Always `"hotel-backup"`. Anything else → the import reports `unsupported backup format '<value>'`. |
| `version` | Integer `3`. Any other value → `unsupported hotel-backup version <n> — this build understands version 3`. |
| `kind` | Payload class; only `"business-data"` exists. Other values are rejected at import. |
| `exportId` | UUIDv4 identifying this exact file. Also recorded on the `data_export` audit row, so a download can be tied to its event. |
| `exportedAt` | RFC 3339 export start timestamp (UTC). |
| `applicationVersion` | The backend's `CARGO_PKG_VERSION`. Preview warns when it differs from the importing build. |
| `source.environment` | The exporter's `ENVIRONMENT`/`APP_ENV`, lowercased: `development`, `staging`, or `production`. Preview warns when it differs from the destination's. |
| `source.databaseProvider` | Always `"postgresql"`. |
| `manifest.entities` | One entry per transferable entity, in the same alphabetical order `tables` uses: `name` (schema-qualified), `primaryKey` (column list; `[]` for keyless tables), `columns` (the exported columns, schema order). Carries **no** row counts — those land in `integrity`. |
| `manifest.exclusions` | Every schema table **not** in the transferable set, with a reason code — nothing is silently omitted. See [Entity coverage](#entity-coverage). |
| `tables` | `entity → [row objects]`, alphabetical by entity name. Row key order is schema column order; each row is produced by `row_to_json`, so `timestamptz`/`jsonb`/`bytea`/`uuid`/`numeric` round-trip through PostgreSQL's JSON rendering. |
| `integrity` | Trailer written last: `entities` (count of keys in `tables`), `rows` (total rows actually streamed), `entityRows` (per-entity counts actually written), `completedAt`. |

The trailer is the truncation check: the counts are the rows *actually
streamed*, not a `COUNT(*)` pre-pass, so a file whose `tables` contents disagree
with `integrity.entityRows` was truncated or modified — preview flags it with a
warning. A download missing the closing `integrity` block is not valid JSON and
fails to parse at all.

## Entity coverage

75 tables are transferable. The catalog lives in
`services/data_transfer.rs::TABLE_INSERT_ORDER` (parents before children), with
`repositories/data_transfer.rs::KNOWN_TABLES` as a deliberately identical mirror
that whitelist-checks every table name interpolated into SQL — a test fails if
the two lists drift. Which entities a given database actually exports is
introspected live from `pg_class`, so the manifest always describes the real
schema.

Grouped by domain:

- **Configuration & reference:** `amenities`, `booking_channels`, `companies`,
  `corporate_accounts`, `corporate_account_contacts`, `email_templates`,
  `rate_plans`, `reward_catalog`, `services`, `system_settings`
- **Guests:** `guests`, `guest_documents`, `guest_notes`, `guest_preferences`,
  `guest_segments`, `guest_complimentary_credits`, `guest_reviews`,
  `user_guests`
- **Consent & notifications:** `email_suppressions`,
  `notification_subscriptions`, `notification_consent_events`,
  `consent_records`, `staff_notifications`, `staff_notification_reads`
- **Marketing:** `promotions`, `promotion_channels`, `promotion_room_types`,
  `promotion_loyalty_tiers`, `vouchers`, `voucher_redemptions`,
  `voucher_redemption_allocations`, `email_campaigns`
- **Loyalty:** `loyalty_programs`, `loyalty_program_rules`, `loyalty_tiers`,
  `loyalty_memberships`, `loyalty_members`, `loyalty_accounts`,
  `loyalty_rewards`, `loyalty_transactions`, `loyalty_redemptions`,
  `reward_redemptions`, `points_transactions`
- **Inventory:** `room_types`, `room_type_amenities`, `rooms`, `room_events`,
  `room_rates`, `room_status_transitions`, `room_status_change_log`,
  `room_history`, `room_changes`, `online_inventory_allocations`
- **Bookings & money:** `bookings`, `booking_guests`, `booking_history`,
  `booking_modifications`, `booking_services`, `payments`,
  `payment_receipt_requests`, `invoices`, `customer_ledgers`,
  `customer_ledger_payments`
- **Operations:** `housekeeping_tasks`, `maintenance_tickets`,
  `night_audit_runs`, `night_audit_details`, `night_audit_posted_nights`,
  `self_checkin_events`
- **Support & teams:** `support_conversations`, `support_messages`,
  `support_events`, `teams`, `team_members`, `team_roles`

29 tables are **excluded** — emitted in `manifest.exclusions` with one of five
reason codes:

| Reason | Tables | Why |
|---|---|---|
| `credentials_and_auth_state` | `public.users`, `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_roles`, `public.user_permissions`, `public.route_access_policies` | Password hashes, TOTP seeds, RBAC grants — exporting hands every `settings:manage` holder the credential store; importing could plant a forged `is_super_admin` account |
| `session_or_token_material` | `public.refresh_tokens`, `public.user_sessions`, `public.passkeys`, `public.passkey_challenges`, `public.two_factor_challenges`, `public.guest_portal_sessions`, `public.payment_retry_capabilities` | Live sessions and token/challenge state |
| `sensitive_ekyc_pii` | `public.ekyc_verifications`, `public.ekyc_decision_history`, `public.ekyc_access_events`, `public.ekyc_sensitive_reveals`, `public.ekyc_idempotency_keys`, `public.ekyc_notes`, `public.ekyc_reason_codes` | Identity documents and biometric evidence |
| `ephemeral_queue_state` | `public.email_deliveries`, `public.support_action_idempotency_keys`, `public.support_guest_request_idempotency_keys` | Live send/request queues — re-importing would replay sends |
| `internal_system_table` | `public.job_runs`, `public.hotel_schema_revisions`, `app.invalid_data_quarantine`, `public.audit_logs`, `public.audit_logs_default` | Platform bookkeeping, not business data |

Two **columns** inside a transferable table are also excluded —
`EXCLUDED_EXPORT_COLUMNS` strips them from the `SELECT` projection, the manifest
`columns` list, and the output, so the values never leave the database:

| Table | Column | Why |
|---|---|---|
| `public.bookings` | `pre_checkin_token` | Live guest-portal bearer token — the token alone authenticates a pre-check-in lookup, so a leaked file would hand out working portal links |
| `public.bookings` | `pre_checkin_token_expires_at` | Companion expiry for the same token |

Not transferable but also not "missing": uploaded file *blobs* under
`private_uploads/` (eKYC documents, payment receipts) are out of scope — the
backup carries their metadata rows only.

## API endpoints

All paths live under `/api`. Export routes need the grantable
`settings:manage` permission; every import route additionally requires a
super-admin account (`users.is_super_admin`) — imports clear whole tables and
remap references, so they sit above the permission hierarchy.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /data-transfer/export` | `settings:manage` | Streamed v3 download; `Content-Disposition: attachment; filename="saliminn-backup-<ts>.json"` |
| `GET /data-transfer/export/preview` | `settings:manage` | `{generated_at, counts, total_records, tables[], entities[], exclusions[]}` — live per-entity counts plus the manifest an export would declare (the legacy wrapper keeps snake_case keys; the `entities`/`exclusions` entries inside are camelCase) |
| `POST /data-transfer/import/uploads` | super-admin | Streams the request body to `private_uploads/data-transfer/upload-<uuid>.json` (via `.part`); returns `{uploadId, bytes, detectedFormat}` where `detectedFormat` is `"v3"`, `"v2"`, `"v1"`, or `"unknown"` |
| `POST /data-transfer/import/preview` | super-admin | `{uploadId}` → `ImportPreview` — the pre-flight diff below |
| `POST /data-transfer/import/execute` | super-admin | `{uploadId, mode, onConflict?, tables?, confirm}` → `202 {jobId}`; `confirm` must be `true` |
| `GET /data-transfer/import/jobs/{jobId}` | super-admin | `{status: "running"\|"succeeded"\|"failed", progress: {entity, rowsApplied, totalRows}, result?, error?}`; finished jobs are retained 1 h, then 404 |
| `DELETE /data-transfer/import/uploads/{uploadId}` | super-admin | Discard a staged file → `204`; 409 while a running job reads it, 404 when absent |

`ImportPreview` (returned by `POST /import/preview`):

```json
{
  "uploadId": "…",
  "format": "v3",
  "version": 3,
  "exportedAt": "2026-09-14T09:25:30.123456+00:00",
  "sourceEnvironment": "production",
  "applicationVersion": "0.2.0",
  "entities": [
    {"name": "public.guests", "rows": 120, "new": 110, "existing": 10, "skipped": 0}
  ],
  "unsupportedEntities": ["public.hack_the_planet"],
  "validationErrors": [],
  "relationshipProblems": [
    {"entity": "public.team_members", "rows": 4,
     "reason": "user_id references public.users rows not present in this database"}
  ],
  "warnings": ["the backup was exported from a different environment ('staging' vs this 'production')"],
  "totalRows": 5000
}
```

- `entities[].new`/`existing` are computed by primary-key diff against the
  destination (`WHERE pk = ANY($1)` in 5,000-key batches; composite-key tables
  use per-row `EXISTS`). `skipped` counts rows the missing-reference policy
  would drop.
- `unsupportedEntities` lists file entities that are neither transferable nor a
  known exclusion but do exist in the schema; names not in the schema at all
  land in `validationErrors` instead, and excluded tables (e.g. a hand-edited
  file containing `public.users`) produce a warning and are never imported.
- `validationErrors` makes a file unimportable (bad version/kind/format, rows
  that are not JSON objects); `relationshipProblems` and `warnings` are advisory.
- Preview also cross-checks the file against itself: entities present but absent
  from `manifest.entities`, and `integrity.entityRows` disagreeing with the
  actual row arrays, both warn — signs of a truncated or hand-edited file.

`ImportJobResult` (the `result` of a succeeded job): `{inserted, updated,
skipped, report: {entities: [{entity, inserted, updated, skipped}],
relationshipProblems, unsupportedEntities}}`.

## Import semantics

An execute runs **one transaction** for the whole file:

1. `relax_foreign_keys` — every immediate FK on the selected tables becomes
   `DEFERRABLE INITIALLY DEFERRED`.
2. `ALTER TABLE … DISABLE TRIGGER USER` on the selected tables.
3. `SET CONSTRAINTS ALL DEFERRED` — ordering no longer matters; this is what
   makes the `users` ↔ `guests` cycle importable.
4. `mode: "restore"` clears the selected tables in reverse order (`DELETE FROM`,
   child before parent) — expanded first: selecting a table also selects every
   transferable dependent that references it, so a partial restore cannot leave
   FK-blocked leftovers. **Dependents are cleared even when the file carries no
   rows for them** — the preview/result report those entities with zero
   inserted rows.
5. Rows insert in `transfer_order` — a deterministic topological sort over the
   live FK graph (with deterministic cycle-breaking), not the file's ordering.
   Inserts use `INSERT … OVERRIDING SYSTEM VALUE … jsonb_populate_record`, so
   identity/serial keys keep the file's values and generated columns are never
   written.
6. `SET CONSTRAINTS ALL IMMEDIATE` forces the deferred checks while the
   transaction can still roll back — a violation fails the import as a 400-class
   job error naming the entity and row.
7. Triggers re-enable, relaxed FKs restore to `INITIALLY IMMEDIATE`, serial
   sequences reset via `pg_get_serial_sequence`/`setval`, then `COMMIT`.

Any failure — bad row, deferred FK violation, dropped connection — rolls the
whole transaction back: **an import is all-or-nothing**, never partial.

Modes:

- `merge` — insert only; conflicts resolve per `onConflict`.
- `restore` — clear selected transferable tables (plus expanded dependents),
  then insert. `onConflict` is irrelevant: cleared tables have nothing to
  conflict with.

`onConflict` (merge only; defaults to `skip` when omitted):

| Policy | SQL | Effect |
|---|---|---|
| `skip` | `ON CONFLICT DO NOTHING` | Existing destination row wins; counted `skipped` |
| `update` | `ON CONFLICT (pk) DO UPDATE SET col = EXCLUDED.col` | Every non-key, non-generated column in the row is overwritten; counted `updated` vs `inserted` via the `xmax = 0` discriminator. Tables with no PK — or rows carrying only key columns — degrade to `DO NOTHING`; a non-PK unique violation still aborts the import |
| `fail` | plain `INSERT` | The first duplicate aborts the transaction |

**Missing references to non-transferable parents** (chiefly `public.users`,
which a backup never contains): every FK from a transferable table to an
excluded one is checked per row against the destination's existing keys.

- *Audit columns* — the `who caused this` columns (`created_by`, `modified_by`,
  `actor_user_id`, `assigned_to_user_id`, …, `AUDIT_USER_FK_COLUMNS`) —
  **remap to the importing admin**, so attribution survives the missing account.
- *Nullable non-audit columns* become `NULL`.
- *Required non-audit columns* (e.g. `team_members.user_id`) — the row is
  skipped, counted, and reported in `relationshipProblems` on both the preview
  and the finished job's report. The importer never fabricates a user.

References *between* transferable entities resolve through the file and the
deferred constraint check; the preview separately reports keys that exist in
neither the file nor the destination ("will fail at commit").

The optional `tables` filter on execute takes schema-qualified names
(`public.guests`), must be a subset of the transferable set present in the file,
and — under `restore` — still expands to dependents.

## Large-data strategy

- **Export** never materializes the document: `stream_export` emits the header
  and manifest as the first bytes, then pulls each table through a SQL cursor
  (`DECLARE … CURSOR FOR SELECT row_to_json(t) …`, `FETCH FORWARD 500`) inside
  one read transaction — a single consistent snapshot, first byte immediate,
  memory bounded to a few hundred wide rows at a time. Each `FETCH` is its own
  statement under the 120 s `statement_timeout`. This is the fix for the
  Cloudflare 502s the buffered exporter caused (zero bytes until the dump
  finished, peak RSS scaling with DB size).
- **Import** parses `tables` into `BTreeMap<String, Vec<Box<RawValue>>>` — rows
  stay raw JSON text (~1× file size resident, not ~3.5× as `Value` trees) — and
  converts row-by-row inside the job task. The parse itself runs in
  `spawn_blocking` so a 256 MB file never sits on a runtime worker.
- **Upload cap:** 256 MB, counted byte-by-byte while the body streams (a
  whitespace prefix cannot bypass it). Above that, split the export first.
- **Container headroom:** the production backend `mem_limit` is `384m`
  (`deploy/docker-compose.prod.yml`, raised from 192m for exactly this feature);
  the staging backend stays at `128m` — stage only modest backups there.
- **Known bound:** v3 rows become `Map<String, Value>` at insert, so numbers go
  through `f64` — a `numeric` beyond ~15 significant digits would drift. Every
  schema numeric is ≤ `numeric(12,2)`, so this cannot bite today; it is a bound
  on the format, not a live defect.

## Configuration

| Knob | Where | Value |
|---|---|---|
| Staging directory | `private_uploads/data-transfer/` relative to the backend working dir — `/app/private_uploads/data-transfer/` in the container | Created on first upload |
| `private_uploads` mount | `deploy/docker-compose.prod.yml` backend volumes | `/opt/saliminn/data/private_uploads → /app/private_uploads` (staging: `/opt/saliminn-staging/…`); same convention eKYC/receipts use |
| Upload cap | `MAX_UPLOAD_BODY_BYTES` (route) + `MAX_UPLOAD_BYTES` (service) | 256 MiB, both enforced |
| Format sniff | `SNIFF_PREFIX_BYTES` | First 4 KB |
| Staged-file TTL | `STAGED_UPLOAD_TTL`, swept in `main.rs` at startup and per upload | 24 h |
| Finished-job retention | `FINISHED_JOB_TTL` | 1 h |
| `source.environment` | `APP_ENV`/`ENVIRONMENT` (`development`/`staging`/`production`) | `production` in both compose files; `development` fallback when config is uninitialized |
| Backend memory | `deploy/docker-compose.prod.yml` `mem_limit` | `384m` |

## Security and retention

- **Files contain PII.** A backup carries guests, bookings, ledgers, and support
  threads. Treat `private_uploads/data-transfer/` and any downloaded
  `saliminn-backup-*.json` like the database itself: the directory is
  bind-mounted on the host, is **not publicly served** (only authenticated
  handlers ever read it), and staged files self-delete 24 h after abandonment.
- **Exports** run under `settings:manage`; the streamed document never contains
  credential/session/eKYC material — the table-level exclusions above plus the
  `bookings.pre_checkin_token` column exclusion are enforced at the `SELECT`
  projection, so the values cannot leak into the file.
- **Every import endpoint is super-admin only** (`is_super_admin` on an active,
  non-deleted account), and execute requires `confirm: true`.
- **Audit:** `data_export` is logged once the export body was fully produced
  (with `export_id`, entity and row counts — a client disconnect skips the
  audit). `data_import` is logged at job start, completion, and failure (with
  `job_id`, mode, conflict policy, per-entity counts). `job_runs` records each
  `data_transfer_import` outcome for the admin Jobs page. No secrets or row
  contents reach logs or error responses.
- **Token-in-log caveat:** the host Caddy access log (journald) redacts
  `?token=` query params only; URLs themselves are otherwise logged. Do not put
  bearer tokens in URLs.

## Recovery runbook

Restoring a backup into an environment — staging rehearsal or production
recovery. Rehearse on staging first (`staging.saliminn.my`, database
`saliminn-staging-db`); the restore path is the same everywhere.

1. **Take a `pg_dump` of the destination first.** The JSON import is
   all-or-nothing per run, but `restore` mode deletes before it inserts — the
   dump is the way back if you execute against the wrong file or the wrong
   environment:
   ```bash
   docker exec saliminn-db pg_dump --format=custom --no-owner --no-acl \
     -U hotel_admin hotel_management > predeploy-restore-$(date -u +%Y%m%dT%H%M%SZ).dump
   ```
2. **Export (or locate) the backup.** Admin → Data Transfer → Export, or
   `GET /api/data-transfer/export` with a `settings:manage` token. Verify the
   download ends with the `integrity` trailer — a file without it is truncated.
3. **Upload.** `POST /api/data-transfer/import/uploads` with the file as the
   raw request body → `{uploadId}`. Nothing is parsed or written to the
   database yet.
4. **Preview.** `POST /api/data-transfer/import/preview` `{uploadId}` → read
   `validationErrors` (must be empty to proceed), `relationshipProblems`,
   `warnings`, `unsupportedEntities`, and the per-entity `new`/`existing`/
   `skipped` counts. An environment or version mismatch here is a signal to
   stop and think, not to click through.
5. **Execute.** `POST /api/data-transfer/import/execute` with
   `{uploadId, mode: "restore"|"merge", onConflict: "skip"|"update"|"fail",
   confirm: true}` → `202 {jobId}`. For a full recovery use `mode: "restore"`
   with no `tables` filter.
6. **Poll.** `GET /api/data-transfer/import/jobs/{jobId}` until `succeeded` or
   `failed`. A large restore takes minutes; progress reports the current entity
   and rows applied.
7. **Verify.** The job result's per-entity counts against the preview's; spot-
   check the admin UI (a booking, the room board, a ledger). Sequences were
   reset as part of the transaction — new records get fresh ids cleanly.
8. **If it failed:** the transaction rolled back — the database is exactly as
   before. Read `error`, fix the file or the selection, re-upload (the consumed
   file is deleted either way), and retry.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `413` on upload | Body exceeded 256 MiB | Split the export (export per-entity subsets is not yet a feature — use `pg_dump`/`pg_restore` for very large databases) |
| `400 "the uploaded file is not a JSON document"` | First non-whitespace byte is not `{` | Upload the `.json` file itself, not a zip/dump |
| `400 "confirm must be true"` | Execute sent without `confirm: true` | Deliberate gate — the operation is destructive; send `confirm: true` |
| `400 "unsupported hotel-backup version N"` / `unsupported backup format` / `unsupported backup kind` | File parses as v3-shaped but carries an unknown version/format/kind | Check what produced the file; preview reports the same under `validationErrors` before you execute |
| `400 "the staged upload could not be parsed"` | Truncated or malformed file (missing `integrity` trailer, bad JSON) | Re-download/re-export; do not hand-edit mid-document |
| `404 "staged upload not found"` | Upload id unknown, consumed by a finished job, swept (>24 h), or deleted | Re-upload; upload ids are single-use for execute |
| `404 "import job not found or expired"` | Job id unknown, or finished >1 h ago | Finished results are also in the `data_import` audit event and `job_runs` |
| `409 "an import job is already running for this upload"` | Second execute on the same upload while one runs | Poll the existing job instead |
| `409 "a running import job is still reading this upload"` | `DELETE` on an upload mid-import | Wait for the job to finish; it deletes its own file |
| Job `failed` with `row N` / constraint detail | Bad row or dangling reference; whole transaction rolled back | Fix the file (preview's `relationshipProblems` names the columns), or run `merge` with `skip` to absorb conflicts |
| Job `failed` right after a backend restart | The job registry is process-local — a restart abandons running jobs | The transaction rolled back (uncommitted work never survives a restart); re-stage the file — the old one is deleted with the dead job or swept |
| `upload-*.part` / old `upload-*.json` files under `private_uploads/data-transfer/` | Orphaned staging (crashed upload, never executed, dead job) | Harmless — swept after 24 h; or delete manually |
| Export returns 502 / times out through Cloudflare | Should not happen since the streaming rewrite — a regression means the backend restarted mid-export | Check `journalctl -u caddy` for `connection refused`/`EOF` and `docker logs saliminn-backend`; the export is a read transaction, safe to retry |

## Older file formats (v1, v2)

The upload pipeline still accepts the two legacy shapes; detection is a
first-4 KB sniff confirmed by a full parse (preview and execute trust the
parse, not the sniff):

- **v2** — `{version: "2.0", exported_at, tables: {…}}` (the schema-driven
  export). Imports through the same engine as v3 — modes, conflict policies,
  missing-reference handling — but parses rows into `Value` trees, so a v2 file
  costs ~3.5× its byte size in memory inside the job (bounded by the same
  256 MB upload cap).
- **v1** — the legacy flat `BookingDataExport` (`{version: "1.x", guests: [],
  bookings: [], …}`). Runs through the historical importer: `merge`/`restore`
  map to its `import`/`overwrite` modes, conflicts always `skip`, and it keeps
  its room-number-based room remapping. Preview returns row counts only — the
  per-row `new`/`existing` diff and missing-reference scan do not exist for
  this format.
