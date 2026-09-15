# Data Transfer — Privileged Permissions & Tiered Export

**Status:** plan approved-in-parts via scope questions (RBAC replaces both gates;
3 export tiers; step-up auth in scope; no file encryption).

**Base:** everything in `2026-09-14-data-transfer-backup-redesign.md` is shipped
and live in production (v3 `hotel-backup` format, 75/29 registry, staged
upload→preview→execute, merge/restore + skip/update/fail, audit events, wizard
UI). This plan is the delta that spec `Full-System Data Export & Import` adds.

**User decisions:**
- `data_transfer:*` permissions REPLACE `settings:manage` AND `is_super_admin`
  on every data-transfer endpoint.
- Three export modes: Standard / Full / Full System Backup.
- Step-up auth required for: Full export, Backup export, Restore execute.
- Server-backed transfer history + confirm UX + i18n + Help Centre docs.
- No export-file encryption.

## Permission model (Task 1)

New permissions (colon convention, `resource:action`):

| Permission | Gates |
|---|---|
| `data_transfer:view` | `/data-transfer` page policy, `GET /data-transfer/history`, `GET /data-transfer/export/preview` (counts) |
| `data_transfer:export` | `GET /data-transfer/export?scope=standard` |
| `data_transfer:export_sensitive` | `?scope=full` and `?scope=backup` (+ step-up) |
| `data_transfer:import` | upload, preview, jobs GET, upload DELETE, execute (baseline) |
| `data_transfer:import_sensitive` | execute when file contains sensitive entities |
| `data_transfer:override` | execute with `onConflict: "update"` |
| `data_transfer:restore` | execute with `mode: "restore"` (+ step-up) |
| `data_transfer:manage` | implies all above (existing `:manage` derivation) |

- `seed.sql`: add the 8 rows to `INSERT INTO permissions`; the existing
  `admin`/`super_admin` blanket `CROSS JOIN` grant covers them automatically.
  No other role grants them — matches "not every staff member".
- `route_access_policies` seed row for `/data-transfer`: `settings:manage` →
  `data_transfer:view` (both the `required_permissions` and manage list).
- Catalog patch `0004_data_transfer_permissions.sql` (generation 1, version 4):
  idempotent `INSERT ... ON CONFLICT DO NOTHING` for the 8 permissions, the
  role grants for `admin`+`super_admin`, and the `route_access_policies`
  update. Register in `manifest.tsv` + `deploy/deploy.sh` +
  `deploy/deploy-staging.sh` + both deploy workflows. sha256 checksum.
- Route guards (`routes/data_transfer.rs`): drop `settings:manage` and
  `ensure_super_admin`; apply the permission mapping above.
- `main.rs` sweep call unchanged.

## Sensitivity registry + 3-mode export (Task 2)

- `services/data_transfer.rs`: `pub const SENSITIVE_TABLES: &[&str]` — every
  transferable table carrying PII, financial movements, staff data, or
  operational history. Verified per-column at implementation; draft split:
  - **Standard (~22):** amenities, booking_channels, email_templates,
    loyalty_programs, loyalty_program_rules, loyalty_rewards, loyalty_tiers,
    promotion_channels, promotion_loyalty_tiers, promotion_room_types,
    promotions, rate_plans, reward_catalog, room_rates,
    room_status_transitions, room_type_amenities, room_types, rooms, services,
    system_settings, team_roles, vouchers
  - **Sensitive (~53):** everything guest-/booking-/payment-/staff-linked —
    guests, guest_*, bookings, booking_*, companies, corporate_*,
    consent_records, payments, payment_receipt_requests, invoices,
    customer_ledger*, loyalty_accounts/members/memberships/redemptions/
    transactions, points_transactions, voucher_redemption*, housekeeping_tasks,
    maintenance_tickets, night_audit_*, room_changes/events/history/
    status_change_log, self_checkin_events, notification_*,
    staff_notification*, support_*, teams, team_members, user_guests,
    email_campaigns, email_suppressions, online_inventory_allocations
  - `staff_notifications`/`staff_notification_reads` are catalog-but-absent on
    prod/staging (baseline-only) — still classify them.
- Tests: `SENSITIVE_TABLES ⊆ TABLE_INSERT_ORDER`; disjointness with excluded
  set; standard-scope export emits exactly `TABLE_INSERT_ORDER − SENSITIVE`.
- `GET /data-transfer/export?scope=standard|full|backup` (default `standard`? —
  NO: default must stay least-privilege → `standard`; frontend picks explicit).
  Wait — that silently narrows existing callers. Default `scope` absent →
  `full` keeps back-compat? Spec wants least-privilege default. Decide:
  **default `standard`**, UI always passes explicit scope. (Breaking change
  acceptable: the feature was released today; no external consumers.)
- Manifest additions on every v3 doc: `exportType: "standard"|"full"|"backup"`,
  `includesSensitiveData: bool`, `includesSecrets: false`. `omitted` list on
  standard exports naming the sensitive tables left out (name-only, no rows).
  `backup` additionally emits `manifest.relationships`: FK edge list
  `{table, column, references}` per entity (already introspected).
- Version stays `3` — additive fields; importer treats absent flags as
  v3-pre-tier (compute sensitivity from entity names, not the flag).
- Standard scope: stream only non-sensitive tables; manifest.entities filtered;
  integrity counts reflect emitted set.

## Import permission gating + step-up (Task 3)

- File sensitivity detection: an uploaded file is *sensitive* if any entity
  name ∈ `SENSITIVE_TABLES` OR `includesSensitiveData == true`. v1/v2 files →
  always sensitive (legacy files carry booking/guest data).
- `execute` enforcement order: `data_transfer:import` → sensitive file needs
  `import_sensitive` → `onConflict:update` needs `override` → `mode:restore`
  needs `restore` + step-up. Each missing perm → 403 naming it.
- Preview response gains `requiresPermissions: ["data_transfer:import_sensitive",
  ...]` + `sensitive: bool` so the UI can warn before execute.
- Step-up: `POST /data-transfer/step-up` `{password, totpCode?}` → verify
  `verify_password` vs `users.password_hash`; if `users.totp_enabled` also
  verify `verify_totp_code`. Success → short-lived JWT (`aud:
  "data-transfer-step-up"`, exp 120s, sid bound) returned as
  `{stepUpToken, expiresAt}`.
- Required `X-Step-Up: <token>` header on: `GET /export?scope=full|backup`,
  `POST /execute` when `mode=restore`. Decode with a separate `jsonwebtoken`
  Validation pinning the aud; must also carry the same `sid`.
- All step-up failures → 401 `ApiError::Unauthorized`, audit-logged as
  `data_transfer_step_up_denied`; successes as `data_transfer_step_up` (no
  password/secret in details — ever).

## Server transfer history (Task 4)

- `GET /data-transfer/history?limit=100` → `data_transfer:view` →
  `audit::get_recent_events_by_actions(&["data_import","data_export",
  "data_transfer_step_up","data_transfer_step_up_denied"], 90, limit)`.
- Response: `{entries: [{id, action, userId, username, createdAt, details}],
  total}` — details already carry job id/mode/counts, never row data.
- Replace `TransferHistoryList`'s localStorage source with this (keep the
  component name/props).

## Frontend (Task 5)

- `DataTransferPage`: `hasPermission('data_transfer:view')` gate; per-section
  gating (`export`, `export_sensitive`, `import`, `restore`, `override`).
- `ExportPanel`: three mode cards — what's included/excluded, sensitivity
  flag, required permission, secrets-excluded note. Full/Backup → confirm
  dialog collecting step-up (password + TOTP when `user.totp_enabled`) →
  `POST step-up` → blob download with `X-Step-Up` header.
- `ImportWizard`: restore option only with `data_transfer:restore`; update
  policy only with `override`; preview surfaces `requiresPermissions` +
  sensitive warning; restore confirm collects step-up.
- i18n: all new copy through `src/i18n` `useTranslation` (namespace
  `dataTransfer`); follow `NavigationAccessSection.tsx` usage.
- Tests: permission-gated render states, step-up dialog flow, history list.

## Tests (per task + integration)

- Permission matrix: every endpoint × missing perm → 403; `manage` implies all.
- Standard export emits no sensitive entity; manifest flags correct.
- Full/backup reject without `export_sensitive`; reject without step-up; accept
  with valid step-up; wrong password → 401 + audit row.
- Execute: sensitive file without `import_sensitive` → 403; `update` without
  `override` → 403; `restore` without `restore` → 403; restore without step-up
  → 401.
- v1/v2 execute requires `import_sensitive`.
- History returns the just-run import/export audit rows.
- Existing 28 data-transfer tests stay green (admin user carries the blanket
  grant — but the dev DB needs patch 0004 applied first).

## Docs (Task 6)

- `docs/guides/data-transfer.md`: permission matrix, 3 modes, sensitivity
  tiers, step-up flow, history, "what is never exported" list.
- Help Centre page (find existing help content layout first).
- `docs/FEATURES.md` row update if needed.
- `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --test openapi_drift` for new routes.
- `docs/guides/vps-access.md`/deployment runbook: patch 0004 note.

## Non-goals

- No file encryption (declined).
- No new dependencies.
- No multi-tenant scoping (single-property system).
- v1/v2 import compatibility unchanged.

## Order

Task 1 (permissions+patch) → Task 2 (tiers) → Task 3 (import gating+step-up) →
Task 4 (history) → Task 5 (FE) → Task 6 (docs). 2+3 can parallelize (disjoint
files mostly); 4 trivial; 5 last.
