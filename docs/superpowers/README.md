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
| `plans/2026-09-14-i18n-zh.md` (+ `specs/2026-09-14-i18n-zh-design.md`) | **In progress** — Simplified Chinese as a third locale + 16-namespace split. Executing in worktree `.worktrees/i18n-zh` (branch `feat/i18n-zh`); ledger `.superpowers/sdd/2026-09-14-i18n-zh/`. Master remains `en` + `ms` — do not document zh as shipped until the branch lands. |
| `plans/2026-09-14-mobile-ux-density.md` (+ spec, `reports/2026-09-14-mobile-ux-report.md`) | **Partially shipped** — phone-density pass; ledger `.superpowers/sdd/2026-09-14-mobile-ux-density/`. Some items remain open. |
| `plans/2026-09-14-deposit-resolution.md` (+ spec) | **In progress** — checkout deposit resolution UX; worktree `.worktrees/deposit-resolution`. |
| `plans/2026-09-15-row-detail-drawers.md` (+ spec) | **In progress** — row detail drawers; worktree `.worktrees/row-drawers`. |

Shipped plans were removed 2026-09-15; recover any of them from git history
(`git log -- docs/superpowers/`).
