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

(none — this directory is currently empty; everything below is history)

Removed 2026-09-15 (deliverables verified merged on master; recover from
`git log -- docs/superpowers/`): `2026-09-14-deposit-resolution` + spec,
`2026-09-14-mobile-ux-density` + spec + report, `2026-09-15-row-detail-drawers`
+ spec. The mobile-ux report's five-item backlog was migrated to
[`../ongoing-dev.md`](../ongoing-dev.md) (P2) rather than lost; its
`.superpowers/sdd/2026-09-14-mobile-ux-density/` ledger is untracked and was
left in place for whoever owns that directory to clear.

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
