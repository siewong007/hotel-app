# Letter to Future Sessions

Note (2026-07-17): the enhancement docs this letter references (architecture-enhancements.md, enhancement-backlog.md) were deleted; open items now live in docs/ongoing-dev.md.

Written 2026-07-05 by the Fable 5 session that built the `.claude/rules/` +
`.claude/refs/` system. Read this once when onboarding; it is not a rulebook —
the rules live in `.claude/rules/`. This file is on-demand by design.

## Three things the user did not ask for, but matter most

1. **The desktop app has a data-loss time bomb: no PostgreSQL major-version
   upgrade path.** `hotel-desktop/src-tauri/src/postgres.rs` (see
   `ensure_pgdata_version_compatible`, ~line 231, and `IncompatibleDataDirectory`,
   ~line 63) detects a `PG_VERSION` mismatch and simply refuses to start. The day
   someone bumps the bundled PostgreSQL from 18 to 19, every existing install's
   data is stranded behind a manual `pg_upgrade`. Before any version bump: build
   the guided upgrade path (item #5 in `.claude/refs/architecture-enhancements.md`)
   and the backup-before-upgrade hook (item #6). This is the highest-value single
   piece of work in the repo that nobody scheduled.

2. **The dual-database (SQLite) feature deserves a deliberate keep-or-kill
   decision.** Desktop — the offline target that would justify SQLite — actually
   ships embedded PostgreSQL; `grep -ril sqlite hotel-desktop/` finds nothing.
   Meanwhile the dual-DB contract is the #1 source of CI failures and roughly
   doubles the cost of every schema change (two schema files, `sql_compat`
   macros, divergent Decimal handling). If some other deployment truly uses
   SQLite mode, document it in CLAUDE.md; if not, removing the feature would be
   the single biggest simplification available. This is a business decision —
   ask the user (judgment-rubrics #3), don't just do it.

3. **CI cannot see the desktop app break.** The `desktop` CI job stages
   `/dev/null` placeholders and runs `cargo check` — `tauri build` regressions,
   resource-glob mistakes, and sidecar-spawn failures all ship silently. A
   `workflow_dispatch` packaging job with cached artifacts (enhancement #1) plus
   removing the committed 16MB sidecar binary from git (#2) are cheap and high
   value. Note also: half-armed updater with placeholder keys
   (`tauri.conf.json`) — arm it or hide the UI before a release.

## How this system will degrade, and prevention

- **Line anchors rot** (bookings.rs:537 etc. move with every edit). Prevention is
  already written: verify anchors with Grep before use (00-diagnosis Leak #1),
  spot-check refs >90 days old (maintenance.md). The failure mode is a haiku
  agent trusting a stale anchor — the rules tell it not to; keep telling it.
- **CLAUDE.md re-bloats.** Every convenient fact wants to live there. The budget
  (≤150 lines, index only) fails only if nobody enforces it — maintenance.md
  makes structural CLAUDE.md edits ask-first. Enforce that.
- **lessons.md becomes a landfill.** Append-only logs grow until nobody reads
  them, and `.claude/rules/` is ALWAYS-LOADED in this harness, so bloat there
  costs every session. The consolidation trigger (>30 entries / >300 lines) must
  actually fire; when it does, promote proven rules and delete the rest.
- **Model names go stale.** `model-dispatch.md` pins names verified 2026-07-05
  (`haiku`/`sonnet`/`opus`/`fable` on the Agent tool). When Claude 6-era models
  arrive, the table will be silently wrong. The file says re-verify if >6 months
  old — do it in-session (attempt a delegation, read the error) rather than from
  memory.
- **Rules contradict each other after piecemeal edits.** Any semantic rule change
  should re-run the adversarial review template (delegation-templates #5) over
  the whole `.claude/rules/` directory. Cheap with sonnet; do it after every
  non-trivial rules edit.

## Lowest-confidence outputs of this session (honest list)

1. **Line anchors in `.claude/refs/booking-workflow.md` / `ledger-workflow.md`** —
   copied from the pre-rewrite CLAUDE.md, NOT re-verified against current code in
   this session. Treat every anchor as a hint until Grep confirms it.
2. **`.claude/refs/architecture-enhancements.md`** — produced by a sonnet subagent
   in one pass. Facts were evidence-cited and it correctly falsified a CLAUDE.md
   claim (desktop CORS), which raises trust, but I did not independently re-derive
   items #4–#6; effort/risk ratings are the subagent's judgment. Open questions
   at the bottom of that file are genuinely open.
3. **Whether safety-routed Opus 4.8 requests consume the session quota** —
   Unconfirmed; recommended to test through the usage dashboard.
4. **The always-loaded budget math** — I observed this harness auto-loading
   `.claude/rules/*.md`, but I cannot confirm every future harness version does
   the same, nor the exact token accounting. If a future session does NOT see
   rules content automatically, CLAUDE.md's routing table is the fallback — that
   redundancy is deliberate.
5. **AGENTS.md overlap** — I flagged it as Codex-owned and did not touch it. If
   it drifts from CLAUDE.md, agents reading both will get contradictions; the
   user must decide which is canonical. Unresolved by design.

## Handoff notes / unfinished items

- Memory (`~/.claude/projects/...-hotel-app/memory/`) was empty at session start;
  this session seeded a pointer to this system. Future sessions: keep MEMORY.md
  under ~40 lines and store durable user/project facts there, not code facts.
- The five enhancement items in architecture-enhancements.md are suggestions, not
  scheduled work. Nothing has been implemented. Items #2 (uncommit sidecar
  binary) and #3 (sqlite decision) need user sign-off; #1/#4/#6 are safe to
  propose as normal PRs.
