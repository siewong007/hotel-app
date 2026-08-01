# Maintenance Protocol for the .claude System

Who may change what, where lessons go, and when to clean up.

## Files agents may modify WITHOUT asking the user

- `.claude/rules/lessons.md` — append-only during normal work (format below).
- `.claude/reports/*` — subagent output; freely created, freely pruned.
- `.claude/refs/*.md` — MUST be updated when the code they describe changes
  (stale refs are worse than none). Verify each line anchor with Grep before
  writing it.
- The persistent memory directory
  (`~/.claude/projects/-Volumes-APPLE-EXTERNAL-SSD--Personal-Projects-hotel-app/memory/`)
  and its `MEMORY.md` index.
- Line-anchor corrections and factual fixes anywhere in `.claude/rules/*.md`
  (e.g. a command that moved) — but not rule *semantics*.

## Files that require ASKING THE USER first

- `CLAUDE.md` — structural/semantic changes (fixing a stale path or command is fine).
- `.claude/refs/model-dispatch.md` routing table and escalation semantics.
- `.claude/rules/judgment-rubrics.md` rule semantics.
- `AGENTS.md` (Codex-oriented; owned by the user's other tooling).
- `.github/workflows/ci.yml`, `hotel-app-be/database/` baseline SQL structure, anything under
  `hotel-desktop/src-tauri/pgsql/`.
- Deleting any file the agent did not create this session.

Backup rule: before modifying any of the ask-first files (once approved), copy the
original to `.claude/backups/<name>.<YYYY-MM-DD>.bak`.

## Where lessons from failures go

Append to `.claude/rules/lessons.md`. A lesson is warranted when: a CI run failed
after "done" was claimed, a delegation had to be escalated, a rubric misfired, or
the user corrected the approach. Routine success is not a lesson.

Required format (one block per lesson, newest at the bottom):

```
## YYYY-MM-DD — short title
- Trigger: what happened (1 line, include file:line or command)
- Wrong: what the agent believed or did
- Right: what turned out to be correct
- Rule: the reusable instruction, phrased so haiku can follow it
```

If the Rule contradicts an existing rule in `.claude/rules/*.md`, do not silently
add it — flag the conflict to the user and record which one won.

## Cleanup triggers (check at session start; act when tripped)

- `lessons.md` > 30 entries or > 300 lines → consolidate: merge duplicates,
  promote proven rules into the relevant `.claude/rules/*.md` file (ask-first
  files need approval), delete superseded entries. Keep a dated one-line note of
  what was consolidated.
- `.claude/reports/` > 20 files → delete reports older than 60 days unless
  referenced by a rules/refs file.
- Memory: if `MEMORY.md` exceeds ~40 lines, run the
  `anthropic-skills:consolidate-memory` skill.
- Any `.claude/refs/*.md` older than 90 days → spot-check 3 of its line anchors
  with Grep; if ≥2 are stale, schedule a refresh (haiku read + sonnet rewrite).

## Line budgets (hard limits from the system's design)

- `CLAUDE.md` ≤ 150 lines, index/routing only — long content goes to `.claude/refs/`.
- Always-loaded content (CLAUDE.md + anything it @-imports; currently it imports
  nothing) ≤ 500 lines total. Everything else is read on demand.
- If a budget is exceeded, split content out to refs before adding anything new.
