# Data Transfer → versioned JSON backup/restore + Cloudflare origin fix

**Date:** 2026-09-14
**Status:** executing (subagent-driven)
**Branch:** `data-transfer/backup-redesign` (worktree `.worktrees/data-transfer-backup`)

---

## Global constraints (bind every task)

- **Architecture:** routes → handlers → services → repositories → models (flat-by-layer
  for this domain — `src/{routes,handlers,services,repositories,models}/data_transfer.rs`).
  No new dependencies; `async-stream`, `futures-core`, `serde_json`, `uuid`, `tokio`,
  `chrono` are already present. No schema changes.
- **Security:** never export credentials/authz/session material; never import it either.
  `settings:manage` gates export/preview; `ensure_super_admin` gates every import endpoint.
  Audit-log every export/import start+finish+failure via `services::audit::AuditLog`;
  `core::job_runs::record` logs each job outcome for the admin Jobs page. No secrets or
  row contents in logs or error responses.
- **Memory discipline:** never materialize the whole export or the whole import as
  `serde_json::Value`. Export streams via the existing SQL cursor; import parses the file
  into `BTreeMap<String, Vec<Box<serde_json::value::RawValue>>>` (raw row text ≈ 1× file
  size, not ~3.5× `Value` trees) and converts row-by-row inside the job.
- **Format (user-approved, single JSON document):** the file is one JSON object — see
  §Format below for the exact shape and key order. Export must emit it as a byte stream
  (first byte immediately; no whole-doc buffering).
- **Import flow:** `upload → preview → execute(job) → poll` — see §API. The legacy
  `POST /data-transfer/import` JSON-body endpoint is **removed**; v1/v2 files still import
  through the upload path.
- **Testing:** backend integration tests need `DATABASE_URL`; repo convention is
  early-return without it. Update the `TABLE_INSERT_ORDER` length assertion (56 → 75).
- **Compatibility:** import must still accept v1 (`BookingDataExport`) and v2
  (`{version:"2.0", tables:{…}}`) files.
- Follow AGENTS.md/CLAUDE.md conventions; do not touch files outside this task's list;
  the worktree shares the tree with other sessions — check `git status --short` first.

## Root cause of the Cloudflare error (evidence-backed — resolved in ops track)

Browser → Cloudflare → host Caddy → `backend:3030` (192 MB / 0.45 CPU) → Postgres.
Every retained Caddy log for `GET /api/data-transfer/export` ends `502` (`connection
refused`/`EOF`) during backend restart windows (06:26/06:27/08:36 UTC, 2026-09-14).

1. Old export buffered the entire DB into `serde_json::Value` and serialized before byte
   1 → no output for the whole dump → Cloudflare reports incomplete origin response, and
   peak RSS scaled with DB size on a 192 MB container. Fixed by `f33109e93` (cursor
   streaming) — **but undeployable**.
2. **Deploy blocker:** `77001d419` folded the 1.2–1.23 patch lineage into the baseline and
   reset `manifest.tsv`; `c2981f1e7` republished generation-1 versions 2
   (`deposit-forfeited`, sha256:3a2364…) and 3 (`guest-relations-phase2`, sha256:4969…).
   Prod+staging still record the pre-reset rows `1.2=google-subject` (25db31d1…),
   `1.3=payment-idempotency` (4e3e3641…) → `_begin.sql` raises `patch 1.2 checksum
   mismatch` → `deploy.sh` aborts before `deploy_tag`. Prod still runs `c77beca09`.
3. Manual backend restarts during export attempts produced the 502 bursts.

**Ops fix (done outside the code tasks):** on each pre-reset DB, after a verified
`pg_dump`: `DELETE FROM public.hotel_schema_revisions WHERE generation = 1 AND version > 1;`
then the next deploy applies 0002/0003 (both idempotent converge-style) and proceeds.
No machinery change — the executor requires `generation==1`, first version `==2`,
contiguous versions, so renumbering/generation-bump are worse. Deleted rows remain in
the pre-deploy dump. This is the documented "rebuilt rather than converged" doctrine
applied to the bookkeeping table only.

## Format — `hotel-backup` v3 (single JSON document)

File: `saliminn-backup-<YYYY-MM-DDTHHMMSSZ>.json`, `application/json`, one object:

```json
{
  "format": "hotel-backup",
  "version": 3,
  "kind": "business-data",
  "exportId": "<uuid v4>",
  "exportedAt": "<rfc3339>",
  "applicationVersion": "<env!(CARGO_PKG_VERSION)>",
  "source": {"environment": "<config::get().environment lowercased>", "databaseProvider": "postgresql"},
  "manifest": {
    "entities": [{"name": "public.amenities", "primaryKey": ["id"], "columns": ["id","name", …]}],
    "exclusions": [{"name": "public.users", "reason": "credentials_and_auth_state"}]
  },
  "tables": {
    "public.amenities": [{"id": 1, "name": "Wi-Fi"}],
    "public.bookings": [ … ]
  },
  "integrity": {"entities": 75, "rows": 12345, "entityRows": {"public.amenities": 12, …}, "completedAt": "<rfc3339>"}
}
```

Exact key order is as above (serialize fields in this order — the writer is hand-rolled
byte emission, not `Serialize`, so the order is controlled). `kind` distinguishes payload
class (`business-data` only today). `manifest.entities` carries per-entity
name/PK/column metadata (no row counts — counts land in `integrity.entityRows`, emitted
post-stream from actual streamed rows, so they are truthful and cost no `COUNT(*)` pass).
`manifest.exclusions` lists every schema table not in the transferable set, with a reason
code — nothing is silently omitted. `tables` holds the data in deterministic
**alphabetical entity-name order** (matches the previous `BTreeMap` ordering).
`integrity` is the trailer: totals + per-entity row counts actually written — a truncated
download is detectable by a missing/short trailer.

Import detection: `format == "hotel-backup" && version == 3` → v3; else
`version == "2.0"` with `tables` → v2; else legacy `BookingDataExport` shape → v1.
Unknown/future `format`/`version` → structured 400 naming the found value.

## Entity coverage — 75 transferable / 29 excluded

`transfer_tables()` introspects `pg_class`; coverage = the allowlists
(`TABLE_INSERT_ORDER` in `services/data_transfer.rs`, `KNOWN_TABLES` in
`repositories/data_transfer.rs` — keep them identical). V2/V3 insert order comes from
`transfer_order()` on live FK deps; the constant's order still governs the V1 legacy path.

**Add (19):** `guest_segments`, `email_campaigns`, `email_suppressions`,
`promotion_channels`, `promotion_loyalty_tiers`, `online_inventory_allocations`,
`teams`, `team_members`, `team_roles`, `support_conversations`, `support_messages`,
`support_events`, `room_events`, `payment_receipt_requests`, `staff_notifications`,
`staff_notification_reads`, `notification_subscriptions`, `notification_consent_events`,
`consent_records`.

**Excluded (static registry, name → reason, emitted in the manifest):**

- `credentials_and_auth_state`: `public.users`, `public.roles`, `public.permissions`,
  `public.role_permissions`, `public.user_roles`, `public.user_permissions`,
  `public.route_access_policies`
- `session_or_token_material`: `public.refresh_tokens`, `public.user_sessions`,
  `public.passkeys`, `public.passkey_challenges`, `public.two_factor_challenges`,
  `public.guest_portal_sessions`, `public.payment_retry_capabilities`
- `sensitive_ekyc_pii`: `public.ekyc_verifications`, `public.ekyc_decision_history`,
  `public.ekyc_access_events`, `public.ekyc_sensitive_reveals`,
  `public.ekyc_idempotency_keys`, `public.ekyc_notes`, `public.ekyc_reason_codes`
- `ephemeral_queue_state`: `public.email_deliveries` (live send queue — re-import risks
  re-sends), `public.support_action_idempotency_keys`,
  `public.support_guest_request_idempotency_keys`
- `internal_system_table`: `public.job_runs`, `public.hotel_schema_revisions`,
  `app.invalid_data_quarantine`, `public.audit_logs`, `public.audit_logs_default`

`public.user_guests` stays transferable; its `user_id` rows whose user is absent follow
the missing-required-FK rule (below). Uploaded file blobs (`private_uploads`) are out of
scope — metadata rows only; documented.

## API surface (all paths under `/api`, router = `routes/data_transfer.rs`)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /data-transfer/export` | settings:manage | streamed v3 download, `Content-Disposition: attachment; filename="saliminn-backup-<ts>.json"` |
| `GET /data-transfer/export/preview` | settings:manage | existing counts **plus** entity manifest + exclusions |
| `POST /data-transfer/import/uploads` | super-admin | stream request body → temp file; returns `{uploadId, bytes, detectedFormat:"v3"|"v2"|"v1"|"unknown"}` |
| `POST /data-transfer/import/preview` | super-admin | `{uploadId}` → `ImportPreview` (below) |
| `POST /data-transfer/import/execute` | super-admin | `{uploadId, mode:"merge"|"restore", onConflict:"skip"|"update"|"fail", tables?: string[], confirm: true}` → `202 {jobId}` |
| `GET /data-transfer/import/jobs/{jobId}` | super-admin | `{status:"running"|"succeeded"|"failed", progress:{entity,rowsApplied,totalRows}, result?, error?}` |
| `DELETE /data-transfer/import/uploads/{uploadId}` | super-admin | discard staged file |

Upload constraints: `DefaultBodyLimit::max(256 * 1024 * 1024)`; file streams to
`<private_uploads dir>/data-transfer/upload-<uuid>.part` → rename on completion. Resolve
the dir from the same env/config the eKYC private uploads use (check `main.rs`/compose —
container path is `/app/private_uploads`, bind-mounted from `/opt/saliminn/data/private_uploads`,
uid-1000 writable, not publicly served). Reject non-`{`-leading bodies early.

`ImportPreview` response:

```json
{
  "uploadId": "…", "format": "v3", "version": 3, "exportedAt": "…",
  "sourceEnvironment": "production", "applicationVersion": "…",
  "entities": [{"name":"public.guests","rows":120,"new":110,"existing":10,"skipped":0}],
  "unsupportedEntities": ["public.hack_the_planet"],
  "validationErrors": [],
  "relationshipProblems": [{"entity":"public.team_members","rows":4,"reason":"references user ids not present in this database"}],
  "warnings": ["Backup was exported from a different environment"],
  "totalRows": 5000
}
```

## Import execution semantics (v3 and v2; v1 keeps existing legacy path)

- One transaction; existing machinery: `relax_foreign_keys` → `set_transfer_triggers(.., false)`
  → `SET CONSTRAINTS ALL DEFERRED` → insert → `SET CONSTRAINTS ALL IMMEDIATE` → triggers on,
  FKs restored → `reset_transfer_sequences` → commit. Any failure rolls back.
- `mode:"restore"` = clear selected transferable tables (reverse dep order, existing
  `expand_full_overwrite_tables` logic) then insert. `mode:"merge"` = insert-only.
- `onConflict` (merge only): `skip` → `ON CONFLICT DO NOTHING`; `update` →
  `ON CONFLICT (<pk cols>) DO UPDATE SET` every non-PK, non-generated column
  (`EXCLUDED.<col>`); `fail` → plain `INSERT` so the first conflict aborts the tx.
  Tables with no PK fall back to `skip` semantics under `update` (nothing to conflict on
  except unique indexes — a non-PK unique violation still aborts; that's correct).
- **Missing refs to non-transferable parents** (users/roles): generalize
  `normalize_user_fk_value` into the v2/v3 path — audit columns (`AUDIT_USER_FK_COLUMNS`)
  remap to the importing admin; nullable → `NULL`; required → row skipped, counted, and
  reported (in preview `relationshipProblems` and the job result). Never fabricate a user.
- Preview computes new/existing by PK lookup (`WHERE pk = ANY($1)` batched; composite-PK
  tables use per-row `EXISTS` — they're small) plus the missing-ref scan.
- **Job execution:** `tokio::spawn` inside `execute`; registry is
  `static IMPORT_JOBS: OnceLock<std::sync::Mutex<HashMap<Uuid, JobState>>>` in
  `services/data_transfer/jobs.rs` (or a `jobs` submodule file — keep the flat layout).
  Progress = `{entity, rowsApplied, totalRows}` updated per batch. Job retains the temp
  file until done, then deletes it. Startup + per-upload sweep deletes staged files older
  than 24 h. Audit events: `data_import` start/finish/fail with `job_id`, mode, counts.
- Memory: parse `tables` as `BTreeMap<String, Vec<Box<RawValue>>>` via
  `serde_json::from_reader(BufReader<File>)`; per-row `serde_json::from_str(raw.get())`
  into `Map<String,Value>` for policy handling. Peak ≈ 1× file size inside the job task —
  the 256 MB upload cap stays inside the 192 MB container only for realistic sizes; compose
  limit bump to `384m` lands with the deploy (host has ~1 GB free).

## Task 1 — Backup format models + entity catalog (backend)

Files: `hotel-app-be/src/models/data_transfer.rs`,
`hotel-app-be/src/services/data_transfer.rs`, `hotel-app-be/src/repositories/data_transfer.rs`,
`hotel-app-be/src/constants.rs`.

- Extend `TABLE_INSERT_ORDER` and `KNOWN_TABLES` with the 19 new tables (keep lists
  identical; position each after its transferable parents — e.g. `guest_segments` after
  `guests`, `promotion_channels`/`promotion_loyalty_tiers` after `promotions`/`loyalty_tiers`,
  `online_inventory_allocations` after `room_types`, `room_events` after `rooms`,
  `payment_receipt_requests` after `payments`, `teams`/`team_members`/`team_roles` grouped,
  `support_*` after `bookings`, `email_campaigns` after `email_templates`+`guest_segments`,
  `staff_notifications`/`staff_notification_reads`/`notification_subscriptions`/
  `notification_consent_events`/`consent_records`/`email_suppressions` after `guests`).
- Add `EXCLUDED_TABLES: &[(&str, &str)]` (name → reason code) covering the 29 excluded
  tables from §Entity coverage — this is the exclusions-manifest source of truth.
- New model types (serde camelCase where the §Format spec shows camelCase):
  `BackupSource{environment,database_provider}`, `BackupEntityDescriptor{name,primary_key,columns}`,
  `BackupExclusion{name,reason}`, `BackupManifest{entities,exclusions}`,
  `BackupIntegrity{entities,rows,entity_rows,completed_at}`,
  `BackupFile` — but note `tables` must deserialize as
  `BTreeMap<String, Vec<Box<serde_json::value::RawValue>>>` (the import memory bound), so
  hand-`Deserialize` or field-typed accordingly; serialize side is never used (writer
  emits bytes).
  `UploadResponse{upload_id,bytes,detected_format}`,
  `ImportPreviewRequest{upload_id}`, `ImportPreview{…}` per §API,
  `ImportPreviewEntity{name,rows,new,existing,skipped}`,
  `ImportExecuteRequest{upload_id,mode,on_conflict,tables,confirm}`,
  `BackupImportMode{Merge,Restore}` (serde `"merge"|"restore"`),
  `ConflictPolicy{Skip,Update,Fail}` (serde `"skip"|"update"|"fail"`),
  `ImportJobStatus{…}`, `JobProgress{entity,rows_applied,total_rows}`,
  `ImportJobResult{inserted,updated,skipped,report}`.
  Keep `BookingDataExport`/`FullDataExport`/`TransferPayload`/`ImportRequest` for legacy.
- Unit tests: order length 75; allowlists identical; every `pg_class`-visible excluded
  name in `EXCLUDED_TABLES` has a non-empty reason; new enum serde strings exact.
- `cargo check` + `cargo test --lib` (or the file's unit tests) must pass.

## Task 2 — Export v3 writer + preview extension (backend)

Depends on Task 1. Files: `src/services/data_transfer.rs`, `src/repositories/data_transfer.rs`,
`src/handlers/data_transfer.rs`, `src/models/data_transfer.rs` (ExportPreview extension),
tests in `tests/data_transfer_export.rs`.

- Rewrite `export_booking_data_body` to emit the §Format document in key order:
  header fields → `"manifest":{entities,exclusions}` → `"tables":{` then per-table
  `"name":[…]` via the existing `declare_export_cursor`/`fetch_export_cursor` (unchanged,
  alphabetical order) → `,"integrity":{…actual counts…}}`. `exportId` = `Uuid::new_v4()`,
  logged with the audit row. `applicationVersion` = `env!("CARGO_PKG_VERSION")`,
  environment = `config::get().environment` lowercased (`try_get` fallback
  `"development"` so tests without config init still work).
- Keep `export_booking_data` (materialized) producing the same v3 shape for tests — or
  replace it with a `build_export_header`/`stream_export` split that both paths share;
  keep the streamed-vs-materialized equivalence test meaningful.
- Extend `ExportPreview`/`preview_export_counts` with `entities: Vec<BackupEntityDescriptor>`
  and `exclusions: Vec<BackupExclusion>`.
- Handler: `Content-Disposition` filename `saliminn-backup-<YYYYmmddTHHMMSSZ>.json`,
  `application/json`.
- Tests: v3 header field presence/values, manifest lists all 75 entities + all 29
  exclusions with reasons, tables contain all transferable entities, integrity counts
  match actual, secret-field scan (no `password_hash`/`totp`/`token`/`secret` keys anywhere
  in output), deterministic ordering, empty-DB export still valid JSON.

## Task 3 — Import pipeline: uploads, preview, execute, jobs (backend)

Depends on Tasks 1–2. Files: `src/services/data_transfer.rs` (+ optional
`src/services/data_transfer/` submodule split if the file grows past ~1600 lines — prefer
`src/services/data_transfer_jobs.rs` flat file to match conventions),
`src/repositories/data_transfer.rs`, `src/handlers/data_transfer.rs`,
`src/routes/data_transfer.rs`, `src/models/data_transfer.rs`, `src/main.rs` (startup sweep),
`deploy/docker-compose.prod.yml` (backend `mem_limit`/`memory` 192m → 384m, with a comment).

- Upload endpoint: `POST /data-transfer/import/uploads`, body streams to
  `<private_uploads>/data-transfer/upload-<uuid>.part`, rename to `.json` on completion;
  `DefaultBodyLimit::max(256 MiB)`; returns `UploadResponse`. Sniff first ~4 KB for
  `detectedFormat` (`"hotel-backup"`→v3; `"version":"2.0"`+`"tables"`→v2; else v1-shaped→v1;
  unparseable→`"unknown"` — unknown is still storable; preview reports the error).
- Preview: open staged file; v3 → `from_reader` into `BackupFile` (RawValue rows);
  per-entity counts from rows; PK-diff vs DB (`existing_ids`-style batched; composite-PK
  tables per-row `EXISTS`); missing-ref scan (FK columns → non-transferable parents,
  generalized from `user_fk_columns`: any transferable-table FK column referencing an
  excluded table); unsupported entity list (file entity ∉ transferable ∪ excluded set →
  warn, and ∉ schema entirely → error); version/format validation errors. v2 file → same
  on its `tables`. v1 file → counts only (`new`/`existing` unknown → `null`/omit per
  entity) + note. `totalRows`.
- Execute: validate `confirm == true` else 400; spawn job task; return `{jobId}`.
  Job: open file → parse → validate header (v3) → select entities (optional `tables`
  filter, validated) → `restore` clears via `expand_full_overwrite_tables` ordering →
  per-entity rows applied in `transfer_order` sequence → conflict policy per §Import
  semantics → missing-ref policy → commit. Update registry progress per entity batch.
  v1/v2 files inside the same job path call the existing `import_legacy_booking_data` /
  `import_full_data` functions (they take parsed structs — parse inside the job).
- `insert_transfer_row` gains a `ConflictPolicy` parameter: `Skip` = current SQL;
  `Update` = `ON CONFLICT (<pk>) DO UPDATE SET` non-PK non-generated cols (if no PK →
  `DO NOTHING`); `Fail` = drop the `ON CONFLICT` clause. Apply same parameterization to
  `insert_json_row` (V1 path keeps `Skip` — legacy files keep legacy behavior).
- Job registry + status endpoint + `DELETE /uploads/{id}` + sweep (startup via a
  `pub fn sweep_staged_uploads(dir)` called in `main.rs`, and on each upload). Job expiry:
  retain finished jobs 1 h then drop from registry.
- Remove `POST /data-transfer/import` (JSON body) route; `ImportRequest` model may remain
  for internal reuse or be removed — grep for other callers first.
- Audit: `data_import` event on job completion/failure (`job_id`, mode, onConflict,
  per-entity counts — no row data); `job_runs::record(pool, "data_transfer_import", …)`
  on completion (best-effort, existing helper).
- Structured errors: distinguish format/validation (400), auth (401/403), missing upload
  (404), conflict-abort (409), infra (500). No secrets/paths beyond the staging dir name.

## Task 4 — Backend integration tests

Depends on Tasks 1–3. Files: `hotel-app-be/tests/data_transfer_export.rs`,
`tests/data_transfer_import.rs`, plus new `tests/data_transfer_backup_v3.rs` if cleaner.

Required coverage (extend existing patterns/harness in those files):

- Export: v3 shape end-to-end (parse the streamed body), all 75 entities, all 29
  exclusions, special types round-trip (insert a row with numeric/jsonb/uuid/timestamptz/
  bytea/bool/null into a transferable table, export, re-import, compare), FK preservation
  (parent row id referenced by child row post-restore), no secret keys, deterministic
  byte-identical double-export modulo `exportId`/`exportedAt`/`completedAt`.
- Import: valid v3 merge skip/update/fail (update actually changes a field; fail aborts),
  restore clears+loads, duplicate ids, FK-conflict rollback (whole tx rolled back — verify
  zero partial rows), missing-user-ref skip+report, unknown entity behavior, bad JSON →
  400, bad version → 400, missing `confirm` → 400, non-super-admin → 403 on
  upload/preview/execute/jobs, oversize body → 413, unknown uploadId → 404,
  v1 + v2 files still import through the upload path, preview diff correctness
  (seed rows first → `existing`/`new` counts right), job status transitions
  running→succeeded/failed, temp file gone after execute.
- Update the `TABLE_INSERT_ORDER` length test and any export-shape tests from the old
  `{version,exported_at,tables}` shape.

Run: `cargo test --all-features` with `DATABASE_URL` set (check `Makefile`/`ci.yml` for the
test-db recipe — e.g. `make db-baseline db-seed` against a throwaway Postgres).

## Task 5 — Frontend redesign

Depends on Task 3's API shape. Files: `src/api/dataTransfer.service.ts`,
`src/types/dataTransfer.types.ts` (+ barrel export if needed),
`src/features/admin/hooks/useDataTransferQueries.ts`,
`src/features/admin/components/DataTransferPage.tsx` (restructure + split),
new `src/features/admin/components/data-transfer/ExportPanel.tsx`,
`ImportWizard.tsx`, `TransferHistoryList.tsx` (feature-local dir per AGENTS layout),
tests: `src/api/dataTransfer.service.test.ts`, `DataTransferPage.test.tsx` updates +
`ImportWizard.test.tsx`.

- Service: `exportData` → `api.get('data-transfer/export').blob()` then object-URL +
  anchor download (never `.json()` a large body); `uploadBackup(file: File)` →
  `api.post('data-transfer/import/uploads', {body: file, headers:{'x-file-name': file.name,
  'content-type':'application/octet-stream'}})`; `previewImport`, `executeImport`,
  `getImportJob`, `deleteUpload` mirroring §API. Remove `importData`.
- Types: mirror §API responses; keep `BookingDataExport`/`ImportResult` only if still
  referenced; delete dead ones.
- Page split by workflow (AGENTS: split by workflow not line count):
  `DataTransferPage` = title/description, tabs Export | Import | History, keeps the
  existing localStorage history entries (extend entry with `jobId`, mode, counts).
  `ExportPanel` = scope note (business-data, exclusions callout listing excluded
  categories), optional live count preview (existing endpoint), Export button → download.
  `ImportWizard` = dropzone (`.json` accept; client-side size check ≤ 256 MB; no
  `FileReader`/`JSON.parse`) → upload w/ progress → preview render (metadata card:
  version/env/exportedAt; entity table: rows/new/existing/skipped; warnings; errors;
  unsupported list) → mode select (`merge`|`restore`) + conflict policy radio
  (`skip`|`update`|`fail`, merge only) → confirm dialog (restore warns + recommends a
  pre-import snapshot) → execute → progress (TanStack Query `refetchInterval` on
  `getImportJob` while `running`) → result report (per-entity inserted/updated/skipped +
  relationship problems). `TransferHistoryList` = existing history UI.
- UX rules: one error surface (toast OR inline alert, not both); MUI components +
  existing `MobileCardRow`; accessible labels; no stack traces; super-admin gating —
  non-super-admin sees the export UI only (check existing auth hook for how the page
  currently gates import).
- i18n: this app uses i18next (`guestPortal.json` etc. seen in specs) — check how
  DataTransferPage handles strings today and follow it (don't introduce i18n if the page
  is currently hardcoded English — match现状).
- Tests: service calls (upload headers, job poll), wizard flow (file → preview → confirm →
  execute), validation errors, oversize file rejection, non-admin gating, single error
  display.

## Task 6 — Docs + OpenAPI + compose memory

Depends on Tasks 2–5. Files: `docs/guides/data-transfer.md` (new),
`docs/FEATURES.md` (replace the stale "CSV/JSON" line), `docs/API.md` (route list),
`docs/guides/deployment.md` + `docs/guides/vps-access.md` (lineage-reset runbook),
`docs/api/openapi.json` (regenerate: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features
--test openapi_drift`), `docs/superpowers/plans/` (this file — mark complete).

`docs/guides/data-transfer.md` covers: architecture (routes→…→repo + job registry + temp
staging), the v3 format spec (field-by-field + sample), entity/exclusion tables with
reasons, modes & conflict rules incl. missing-ref behavior, large-data strategy
(cursor export, RawValue parse, 256 MB cap, 384 m limit), env/config
(`private_uploads` mount, `ENVIRONMENT`), retention/security (files contain PII;
super-admin-only; audit-logged; sweep TTL), recovery runbook (upload→preview→execute;
staging-first), troubleshooting (413, 409, version errors, orphaned uploads).

Deployment runbook addition (exact commands): verify recorded lineage → `pg_dump` →
`DELETE FROM public.hotel_schema_revisions WHERE generation = 1 AND version > 1;` →
deploy → verify `hotel_schema_revisions` has catalog checksums for 1.2/1.3 →
export smoke through `https://saliminn.my` → Caddy/backend log check for
`connection refused`/`EOF`. Note desktop DBs: same reset applies to pre-reset desktop
databases; they are rebuilt by the app, not patched (verify claim in
`src-tauri/src/postgres/patches.rs` before writing it).

## Ops track (controller-run, parallel to tasks)

1. **Staging:** fresh `pg_dump` → lineage reset → run the staged bundle's
   `apply-patches.sh` → verify revisions recorded → deploy → smoke
   `/api/data-transfer/export` through staging Caddy.
2. **Prod:** fresh `pg_dump` → lineage reset → `deploy.sh` the already-downloaded
   `8e36f896` bundle (contains the streaming fix) → verify image tag, `/health` via
   direct + Caddy + public, real export via `https://saliminn.my` → Caddy/backend logs
   clean. This ships the Cloudflare fix before the redesign lands.
3. After this branch merges: normal CI deploy ships the redesign; re-run the smoke
   checks incl. an import round-trip on staging.

## Verification gates (per task and final)

- `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`,
  `cargo test --all-features` (with DATABASE_URL).
- `bun run typecheck && bun run lint && bun run test && bun run build` in `hotel-web-fe/`.
- OpenAPI drift regenerated; `postgres_patch_catalog` untouched (no patch changes).
