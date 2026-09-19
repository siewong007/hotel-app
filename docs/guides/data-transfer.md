# Data Transfer — JSON Backup and Restore

The data-transfer feature exports the hotel's business data as a single
versioned JSON document (`hotel-backup` v1) and restores it through a staged
`upload → preview → execute → poll` pipeline. It is the operator-facing backup
format: portable across environments, self-describing (every file carries a
manifest of what it contains and what was deliberately excluded), and safe to
diff against a destination before anything is written.

It is **not** a replacement for `pg_dump`. `pg_dump` also captures the schema
itself, sequences, functions and roles, and is the recovery point of last
resort (see the nightly `saliminn-backup.timer` dumps in
[deployment.md](deployment.md#backup-and-recovery)).

There are two tiers of file, and the difference is the whole security story:

- **Business-data files** (`standard`, `full`, `backup`) carry *business data
  only*: never password hashes, sessions, tokens, or eKYC evidence. They are
  safe to move between environments and to restore into a database that
  already has users, and they are written as plain JSON.
- **Full-system files** (`system`) additionally carry the protected set — user
  accounts and password hashes, RBAC grants, sessions, eKYC evidence and the
  internal system tables. This is the only export that can rebuild a hotel's
  logins and authorization from a file, and a `system` file *is* a credential
  store in its own right. It is restricted to super administrators, requires
  step-up re-authentication, and is **always encrypted** under a passphrase
  the caller supplies — the server never stores that passphrase and cannot
  recover the file without it.

## Table of Contents

1. [Architecture](#architecture)
2. [Permissions and step-up authentication](#permissions-and-step-up-authentication)
3. [Export scopes](#export-scopes)
4. [The `hotel-backup` v1 file format](#the-hotel-backup-v1-file-format)
5. [Entity coverage](#entity-coverage)
6. [API endpoints](#api-endpoints)
7. [Import semantics](#import-semantics)
8. [Large-data strategy](#large-data-strategy)
9. [Configuration](#configuration)
10. [Security and retention](#security-and-retention)
11. [Recovery runbook](#recovery-runbook)
12. [Troubleshooting](#troubleshooting)
13. [Retired file formats](#retired-file-formats)

---

## Architecture

The domain follows the standard module layout — `src/modules/data_transfer/`:

| Layer | File | Role |
|---|---|---|
| Routes | `src/modules/data_transfer/routes.rs` | Path registration, `data_transfer:*` permission guards, the 256 MB `DefaultBodyLimit` on the upload route, the sensitive rate limiter on `/step-up`, the super-admin check on `system`-scope export/preview |
| Handlers | `src/modules/data_transfer/handlers.rs` | Thin HTTP translation; maps `StageUploadError::PayloadTooLarge` to 413 (the `ApiError` enum has no such variant) |
| Service | `src/modules/data_transfer/service.rs` | Entity catalog (`TABLE_INSERT_ORDER`, `EXCLUDED_TABLES`, `EXCLUDED_EXPORT_COLUMNS`), the `SENSITIVE_TABLES`/`PROTECTED_TABLE_ORDER` registries, the streaming v1 export writer |
| Service | `src/modules/data_transfer/jobs.rs` | Staged uploads, format detection, import preview, conditional permission enforcement, the process-local job registry, and the background import runner |
| Service | `src/modules/data_transfer/step_up.rs` | Step-up re-authentication: password (+TOTP) verification, the 120 s `X-Step-Up` token check, step-up audit events |
| Crypto | `src/modules/data_transfer/crypto.rs` | The framed AEAD stream that encrypts `system`-scope exports under the `X-Backup-Passphrase` |
| Repository | `src/modules/data_transfer/repository.rs` | All SQL: catalog introspection (`pg_class`/`pg_constraint`/`information_schema`), the export cursor, `insert_transfer_row`, FK relax/restore, sequence resets |
| Models | `src/modules/data_transfer/models.rs` | The v1 document structs (`BackupFile` et al.) and every request/response DTO |

Request flow for an export: route guard (`data_transfer:export` for
`?scope=standard`, `data_transfer:export_sensitive` + `X-Step-Up` for
`full`/`backup`) → `export_booking_data_handler` → `export_booking_data_body`
→ `stream_export`, which returns a `Body` stream the handler wraps with a
`Content-Disposition` attachment filename.

Request flow for an import: route guard (`data_transfer:import`) → handler →
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

## Permissions and step-up authentication

Every endpoint runs on a dedicated `data_transfer:*` permission set, seeded
for the `admin`/`super_admin` roles by patch `0004_data_transfer_permissions`.
Neither `settings:manage` nor `users.is_super_admin` opens this surface any
more — access is an explicit grant, and `data_transfer:manage` implies every
action of the resource through the usual `<resource>:manage` rule.

| Action | Required permission |
|---|---|
| Open the page, standard export preview, transfer history | `data_transfer:view` |
| Standard export | `data_transfer:export` |
| Full / backup export | `data_transfer:export_sensitive` **+ step-up** |
| Upload, import preview, execute, poll, discard staged file | `data_transfer:import` |
| Import a file containing sensitive entities (any retired-format file fails closed as sensitive) | `+ data_transfer:import_sensitive` |
| Execute with `onConflict: "update"` | `+ data_transfer:override` |
| Execute with `mode: "restore"` | `+ data_transfer:restore` **+ step-up** |

The conditional import checks live in
`data_transfer_jobs::enforce_import_permissions`, which runs *after* the
route's `data_transfer:import` gate and *before* a job is registered: the file
is sniffed for sensitivity without a full parse (a missing or unreadable
staged file fails closed and demands `import_sensitive`). Denials are 403
naming the missing permission; a missing or invalid step-up is 401.

**Step-up.** `POST /data-transfer/step-up` re-authenticates the caller —
password, plus the TOTP code when the account has TOTP enrolled
(passwordless/passkey-only accounts step up on TOTP alone; an account with
neither credential can never step up). Success mints a 120-second token sent
as the `X-Step-Up` header on the gated call; the token carries its own JWT
audience (so it can never act as an access token), and is bound to the same
user *and* session (`sid`) — a token minted on another device is rejected.
Failures return a generic 401, rate-limited per IP (10 / 5 min), and both
outcomes are audited as `data_transfer_step_up` /
`data_transfer_step_up_denied`.

## Export scopes

`GET /data-transfer/export` and `/export/preview` take `?scope=`:

| Scope | Permission | Step-up | Contents |
|---|---|---|---|
| `standard` (default) | `data_transfer:export` | — | All transferable entities **except** the `SENSITIVE_TABLES` set; the manifest lists them by name under `omitted` |
| `full` | `data_transfer:export_sensitive` | `X-Step-Up` | Every transferable entity, sensitive included; `includesSensitiveData: true` |
| `backup` | `data_transfer:export_sensitive` | `X-Step-Up` | `full` plus `manifest.relationships` — the column-level FK edge list between emitted entities, for migration tooling |
| `system` | `data_transfer:export_sensitive` **+ super admin** | `X-Step-Up` | `backup` plus the protected set (credentials, RBAC, sessions, eKYC, system tables). Always encrypted — the request must carry `X-Backup-Passphrase` or it is refused before a single row is read |

`SENSITIVE_TABLES` (in `modules/data_transfer/service.rs`) is the registry
that decides what "sensitive" means — guest, payment, ledger, support,
consent, and other confidential business tables.

The protected set is governed separately by `EXCLUDED_TABLES` and
`PROTECTED_TABLE_ORDER` in the same file. It stays out of `standard`, `full`
and `backup` entirely; only `system` carries it. The
`bookings.pre_checkin_token` columns are stripped at the `SELECT` projection
at **every** scope including `system` — a live portal bearer token has no
restore value and every reason not to travel. A business-data file declares
`includesSecrets: false`; a `system` file declares `true` and
`kind: "full-system"`.

## The `hotel-backup` v1 file format

One JSON object, emitted in a fixed key order. Downloaded as
`saliminn-backup-<YYYYmmddTHHMMSSZ>.json` (UTC timestamp) with
`Content-Type: application/json`.

```json
{
  "format": "hotel-backup",
  "version": 1,
  "kind": "business-data",
  "exportType": "full",
  "includesSensitiveData": true,
  "includesSecrets": false,
  "exportId": "3f8a2c1e-7b9d-4e5f-9a1c-0d2e4f6a8b0c",
  "exportedAt": "2026-09-14T09:25:30.123456+00:00",
  "applicationVersion": "0.3.0",
  "source": {"environment": "production", "databaseProvider": "postgresql"},
  "manifest": {
    "entities": [
      {"name": "public.amenities", "primaryKey": ["id"], "columns": ["id", "name", "created_at"]}
    ],
    "exclusions": [
      {"name": "public.users", "reason": "credentials_and_auth_state"}
    ],
    "relationships": [
      {"entity": "public.bookings", "column": "guest_id", "referencedEntity": "public.guests", "referencedColumn": "id"}
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
| `version` | Integer `1`. Any other value → `unsupported hotel-backup version <n> — this build understands version 1` — including `3`, which is a retired version stamp, not a newer one. |
| `kind` | Payload class: `"business-data"`, or `"full-system"` for a `system` export. Other values are rejected at import. |
| `exportType` | The scope the file was generated with: `"standard"`, `"full"`, `"backup"`, or `"system"`. Echoed by the import preview. Never trusted for authorization — the tier is recomputed from the entity keys the file actually contains. |
| `includesSensitiveData` | `true` when the file carries `SENSITIVE_TABLES` entities — computed from the actual entity set, not just the declared scope. Execute requires `data_transfer:import_sensitive` when this (or a sensitive entity key) is present. |
| `includesSecrets` | `false` on business-data files; `true` on a `system` file, which really does carry credential material. A file declaring `true` **without** `kind: "full-system"` produces a preview warning, since no legitimate producer emits that combination. |
| `exportId` | UUIDv4 identifying this exact file. Also recorded on the `data_export` audit row, so a download can be tied to its event. |
| `exportedAt` | RFC 3339 export start timestamp (UTC). |
| `applicationVersion` | The backend's `CARGO_PKG_VERSION`. Preview warns when it differs from the importing build. |
| `source.environment` | The exporter's `ENVIRONMENT`/`APP_ENV`, lowercased: `development`, `staging`, or `production`. Preview warns when it differs from the destination's. |
| `source.databaseProvider` | Always `"postgresql"`. |
| `manifest.entities` | One entry per emitted entity, in the same alphabetical order `tables` uses: `name` (schema-qualified), `primaryKey` (column list; `[]` for keyless tables), `columns` (the exported columns, schema order). Carries **no** row counts — those land in `integrity`. |
| `manifest.exclusions` | Every schema table **not** in the transferable set, with a reason code — nothing is silently omitted. See [Entity coverage](#entity-coverage). |
| `manifest.omitted` | Standard scope only: the `SENSITIVE_TABLES` entity names left out of the file — names only, never rows. |
| `manifest.relationships` | Backup scope only: column-level FK edges between emitted entities (`entity`, `column`, `referencedEntity`, `referencedColumn`) — edges to excluded parents like `public.users` are deliberately absent. |
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

Each transferable table is additionally classified in `SENSITIVE_TABLES`
(same file): the sensitive set carries guest identity/contact data, bookings,
payments, ledgers, loyalty movement, operational history, support threads,
consent records, and staff-linked records — 56 tables today. The remainder
(amenities, rate plans, room types, promotions definitions, …) is the
non-sensitive set a `standard` export emits. The classification is explicit,
not derived: the registry test fails when a new transferable table lands
without a sensitivity decision.

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

30 tables are **protected**. They are excluded from `standard`, `full` and
`backup` documents and emitted in those files' `manifest.exclusions` with one
of five reason codes. A `system` export carries them instead, and its manifest
lists only what it genuinely left out — the exclusions list always describes
the file you are holding, not a fixed set.

The reason codes still carry: they are why these tables are gated behind super
admin, step-up and encryption rather than available at `full`.

| Reason | Tables | Why |
|---|---|---|
| `credentials_and_auth_state` | `public.users`, `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_roles`, `public.user_permissions`, `public.route_access_policies` | Password hashes, TOTP seeds, RBAC grants — exporting hands every export holder the credential store; importing could plant a forged `is_super_admin` account |
| `session_or_token_material` | `public.refresh_tokens`, `public.user_sessions`, `public.passkeys`, `public.passkey_challenges`, `public.two_factor_challenges`, `public.guest_portal_sessions`, `public.payment_retry_capabilities` | Live sessions and token/challenge state |
| `sensitive_ekyc_pii` | `public.ekyc_verifications`, `public.ekyc_decision_history`, `public.ekyc_access_events`, `public.ekyc_sensitive_reveals`, `public.ekyc_idempotency_keys`, `public.ekyc_notes`, `public.ekyc_reason_codes` | Identity documents and biometric evidence |
| `ephemeral_queue_state` | `public.email_deliveries`, `public.support_action_idempotency_keys`, `public.support_guest_request_idempotency_keys` | Live send/request queues — re-importing would replay sends |
| `internal_system_table` | `public.job_runs`, `public.hotel_schema_revisions`, `app.invalid_data_quarantine`, `public.audit_logs`, `public.audit_logs_default`, `public.rate_limit_buckets` | Platform bookkeeping and shared runtime state, not business data |

Two entries behave specially inside a `system` export:

- **`public.audit_logs_default`** is never named as its own entity. It is the
  DEFAULT PARTITION of `public.audit_logs`, and the introspection that builds
  the entity list skips partition children by design. Its rows travel with the
  partitioned parent, so audit history is carried in full.
- **`public.hotel_schema_revisions`** is exported but **never imported**, at
  any scope. It records which schema patches the *source* database had
  applied; restoring it would make the destination misreport its own schema,
  and the next patch run would either skip real work or abort on the
  baseline-checksum guard. On desktop a patch failure is fatal at startup, so
  the app would not come up at all. It rides the file so an operator can read
  what the source was running, and the importer drops it with a warning.

Two **columns** inside a transferable table are also excluded —
`EXCLUDED_EXPORT_COLUMNS` strips them from the `SELECT` projection, the manifest
`columns` list, and the output, so the values never leave the database:

| Table | Column | Why |
|---|---|---|
| `public.bookings` | `pre_checkin_token` | Live guest-portal bearer token — the token alone authenticates a pre-check-in lookup, so a leaked file would hand out working portal links |
| `public.bookings` | `pre_checkin_token_expires_at` | Companion expiry for the same token |

Not transferable but also not "missing": uploaded file *blobs* under
`private_uploads/` (eKYC documents, payment receipts, guest documents) are out
of scope — the backup carries their metadata rows only. Two consequences worth
knowing before you restore:

- `public.guest_documents` rows describe identity documents and stay
  transferable — they are business records — but `document_number`/`file_url`
  point at files that do not travel with the backup. Restore into an
  environment whose `private_uploads/` tree was preserved and the links keep
  working; restore onto a fresh host and they dangle until the files are
  copied across (the rows themselves import fine).
- The same applies to `customer_ledger_payments.receipt_file_url` and
  `payment_receipt_requests.receipt_path`: receipt *metadata* restores, the
  receipt *files* must move with the `private_uploads` mount.

## API endpoints

All paths live under `/api`. The `data_transfer:*` permissions below are
enforced server-side on every request; `full`/`backup` exports and `restore`
executes additionally require a fresh `X-Step-Up` token — see
[Permissions and step-up authentication](#permissions-and-step-up-authentication).

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /data-transfer/export?scope=` | `data_transfer:export` (`standard`) or `export_sensitive` + step-up (`full`, `backup`) | Streamed v1 download; `Content-Disposition: attachment; filename="saliminn-backup-<ts>.json"` |
| `GET /data-transfer/export/preview?scope=` | `data_transfer:view` (`standard`) or `export_sensitive` (sensitive scopes) | `{generated_at, counts, total_records, tables[], entities[], exclusions[]}` — live per-entity counts plus the manifest an export would declare (the legacy wrapper keeps snake_case keys; the `entities`/`exclusions` entries inside are camelCase) |
| `POST /data-transfer/step-up` | any authenticated session, IP rate-limited | `{password, totpCode?}` → `{stepUpToken, expiresAt}` — the 120 s token for `X-Step-Up`; generic 401 on failure |
| `GET /data-transfer/history?limit=` | `data_transfer:view` | `{entries: [{id, action, userId, username, createdAt, details}], total}` — recent `data_import`/`data_export`/`data_transfer_step_up*` audit rows (90-day window, limit clamped) |
| `POST /data-transfer/import/uploads` | `data_transfer:import` | Streams the request body to `private_uploads/data-transfer/upload-<uuid>.json` (via `.part`); returns `{uploadId, bytes, detectedFormat}` where `detectedFormat` is `"v1"`, `"legacy"` (any retired shape: flat v1/v2 or `hotel-backup` v3), or `"unknown"` |
| `POST /data-transfer/import/preview` | `data_transfer:import` | `{uploadId}` → `ImportPreview` — the pre-flight diff below |
| `POST /data-transfer/import/execute` | `data_transfer:import` (+ `import_sensitive` for sensitive files, `override` for `onConflict:"update"`, `restore` + step-up for `mode:"restore"`) | `{uploadId, mode, onConflict?, tables?, confirm}` → `202 {jobId}`; `confirm` must be `true` |
| `GET /data-transfer/import/jobs/{jobId}` | `data_transfer:import` | `{status: "running"\|"succeeded"\|"failed", progress: {entity, rowsApplied, totalRows}, result?, error?}`; finished jobs are retained 1 h, then 404 |
| `DELETE /data-transfer/import/uploads/{uploadId}` | `data_transfer:import` | Discard a staged file → `204`; 409 while a running job reads it, 404 when absent |

`ImportPreview` (returned by `POST /import/preview`):

```json
{
  "uploadId": "…",
  "format": "v1",
  "version": 1,
  "exportType": "full",
  "sensitive": true,
  "requiresPermissions": ["data_transfer:import_sensitive"],
  "exportedAt": "2026-09-14T09:25:30.123456+00:00",
  "sourceEnvironment": "production",
  "applicationVersion": "0.3.0",
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
- **Known bound:** rows become `Map<String, Value>` at insert, so numbers go
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
- **Exports** run under `data_transfer:export` (standard) or
  `data_transfer:export_sensitive` + step-up (full/backup). A business-data
  document never contains credential/session/eKYC material — the table-level
  exclusions above are enforced at the `SELECT` projection, so the values
  cannot leak into the file, and `includesSecrets` is always `false`.
  `bookings.pre_checkin_token` is stripped at every scope, `system` included.
- **`system` exports** add super-admin on top of
  `data_transfer:export_sensitive` and step-up, so the tier cannot be
  delegated through RBAC, and the request is refused before a single row is
  read unless it carries `X-Backup-Passphrase`. The passphrase travels as a
  header, never `?passphrase=`, so it stays out of access logs, proxy logs
  and browser history; the server neither stores nor logs it, and a lost
  passphrase means a lost backup.
- **Encryption** is AES-256-GCM over 1 MiB frames, keyed by PBKDF2-HMAC-SHA256
  at 600,000 iterations over a per-file random salt
  (`modules/data_transfer/crypto.rs`). Framing is what keeps the export streaming — one frame is in
  memory at a time in each direction. Every frame's AAD binds a digest of the
  envelope header, the frame index, and a final-frame marker, so a tampered
  header (for example a downgraded iteration count), reordered or spliced
  frames, appended bytes, and truncation are each rejected rather than
  decrypted into a partial backup. An encrypted download is served as
  `application/octet-stream` with a `.json.enc` name.
- **Encrypted uploads are never decrypted to disk.** The staged file stays in
  its envelope under `private_uploads/data-transfer/`; preview and execute
  each take the passphrase again and decrypt into memory for that call only.
- **`system` imports** are gated on what the file actually contains, not what
  it declares: the tier is recomputed from the entity keys present, so a
  hand-edited header cannot smuggle `public.users` in under a `full` label.
  A file carrying the protected set requires super admin and step-up, on top
  of the usual import permissions.
- **Imports** require `data_transfer:import`, with `import_sensitive`,
  `override`, and `restore` layered per file and mode (see the permission
  matrix); `restore` additionally demands a step-up token. Execute requires
  `confirm: true`.
- **Step-up** tokens live 120 s, bind to the session that minted them, and
  their dedicated audience means they can never serve as access tokens.
- **Audit:** `data_export` is logged once the export body was fully produced
  (with `export_id`, `exportType`, entity and row counts — a client
  disconnect skips the audit). `data_import` is logged at job start,
  completion, and failure (with `job_id`, mode, conflict policy, per-entity
  counts). `data_transfer_step_up` and `data_transfer_step_up_denied` record
  every re-authentication attempt (reason only — never credentials).
  `job_runs` records each `data_transfer_import` outcome for the admin Jobs
  page, and `GET /data-transfer/history` exposes the same audit rows to
  `data_transfer:view` holders. No secrets or row contents reach logs or
  error responses.
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
   `GET /api/data-transfer/export?scope=backup` with an
   `export_sensitive`-holding token plus `X-Step-Up` (mint one via
   `POST /data-transfer/step-up`). Verify the download ends with the
   `integrity` trailer — a file without it is truncated.
3. **Upload.** `POST /api/data-transfer/import/uploads` with the file as the
   raw request body → `{uploadId}` (`data_transfer:import`). Nothing is
   parsed or written to the database yet.
4. **Preview.** `POST /api/data-transfer/import/preview` `{uploadId}` → read
   `validationErrors` (must be empty to proceed), `sensitive` and
   `requiresPermissions`, `relationshipProblems`, `warnings`,
   `unsupportedEntities`, and the per-entity `new`/`existing`/`skipped`
   counts. An environment or version mismatch here is a signal to stop and
   think, not to click through.
5. **Execute.** `POST /api/data-transfer/import/execute` with
   `{uploadId, mode: "restore"|"merge", onConflict: "skip"|"update"|"fail",
   confirm: true}` → `202 {jobId}`. For a full recovery use `mode: "restore"`
   with no `tables` filter — that path requires `data_transfer:restore` and a
   fresh `X-Step-Up` header, and sensitive files require
   `data_transfer:import_sensitive`.
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
| `403 Missing permission: data_transfer:<action>` | The account lacks the named grant | Assign the permission (or `data_transfer:manage`) via Roles — `settings:manage` and the super-admin flag no longer open this surface |
| `401 "requires recent re-authentication"` / `"Step-up token is invalid or expired"` | Missing, expired (>120 s), or foreign-session `X-Step-Up` token | `POST /data-transfer/step-up` again and retry immediately — the token is short-lived by design |
| `401` on `POST /step-up` | Wrong password, missing/wrong TOTP, or an account with no step-up credential | Re-enter credentials; an enrolled TOTP account must send `totpCode`; passwordless accounts need TOTP enrolled |
| `429` on `POST /step-up` | >10 attempts in 5 min from the IP | Wait out the retry-after window |
| `413` on upload | Body exceeded 256 MiB | Split the export (export per-entity subsets is not yet a feature — use `pg_dump`/`pg_restore` for very large databases) |
| `400 "the uploaded file is not a JSON document"` | First non-whitespace byte is not `{` | Upload the `.json` file itself, not a zip/dump |
| `400 "confirm must be true"` | Execute sent without `confirm: true` | Deliberate gate — the operation is destructive; send `confirm: true` |
| `400 "unsupported hotel-backup version N"` / `unsupported backup format` / `unsupported backup kind` | File parses as `hotel-backup`-shaped but carries an unknown version/format/kind | Check what produced the file; preview reports the same under `validationErrors` before you execute |
| `400 "the staged upload could not be parsed"` | Truncated or malformed file (missing `integrity` trailer, bad JSON) | Re-download/re-export; do not hand-edit mid-document |
| `404 "staged upload not found"` | Upload id unknown, consumed by a finished job, swept (>24 h), or deleted | Re-upload; upload ids are single-use for execute |
| `404 "import job not found or expired"` | Job id unknown, or finished >1 h ago | Finished results are also in the `data_import` audit event and `job_runs` |
| `409 "an import job is already running for this upload"` | Second execute on the same upload while one runs | Poll the existing job instead |
| `409 "a running import job is still reading this upload"` | `DELETE` on an upload mid-import | Wait for the job to finish; it deletes its own file |
| Job `failed` with `row N` / constraint detail | Bad row or dangling reference; whole transaction rolled back | Fix the file (preview's `relationshipProblems` names the columns), or run `merge` with `skip` to absorb conflicts |
| Job `failed` right after a backend restart | The job registry is process-local — a restart abandons running jobs | The transaction rolled back (uncommitted work never survives a restart); re-stage the file — the old one is deleted with the dead job or swept |
| `upload-*.part` / old `upload-*.json` files under `private_uploads/data-transfer/` | Orphaned staging (crashed upload, never executed, dead job) | Harmless — swept after 24 h; or delete manually |
| Export returns 502 / times out through Cloudflare | Should not happen since the streaming rewrite — a regression means the backend restarted mid-export | Check `journalctl -u caddy` for `connection refused`/`EOF` and `docker logs saliminn-backend`; the export is a read transaction, safe to retry |

## Retired file formats

Only `hotel-backup` **version 1** is accepted. Every other shape is retired —
the upload still stages it (the guard only sniffs), preview returns `400` with
`the file uses a retired export format`, and an execute attempt fails the job
the same way. Nothing in a retired file is ever written.

- **`hotel-backup` v3** — the pre-rename stamp of the current format (detected
  as `"legacy"`). Export a fresh backup from the source system and import that
  instead.
- **v2** — `{version: "2.0", exported_at, tables: {…}}`.
- **flat v1** — the legacy `BookingDataExport` (`{version: "1.x", guests: [],
  bookings: [], …}`).

All three fail closed as *sensitive* for permission purposes, so executing one
also requires `data_transfer:import_sensitive` before the rejection even
surfaces.
