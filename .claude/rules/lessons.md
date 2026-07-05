# Lessons Log

Append-only log of corrections and escalations. Format and triggers are defined
in `maintenance.md`. Newest at the bottom. Consolidate at >30 entries / >300 lines.

## 2026-07-05 — CLAUDE.md claimed desktop mode uses wildcard CORS
- Trigger: subagent scan of hotel-desktop/src-tauri/src/commands.rs:113-116
- Wrong: CLAUDE.md said `ALLOWED_ORIGINS=*` is "used by desktop mode"
- Right: desktop mode sets a specific origin list (`tauri://localhost,...`); the
  wildcard path exists in the backend but desktop does not use it today
- Rule: treat CLAUDE.md environment claims as hints, not facts — verify against
  the code (grep the env var name) before repeating them to the user

## 2026-07-05 — External volume Write can fail transiently
- Trigger: Write tool returned `EACCES: permission denied, mkdir '/Volumes/APPLE EXTERNAL SSD '` on a path that had just worked
- Wrong: n/a (first occurrence)
- Right: retrying the identical Write succeeded immediately
- Rule: on EACCES writing under "/Volumes/APPLE EXTERNAL SSD /", retry once before
  changing approach; if it persists, fall back to Bash heredoc with quoted paths

## 2026-07-05 — Write tool refuses to overwrite unread files; .claude/rules/ is auto-loaded
- Trigger: `Write CLAUDE.md` failed with "File has not been read yet" after a session restart
- Wrong: assumed having the file content in context (via system reminder) counts as having read it
- Right: the Write tool requires an actual Read call on an existing file in the same
  session before overwriting; a short `limit` Read is enough. Separately observed:
  this harness auto-loads every `.claude/rules/*.md` as project instructions each session.
- Rule: before overwriting any existing file, Read it first (limit 10 is fine).
  Treat `.claude/rules/*.md` as ALWAYS-LOADED context — keep them lean; put
  on-demand content in `.claude/refs/` instead

## 2026-07-05 — Parallel agents shipped a producer/consumer mismatch
- Trigger: provision-pgsql.mjs (agent 1) bundled only the 6 binaries the OLD code
  invoked; agent 2 concurrently added pg_restore usage, and pg_dump (backups) was
  missed too — both agents' self-verification passed; only the commander's final
  cross-diff review caught it (runtime would fail with BinaryNotFound)
- Wrong: each agent verified its own artifact in isolation; the bin list was
  derived from the existing tree instead of from the consuming code
- Right: derive the required-binaries list by grepping `pgsql_bin.join` callers in
  postgres.rs; after parallel delegations, the commander must explicitly check
  producer artifacts against consumer code (what is provided vs what is invoked)
- Rule: when two subagents build artifacts where one consumes the other's output,
  always run a final cross-check that greps the consumer for everything the
  producer must supply — self-verification of each half is not sufficient
