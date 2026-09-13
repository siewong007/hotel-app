# Insights & Administration Redesign — Design Spec

Date: 2026-09-13. Status: approved for sequential implementation (user decision).

## Context

The admin surface exists but is fragmented: RBAC + audit + data-transfer under
`features/admin`, reports split between `features/reports` and
`features/dashboard/components/reports`, settings under `features/user`, and
guest-email delivery under `features/notifications`. Backend reporting is one
2,464-line repository returning `serde_json::Value`; there is no staff
notification center, job monitor, integrations workspace, saved/scheduled
reports, or custom report builder.

## Audit findings this design resolves

1. `GET /api/users` + RBAC snapshot return guest-portal accounts (`list_all`
   has no `user_type` filter) — correctness + privacy leak.
2. Admin "effective permissions" view uses a direct-roles-only resolver while
   authentication uses roles ∪ team roles — the view understates reality.
3. `audit_logs` is append-only by convention only (no REVOKE); monthly
   partitions are pre-created for 12 months at install and nothing creates
   later ones — writes silently degrade into `audit_logs_default`.
4. `AuditEvent.details` accepts arbitrary JSON with no secret scrubbing.
5. `system_settings.is_encrypted` / `validation_pattern` are never read — dead
   schema surface. `settings:update` is monolithic across tax/security/support.
6. `ReportsService.downloadReportPDF` calls `/api/reports/pdf` — route does
   not exist; zero callers. Dead code.
7. Occupancy is computed three ways (client room scan, occupancy_report SQL,
   night_audit_runs.occupancy_rate); revenue four ways. No KPI definition site.
8. No `saved_reports`, `report_schedules`, `report_runs`, `export_jobs`,
   `staff_notifications`, `job_runs` tables. Five spawned loops are
   unobservable except `night_audit_runs` and `email_deliveries`.
9. Single property: no property/branch table exists — multi-property filtering
   is explicitly out of scope.
10. Doc drift: CLAUDE.md claims patch catalog head 0015; actual head is 0018.
    `route_access_policies.nav_group` seeds are stale vs the registry.

## Decisions (user)

- Implement everything, sequentially, in this session. Admin first.
- New tables go into the V1 **baseline only** — no `manifest.tsv` / deploy.yml /
  deploy.sh registration (those must stay consistent per
  `postgres_patch_catalog.rs`, and deploy registration is deferred for review).
  Consequence: existing databases do not receive the new tables until a patch
  is registered; fresh installs and rebuilt dev DBs get them immediately.
- Full custom report builder is in scope (controlled dataset registry — never
  raw SQL).

## Constraints carried from AGENTS.md / CLAUDE.md

- New backend domains live in `src/modules/<domain>/` with the standard layout.
- No route paths / response shapes / permission names / storage keys change.
- New permission names must be added to `seed.sql` (permissions insert,
  `expected_system_permissions` checklist, role grants) — baseline/seed only.
- All report date math uses `hotel_today(executor)` / hotel timezone, never
  `chrono::Local`/`Utc` business-day math.
- Audit writes stay non-fatal; transactional writes use `log_event_tx`.
- Do not touch in-flight dirty files: `modules/promotions/repository.rs`,
  `tests/promotions_admin.rs`, `database/seed_voucher_audit.sql`.
- `route_access_policies` rows for new nav routes are added to seed.sql's
  expected-policy set (frontend registry remains the grouping source of truth).
- No raw-SQL report builder; no secrets in DB or audit details; no fake
  health/job statuses — show "not instrumented" rather than a green dot.

## Target architecture

### Backend

- `modules/insights/` — reporting domain: typed report envelope
  `{ meta, kpis, columns, rows }`, `report_catalog` registry (id → permission,
  params, row/time limits), `queries.rs` as the single KPI definition site,
  saved/scheduled reports, governed exports, controlled dataset query builder.
- `modules/admin/` — administration domain: staff user lifecycle
  (suspend/reactivate/unlock/revoke-sessions/invite), admin session views,
  system-health aggregation, job_runs registry, staff notifications,
  integration status.
- `services/audit.rs` — add `details` secret-denylist scrub; call
  `ensure_audit_logs_partition()` for next month from the night-audit loop.
- `repositories/analytics.rs` — report SQL migrates into
  `modules/insights/queries.rs`; flat `routes/handlers/services/analytics.rs`
  become thin shims until callers migrate (then deleted per refactoring rules).

### Frontend

- `features/insights/` — overview dashboard + `ReportShell` (shared filter bar:
  date range/presets, booking-vs-stay basis, channel, room type, status,
  currency; KPI strip; table/chart; export; save/schedule) + report library +
  saved/scheduled management + builder.
- `features/admin/` — workspaces: StaffDirectory (search/filter/paginate,
  lifecycle actions), AccessControl (existing rbac components), Settings
  workspace tabs, AuditLogs, SystemHealth, Jobs, NotificationsAdmin,
  Integrations, DataGovernance.
- `routeRegistry` gains items under existing `insights`/`administration`
  groups; `route_access_policies` seed rows added to match.

### New baseline tables

`job_runs`, `staff_notifications`, `saved_reports`, `report_schedules`,
`report_runs`, `export_jobs`, `integration_states` (status cache only — secrets
stay env-backed), `system_settings.default_value` column for honest
reset-to-default. Audit `REVOKE UPDATE, DELETE` for the app role where it is
non-superuser (verify role at implementation time; document if app role owns
the table).

### New permissions (seed.sql)

`insights:read`, `insights:export`, `insights:manage` (saved/scheduled/builder),
`system:read` (health/jobs), `notifications:manage` (staff center admin).
Reuse `users:*`, `audit:*`, `settings:*`, `reports:execute`, `analytics:read`.

## Phasing

1. Admin correctness & security fixes (users filter, resolver, lifecycle,
   sessions admin, audit hardening, dead-code removal).
2. Settings workspace (grouped API + tabs + reset-to-default).
3. Ops surfaces (job_runs + instrumentation, system health, staff
   notifications).
4. Typed insights reporting + overview dashboard + ReportShell.
5. Saved/scheduled reports + governed exports.
6. Custom report builder.
7. Integrations workspace + data-governance surface.
8. Docs + full validation.

## Testing

- Backend: unit tests for KPI SQL result mapping, lifecycle transitions,
  scrub filter, builder field validation; integration tests for new routes
  (DATABASE_URL-gated like existing suites); `postgres_patch_catalog` must stay
  green (no manifest changes).
- Frontend: vitest for reducer/builder logic, permission-aware rendering,
  filter serialization; typecheck + lint + test + build gates.
- OpenAPI drift: regenerate `docs/api/openapi.json` via
  `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.
