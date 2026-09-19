# Superpowers plans, specs, and reports

Working artifacts of the plan-driven workflow (plans = task checklists,
specs = design documents, reports = after-action notes). **This directory holds
active work only.** When a plan merges:

1. Move any lasting design rationale into the owning canonical doc
   (`../architecture/`, `../architecture/ADRS.md`, or the guide that owns the
   subject).
2. Confirm [`../FEATURES.md`](../FEATURES.md) records the feature and its
   status — the registry is the permanent record of what exists.
3. Delete the plan, its spec, and its report here, plus the
   `.superpowers/sdd/<name>/` ledger. Git history is the archive — do not keep
   shipped plans as "historical documentation".

## Active

(none)

Removed 2026-09-19 (deliverables verified merged on master; recover from
`git log -- docs/superpowers/`):

- `2026-09-17-distributed-state-followups` — all four residual review items
  resolved (`34c8deffe`); rationale lives in
  `../architecture/architecture-flow.md` (leader/cache-bus sections).
- `2026-09-18-frontend-test-depth` — workflow assertions on RBAC/eKYC/rooms/
  data-transfer pages, SettingsPage card extraction, and the
  `pageManifest.workflowTests` content-check all merged (`7abe93ac2`,
  `c9d0c1196`, `f5a88fac4`, `2bc74459b`, `baf9524e2`, `f98ffa544`); the
  manifest check is the permanent guard.
- `2026-09-18-desktop-backup-restore` — managed backup pairs, `restore_database`,
  in-app card, scheduled backups (`fd6a9444b`, `04f419a4c`, `09e07e350`,
  `819b2b3be`, `d4f64acbb`); recorded in `../FEATURES.md` +
  `../guides/desktop-backup-restore.md`.
- `2026-09-18-desktop-packaging-hardening` — updater armed, signing wiring
  env-gated, RPM shipped, first all-green full-bundle E2E, origin/proxy parity
  test (`49306e863`, `aaae95163`, `28b1ebde5`, `fe0439c44`); rationale in
  `../guides/PACKAGING.md` + `../../hotel-desktop/UPDATER.md`. Remaining cert
  provisioning is operator-side, tracked in `../ongoing-dev.md`.
- `2026-09-19-invoice-paper-island-glass-blur-design` — shipped in `8aaf5a6b7`;
  rationale already in `../DESIGN_SYSTEM.md` (`PaperIsland`, `--hotel-glass-blur`).
- Untracked `.superpowers/sdd/` ledgers for `2026-09-14-i18n-zh`,
  `2026-09-14-mobile-ux-density`, `2026-09-15-i18n-coverage` — orphaned by the
  2026-09-15/17 removals; cleared per this file's convention.

Removed 2026-09-15 (deliverables verified merged on master; recover from
`git log -- docs/superpowers/`): `2026-09-14-deposit-resolution` + spec,
`2026-09-14-mobile-ux-density` + spec + report, `2026-09-15-row-detail-drawers`
+ spec. The mobile-ux report's five-item backlog was migrated to
[`../ongoing-dev.md`](../ongoing-dev.md) (P2) rather than lost.

Removed 2026-09-17 (deliverables verified merged on master; recover from
`git log -- docs/superpowers/`):

- `2026-09-14-i18n-zh` plan + spec — zh shipped (`resources/zh/`, patch
  `0004 consent-locale-zh`, `SUPPORTED_LOCALES`); zh-TW followed in patch
  `0007`. Rationale: ADR 012 + `guides/internationalization.md`.
- `2026-09-15-backend-domain-module-migration` — complete: 39 domain
  directories, 38 merged routers (`consent` routeless). Rationale:
  `../ARCHITECTURE.md` + `../../AGENTS.md`.
- `2026-09-15-cross-platform-desktop-packaging` — Windows/Linux jobs in
  `desktop-build.yml`; `../guides/PACKAGING.md` is the owner. Remaining
  work (signing, updater, end-to-end verification) tracked in
  [`../ongoing-dev.md`](../ongoing-dev.md).
- `2026-09-15-data-transfer-privileged-permissions` — `data_transfer:*`
  RBAC, tiered scopes, step-up shipped (patch `0005`,
  `modules/data_transfer/routes.rs`). Rationale:
  `../guides/data-transfer.md` + `../API.md`.
- `2026-09-15-i18n-coverage` plan + spec — full-UI coverage shipped;
  `../i18n-coverage-inventory.md` is the record.
- `2026-09-16-channel-pricing` plan + spec — pricing rules + commission
  snapshots shipped (patch `0006`, `modules/booking_channels/pricing.rs`).
  Rationale: ADR 013.
- `2026-09-16-logo-loader` plan + spec — `BrandMark`/`LogoLoader` shipped.
  Rationale: `../DESIGN_SYSTEM.md` §Loading.
