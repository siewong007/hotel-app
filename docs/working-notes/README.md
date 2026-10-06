# Working Notes — Plans, Specs, and Reports

Working artifacts of the plan-driven workflow: `plans/` (task checklists),
`specs/` (design documents), and `reports/` (after-action notes). **This
directory holds active work only.** It is not product documentation, and
nothing here is a source of truth about the shipped system.

Put new plans and specs **here**, not in `docs/superpowers/`. Planning skills
default to `docs/superpowers/plans/`, and two September 2026 plans landed
there after this directory replaced it on 2026-09-19. Agent scratch output
belongs in the session scratchpad, not the repository.

When a plan merges:

1. Move any lasting design rationale into the owning canonical doc
   (`../architecture/`, `../architecture/decision-records.md`, or the guide
   that owns the subject).
2. Confirm [`../features.md`](../features.md) records the feature and its
   status. The registry is the permanent record of what exists.
3. Carry anything left undone into [`../ongoing-dev.md`](../ongoing-dev.md).
4. Delete the plan, its spec, and its report. Git history is the archive, so
   do not keep shipped plans as "historical documentation".

## Active

(none)

## Removal record

Recover any of these with `git log --all -- <path>`, then `git show <sha>:<path>`.

- **2026-10-05:** every plan and report verified against the code and retired.
  - Seed system: plan and spec, from `docs/superpowers/`. Shipped as
    `hotel-app-be/src/bin/seed/` and documented in
    `../../hotel-app-be/database/README.md`.
  - Four-locale legal corpus and Salim Inn landing: plan and spec, from
    `docs/superpowers/`. Rationale now in `../guides/internationalization.md`.
  - The gRPC phase 0–3 records, consolidated into `../architecture/grpc.md`.
  - The 19beta3 cutover runbook, generalized into
    `../guides/postgres-engine-upgrade.md`.
  - The 2026-07-10 design-sync route manifest; its determination is in
    `.design-sync/NOTES.md`.
  - All 43 files under `.claude/reports/`: the July 2026 audits and rework
    plans, plus the September PG19 benchmark, RPM evaluation, and desktop E2E
    ledger. Their conclusions went to the owner docs. Findings still open
    after re-verification moved to `../ongoing-dev.md`.
- **2026-09-15 to 2026-09-19:** 15 shipped plans, with their specs and
  reports: deposit resolution, mobile density, row-detail drawers, i18n zh,
  i18n coverage, the backend domain-module migration, cross-platform desktop
  packaging, desktop packaging hardening, data-transfer permissions, channel
  pricing, logo loader, distributed-state follow-ups, frontend test depth,
  desktop backup/restore, and the invoice glass blur. Recover them with
  `git log -- docs/superpowers/`.
