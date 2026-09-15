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

| Item | Status |
|---|---|
| `plans/2026-09-14-i18n-zh.md` (+ `specs/2026-09-14-i18n-zh-design.md`) | **In progress** — Simplified Chinese as a third locale + 16-namespace split. Executing in worktree `.worktrees/i18n-zh` (branch `feat/i18n-zh`); ledger `.superpowers/sdd/2026-09-14-i18n-zh/`. Master remains `en` + `ms` — do not document zh as shipped until the branch lands. ⚠️ The branch is far behind master and its DB patch **must be renumbered 0003 → 0004** before merge — see the plan's Global Constraints. |
| `plans/2026-09-15-data-transfer-privileged-permissions.md` | **Not started** — `data_transfer:*` RBAC replacing `settings:manage`/`is_super_admin`, three export tiers, step-up auth. Verified 2026-09-15: `routes/data_transfer.rs` still uses `ensure_super_admin`, so none of it has landed. |

Removed 2026-09-15 (deliverables verified merged on master; recover from
`git log -- docs/superpowers/`): `2026-09-14-deposit-resolution` + spec,
`2026-09-14-mobile-ux-density` + spec + report, `2026-09-15-row-detail-drawers`
+ spec. The mobile-ux report's five-item backlog was migrated to
[`../ongoing-dev.md`](../ongoing-dev.md) (P2) rather than lost; its
`.superpowers/sdd/2026-09-14-mobile-ux-density/` ledger is untracked and was
left in place for whoever owns that directory to clear.
