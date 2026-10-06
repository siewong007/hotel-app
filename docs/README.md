# Documentation Index

Canonical documentation map for this repository. Each subject has exactly one
owning document, so update the fact there rather than restating it elsewhere.
If two documents disagree, the code is right and the document is wrong. Fix
the document, and if the drift was non-obvious, record the correction in
`docs/ongoing-dev.md`.

**Rule of truth:** source code > schema/seed > routes/services > config/deploy
files > tests > docs. Documentation never overrides the implementation.

## Layout

| Directory | Holds |
|---|---|
| `docs/` (root) | Top-level subjects: features, development, dependencies, design system, open work |
| `docs/api/` | API contract and the generated OpenAPI document |
| `docs/architecture/` | How the system is built and why: overview, decisions, flows, bounded contexts, transports |
| `docs/guides/` | Task-oriented procedures: deploy, upgrade, package, translate, transfer data, access hosts |
| `docs/reference/` | Generated and point-in-time inventories, consulted rather than narrated |
| `docs/security/` | Production security posture, readiness, and operational drills |
| `docs/working-notes/` | Active implementation plans, specs, and reports only. They are deleted on merge, and new plans go here, not in `docs/superpowers/`. |

File names are lower-case kebab-case throughout. A directory with its own
entry point names it `README.md`; otherwise this index is the way in.

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
| gRPC-Web transport (contract rules, RPC map, rollout) | [`architecture/grpc.md`](architecture/grpc.md) |
| Dev setup, commands, troubleshooting | [`development.md`](development.md) |
| Dependency rationale | [`dependencies.md`](dependencies.md) |
| Design tokens and UI rules | [`design-system.md`](design-system.md) |
| Deployment, patching, backup/restore | [`guides/deployment.md`](guides/deployment.md) |
| PostgreSQL engine upgrade (dump and restore) | [`guides/postgres-engine-upgrade.md`](guides/postgres-engine-upgrade.md) |
| Staging environment | [`guides/staging-environment.md`](guides/staging-environment.md) |
| VPS/production host access | [`guides/vps-access.md`](guides/vps-access.md) |
| Desktop packaging (all OSes) | [`guides/desktop-packaging.md`](guides/desktop-packaging.md) |
| Desktop managed backup/restore | [`guides/desktop-backup-restore.md`](guides/desktop-backup-restore.md) |
| Data transfer (hotel-backup v1) | [`guides/data-transfer.md`](guides/data-transfer.md) |
| i18n engine, legal/help/landing copy, adding languages | [`guides/internationalization.md`](guides/internationalization.md) |
| i18n terminology | [`guides/i18n-glossary.md`](guides/i18n-glossary.md) |
| i18n coverage audit | [`reference/i18n-coverage-inventory.md`](reference/i18n-coverage-inventory.md) |
| Production security operations | [`security/production-operations.md`](security/production-operations.md) |
| Production readiness assessment | [`security/production-readiness-assessment.md`](security/production-readiness-assessment.md) |
| Production go-live checklist | [`security/production-go-live-checklist.md`](security/production-go-live-checklist.md) |
| Backup/restore drill | [`security/backup-restore.md`](security/backup-restore.md) |
| Database lifecycle (baseline/seed/patches, `seed` dataset) | [`../hotel-app-be/database/README.md`](../hotel-app-be/database/README.md) |
| Backend quick start | [`../hotel-app-be/README.md`](../hotel-app-be/README.md) |
| Desktop build pipeline | [`../hotel-desktop/BUILD_SPEED.md`](../hotel-desktop/BUILD_SPEED.md) |
| Desktop updater | [`../hotel-desktop/UPDATER.md`](../hotel-desktop/UPDATER.md) |
| App sitemap (Claude Design guideline) | [`../hotel-web-fe/design-guidelines/app-structure.md`](../hotel-web-fe/design-guidelines/app-structure.md) |
| Claude Design component sync | [`../.design-sync/NOTES.md`](../.design-sync/NOTES.md) |
| OCI dev infrastructure | [`../infra/terraform/oci/README.md`](../infra/terraform/oci/README.md) |
| Open work tracker | [`ongoing-dev.md`](ongoing-dev.md) |
| Contribution process | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Release history | [`../CHANGELOG.md`](../CHANGELOG.md) |
| Agent conventions (layers, naming, safety) | [`../AGENTS.md`](../AGENTS.md) |
| Agent routing index (commands, CI, env) | [`../CLAUDE.md`](../CLAUDE.md) |
| Booking lifecycle internals | [`../.claude/refs/booking-workflow.md`](../.claude/refs/booking-workflow.md) |
| Ledger internals | [`../.claude/refs/ledger-workflow.md`](../.claude/refs/ledger-workflow.md) |

## Point-in-time records

These are kept for context. They describe the state when they were written
and are **not** updated to track the system. Check `git log` or the current
code before trusting a claim in them.

- [`reference/i18n-key-usage-map.md`](reference/i18n-key-usage-map.md) is a
  key-to-file map generated on 2026-09-15 by a one-off static pass. No
  generator is committed, so it predates every key added since. Use it for
  orientation only, and grep for the truth.
- [`security/data-retention-policy-draft.md`](security/data-retention-policy-draft.md)
  holds proposed retention periods. It is not yet decided policy and needs
  legal review.
- [`working-notes/README.md`](working-notes/README.md) records which plans
  and reports were retired, and how to recover them from git.

There is no archive directory. Shipped plans, superseded runbooks, and agent
reports are deleted once their conclusions reach an owner document, and git
history is the archive. The last such sweep was on 2026-10-05.

## Maintenance rules

1. **One owner per fact.** If a fact lives in two places, one must link to the
   other. Never restate the permission list, the patch-catalog state, or the
   test-count heuristic. Link to the owner instead.
2. **Change code → change its owner doc in the same PR.**
   - Route added or removed: regenerate `api/openapi.json` (CI enforces this).
   - New module: update the `architecture/overview.md` feature table and
     `features.md`.
   - New env var: update the `.env.example` that owns it and any doc table
     that lists it.
   - New patch: `database/README.md` stays generic, but update any doc that
     names the catalog contents.
3. **Status labels.** `features.md` is the only place a feature's
   delivered/partial/experimental/not-delivered status is recorded. Other docs
   link to it instead of re-classifying.
4. **Plans delete on merge, not linger.** When a `working-notes/plans/*` item
   merges:
   - Move any lasting design rationale into the owning doc (usually
     `architecture/` or `architecture/decision-records.md`).
   - Confirm `features.md` covers the feature, and carry anything left undone
     into `ongoing-dev.md`.
   - Delete the plan, spec, or report. Git history is the archive.

   Delete finished items from `ongoing-dev.md` too.
5. **Numbers rot.** A count in prose (tables, endpoints, tests, modules) must
   be rechecked with the command shown beside it, or dropped in favour of a
   link. If a doc asserts a number, say how it was produced.
6. **Secrets never appear in docs.** Document variable names and behaviour
   only.
7. **Links are gated.** `make docs-check` (CI: `Docs` job) fails on any
   relative Markdown link whose target file does not exist, so fix the link
   when you move or rename a document. The gate checks files only, not
   `#anchors`. It runs on Linux, where paths are case-sensitive, so a
   case-only mismatch passes on macOS and fails in CI.
8. **Naming.** New documents use lower-case kebab-case
   (`desktop-packaging.md`, not `PACKAGING.md`), and a directory's entry point
   is `README.md`. Add the file to the table above in the same commit, because
   an unlisted document has no owner.
