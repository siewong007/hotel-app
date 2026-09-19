# Documentation index

Canonical documentation map for this repository. Each subject has exactly one
owning document — update it there rather than restating the fact elsewhere.
If two documents disagree, the code is right and the document is wrong; fix the
document, then record the correction in `docs/ongoing-dev.md` if the drift was
non-obvious.

**Rule of truth:** source code > schema/seed > routes/services > config/deploy
files > tests > docs. Documentation never overrides the implementation.

## Current-system documentation

| Subject | Canonical document |
|---|---|
| Project overview, quick start, tech stack | [`../README.md`](../README.md) |
| System architecture (layers, modules, invariants) | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Feature registry (status per feature) | [`FEATURES.md`](FEATURES.md) |
| API contract (auth, errors, rate limits, endpoint index) | [`API.md`](API.md) + [`api/openapi.json`](api/openapi.json) |
| Request/payment/segment/realtime flows | [`architecture/architecture-flow.md`](architecture/architecture-flow.md) |
| Architectural decisions (why, not what) | [`architecture/ADRS.md`](architecture/ADRS.md) |
| Guest relations CRM boundary | [`architecture/guest-relations.md`](architecture/guest-relations.md) |
| Dev setup, commands, troubleshooting | [`DEVELOPMENT.md`](DEVELOPMENT.md) |
| Dependency rationale | [`DEPENDENCIES.md`](DEPENDENCIES.md) |
| Design tokens and UI rules | [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) |
| Deployment, patching, backup/restore | [`guides/deployment.md`](guides/deployment.md) |
| Data transfer (hotel-backup v1) | [`guides/data-transfer.md`](guides/data-transfer.md) |
| i18n engine and adding languages | [`guides/internationalization.md`](guides/internationalization.md) |
| i18n terminology + coverage audit | [`guides/i18n-glossary.md`](guides/i18n-glossary.md), [`i18n-coverage-inventory.md`](i18n-coverage-inventory.md); [`i18n-key-usage-map.md`](i18n-key-usage-map.md) is generated |
| VPS/production host access | [`guides/vps-access.md`](guides/vps-access.md) |
| Staging environment | [`staging.md`](staging.md) |
| Desktop packaging (all OSes) | [`guides/PACKAGING.md`](guides/PACKAGING.md) |
| Production security operations | [`security/production-operations.md`](security/production-operations.md) |
| Production readiness assessment | [`security/production-readiness-assessment.md`](security/production-readiness-assessment.md) |
| Backup/restore drill | [`security/backup-restore.md`](security/backup-restore.md) |
| Database lifecycle (baseline/seed/patches) | [`../hotel-app-be/database/README.md`](../hotel-app-be/database/README.md) |
| Backend quick start | [`../hotel-app-be/README.md`](../hotel-app-be/README.md) |
| Desktop build pipeline | [`../hotel-desktop/BUILD_SPEED.md`](../hotel-desktop/BUILD_SPEED.md) |
| Desktop updater | [`../hotel-desktop/UPDATER.md`](../hotel-desktop/UPDATER.md) |
| OCI dev infrastructure | [`../infra/terraform/oci/README.md`](../infra/terraform/oci/README.md) |
| Open work tracker | [`ongoing-dev.md`](ongoing-dev.md) |
| Contribution process | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Agent conventions (layers, naming, safety) | [`../AGENTS.md`](../AGENTS.md) |
| Agent routing index (commands, CI, env) | [`../CLAUDE.md`](../CLAUDE.md) |
| Booking lifecycle internals | [`../.claude/refs/booking-workflow.md`](../.claude/refs/booking-workflow.md) |
| Ledger internals | [`../.claude/refs/ledger-workflow.md`](../.claude/refs/ledger-workflow.md) |
| Design-sync bundle (Claude Design) | [`claude-design-page-sync.md`](claude-design-page-sync.md); `../ds-bundle/` is a generated, git-ignored sync artifact — it documents the MUI v7-era bundle as synced, **not** the current theme |

## Historical / point-in-time records

Kept for context; they describe the state when written and are **not** updated
to track the current system. Check `git log` or current code before trusting a
claim in these.

- `superpowers/` — **active** implementation plans/specs/reports only. Shipped
  artifacts are deleted on merge; `FEATURES.md` is the record of what exists
  and git history preserves the plans themselves.
- `guides/postgres-beta3-cutover.md` — completed runbook (kept: same drill
  repeats at the next engine bump).
- `claude-design-page-sync.md` — reconciliation snapshot (component sync
  findings accurate; route manifest is a 2026-07-10 snapshot and predates the
  insights/revenue/campaigns routes).
- `security/data-retention-policy-draft.md` — proposed retention periods,
  not yet decided policy (requires legal review).
- `../.claude/reports/` — past evaluation/rework reports.

## Maintenance rules

1. **One owner per fact.** If a fact lives in two places, one must link to the
   other. Never restate the permission list, the patch-catalog state, or the
   test-count heuristic — link to the owner instead.
2. **Change code → change its owner doc in the same PR.** Route add/remove →
   regenerate `api/openapi.json` (CI enforces). New module → `ARCHITECTURE.md`
   feature table + `FEATURES.md`. New env var → the `.env.example` that owns it
   and any doc table that lists it. New patch → `database/README.md` stays
   generic; update any doc that names the catalog contents.
3. **Status labels.** `FEATURES.md` is the only place a feature's
   delivered/partial/experimental/not-delivered status is recorded. Other docs
   link to it instead of re-classifying.
4. **Plans delete on merge, not linger.** When a `superpowers/plans/*` item
   merges, move any lasting design rationale into the owning doc (usually
   `architecture/` or `ADRS.md`), confirm `FEATURES.md` covers the feature,
   then delete the plan/spec/report — git history is the archive. Delete
   finished items from `ongoing-dev.md`.
5. **Numbers rot.** Counts (tables, endpoints, tests, modules) in prose must be
   rechecked with the same command shown beside them, or dropped in favour of a
   link. If a doc asserts a number, say how it was produced.
6. **Secrets never appear in docs** — variable names and behaviour only.
7. **Links are gated.** `make docs-check` (CI: `Docs` job) fails on any
   relative Markdown link whose target file doesn't exist — fix the link when
   you move or rename a document.
