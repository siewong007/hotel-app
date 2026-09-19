# Documentation Index

Canonical documentation map for this repository. Each subject has exactly one
owning document — update it there rather than restating the fact elsewhere.
If two documents disagree, the code is right and the document is wrong; fix the
document, then record the correction in `docs/ongoing-dev.md` if the drift was
non-obvious.

**Rule of truth:** source code > schema/seed > routes/services > config/deploy
files > tests > docs. Documentation never overrides the implementation.

## Layout

| Directory | Holds |
|---|---|
| `docs/` (root) | Top-level subjects: features, development, dependencies, design system, open work |
| `docs/api/` | API contract and the generated OpenAPI document |
| `docs/architecture/` | How the system is built and why — overview, decisions, flows, bounded contexts |
| `docs/guides/` | Task-oriented procedures: deploy, package, translate, transfer data, access hosts |
| `docs/reference/` | Generated and point-in-time inventories — consulted, not narrated |
| `docs/security/` | Production security posture, readiness, and operational drills |
| `docs/working-notes/` | Active implementation plans, specs, and reports (deleted on merge) |

File names are lower-case kebab-case throughout. Where a directory has its own
entry point it is named `README.md`; otherwise this index is the way in.

## Current-system documentation

| Subject | Canonical document |
|---|---|
| Project overview, quick start, tech stack | [`../README.md`](../README.md) |
| System architecture (layers, modules, invariants) | [`architecture/overview.md`](architecture/overview.md) |
| Feature registry (status per feature) | [`features.md`](features.md) |
| API contract (auth, errors, rate limits, endpoint index) | [`api/README.md`](api/README.md) + [`api/openapi.json`](api/openapi.json) |
| Request/payment/segment/realtime flows | [`architecture/system-flows.md`](architecture/system-flows.md) |
| Architectural decisions (why, not what) | [`architecture/decision-records.md`](architecture/decision-records.md) |
| Guest relations CRM boundary | [`architecture/guest-relations.md`](architecture/guest-relations.md) |
| gRPC-Web migration (strangler) | [`architecture/grpc-migration/`](architecture/grpc-migration/) — [phase 0 audit](architecture/grpc-migration/phase-0-audit.md), [phase 1 contract](architecture/grpc-migration/phase-1-contract.md), [phase 3 web client](architecture/grpc-migration/phase-3-web-client.md) |
| Dev setup, commands, troubleshooting | [`development.md`](development.md) |
| Dependency rationale | [`dependencies.md`](dependencies.md) |
| Design tokens and UI rules | [`design-system.md`](design-system.md) |
| Deployment, patching, backup/restore | [`guides/deployment.md`](guides/deployment.md) |
| Staging environment | [`guides/staging-environment.md`](guides/staging-environment.md) |
| VPS/production host access | [`guides/vps-access.md`](guides/vps-access.md) |
| Desktop packaging (all OSes) | [`guides/desktop-packaging.md`](guides/desktop-packaging.md) |
| Desktop managed backup/restore | [`guides/desktop-backup-restore.md`](guides/desktop-backup-restore.md) |
| Data transfer (hotel-backup v1) | [`guides/data-transfer.md`](guides/data-transfer.md) |
| i18n engine and adding languages | [`guides/internationalization.md`](guides/internationalization.md) |
| i18n terminology | [`guides/i18n-glossary.md`](guides/i18n-glossary.md) |
| i18n coverage audit + generated key map | [`reference/i18n-coverage-inventory.md`](reference/i18n-coverage-inventory.md), [`reference/i18n-key-usage-map.md`](reference/i18n-key-usage-map.md) |
| Production security operations | [`security/production-operations.md`](security/production-operations.md) |
| Production readiness assessment | [`security/production-readiness-assessment.md`](security/production-readiness-assessment.md) |
| Production go-live checklist | [`security/production-go-live-checklist.md`](security/production-go-live-checklist.md) |
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

## Historical / point-in-time records

Kept for context; they describe the state when written and are **not** updated
to track the current system. Check `git log` or current code before trusting a
claim in these.

- [`working-notes/`](working-notes/) — **active** implementation plans, specs
  and reports only. Shipped artifacts are deleted on merge;
  [`features.md`](features.md) is the record of what exists and git history
  preserves the plans themselves.
- [`architecture/grpc-migration/`](architecture/grpc-migration/) — phase
  records for the REST → gRPC strangler. Phases 0–3 have landed; the current
  contract state is summarised in
  [`architecture/decision-records.md`](architecture/decision-records.md)
  (ADR 014).
- [`guides/postgres-beta3-cutover.md`](guides/postgres-beta3-cutover.md) —
  completed runbook (kept: the same drill repeats at the next engine bump).
- [`reference/design-sync-reconciliation.md`](reference/design-sync-reconciliation.md)
  — Claude Design ↔ application page reconciliation snapshot (component sync
  findings accurate; the route manifest is a 2026-07-10 snapshot and predates
  the insights/revenue/campaigns routes). `../ds-bundle/` is a generated,
  git-ignored sync artifact documenting the MUI v7-era bundle as synced,
  **not** the current theme.
- [`security/data-retention-policy-draft.md`](security/data-retention-policy-draft.md)
  — proposed retention periods, not yet decided policy (requires legal review).
- [`../.claude/reports/`](../.claude/reports/) — past evaluation/rework reports.

## Maintenance rules

1. **One owner per fact.** If a fact lives in two places, one must link to the
   other. Never restate the permission list, the patch-catalog state, or the
   test-count heuristic — link to the owner instead.
2. **Change code → change its owner doc in the same PR.** Route add/remove →
   regenerate `api/openapi.json` (CI enforces). New module →
   `architecture/overview.md` feature table + `features.md`. New env var → the
   `.env.example` that owns it and any doc table that lists it. New patch →
   `database/README.md` stays generic; update any doc that names the catalog
   contents.
3. **Status labels.** `features.md` is the only place a feature's
   delivered/partial/experimental/not-delivered status is recorded. Other docs
   link to it instead of re-classifying.
4. **Plans delete on merge, not linger.** When a `working-notes/plans/*` item
   merges, move any lasting design rationale into the owning doc (usually
   `architecture/` or `architecture/decision-records.md`), confirm
   `features.md` covers the feature, then delete the plan/spec/report — git
   history is the archive. Delete finished items from `ongoing-dev.md`.
5. **Numbers rot.** Counts (tables, endpoints, tests, modules) in prose must be
   rechecked with the same command shown beside them, or dropped in favour of a
   link. If a doc asserts a number, say how it was produced.
6. **Secrets never appear in docs** — variable names and behaviour only.
7. **Links are gated.** `make docs-check` (CI: `Docs` job) fails on any
   relative Markdown link whose target file doesn't exist — fix the link when
   you move or rename a document. The gate runs on Linux, where paths are
   case-sensitive; a case-only mismatch passes on macOS and fails in CI.
8. **Naming.** New documents use lower-case kebab-case (`desktop-packaging.md`,
   not `PACKAGING.md`); a directory's entry point is `README.md`. Add the file
   to the table above in the same commit — an unlisted document has no owner.
