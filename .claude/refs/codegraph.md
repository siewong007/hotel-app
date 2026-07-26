# CodeGraph Workflow

Use CodeGraph for every repository architecture, dependency, caller/callee, or
change-impact question. It is the repository's only code-graph system. The local
`.codegraph/` index is derived data, Git-ignored, and must never be committed.

## Start every graph investigation

From the repository root, check the index first:

```bash
codegraph status .
```

If changes are pending, sync before querying:

```bash
codegraph sync .
```

If the index is missing or unusable, initialize it with the repository's pinned
tooling expectation, then index:

```bash
npm install --global @colbymchenry/codegraph@1.5.0
codegraph init .
codegraph index . --force
```

## Choose the smallest useful query

| Need | Command |
|---|---|
| Architecture or data flow | `codegraph explore "How does <domain> flow through the app?"` |
| Who calls a shared symbol | `codegraph callers "<symbol>"` |
| What a symbol calls | `codegraph callees "<symbol>"` |
| Change blast radius | `codegraph impact "<symbol>"` |
| One file or symbol with source context | `codegraph node "<symbol-or-file>"` |

Use CodeGraph before `rg` when the task is about relationships. Use `rg` afterward
for exact text, SQL resources, generated files, or anything excluded from the
index.

## Verification boundary

CodeGraph is discovery evidence, not a substitute for source verification. Before
editing, read the relevant files and verify critical behavior directly, especially
authentication, authorization, payments, ledgers, migrations, schemas, and SQL.
The index covers backend, frontend, and desktop source; inspect SQL/data resources,
secrets, generated outputs, design-sync files, and deployment infrastructure directly.

## Keep the index current

Auto-sync IS wired up as of 2026-07-27 (`codegraph install -t claude -l local`).
`.mcp.json` runs `codegraph serve --mcp`, whose shared engine starts a file watcher
that re-indexes on change — verified end-to-end: a new file became queryable within
seconds and `status` stayed "up to date" with no manual sync. A background daemon
(`.codegraph/daemon.sock`, 5-min idle timeout) holds the watcher.

Manual `codegraph sync .` is now only needed when the daemon is not running — most
often for CLI-only work in a shell with no MCP session attached. `codegraph status .`
is still the cheap first move for any investigation; it tells you which case you are in.
Use `codegraph index . --force` only to rebuild a missing or corrupted index.

Requires the `codegraph` binary on PATH. Because `.mcp.json` and `.claude/settings.json`
are committed, a machine without it gets a failed MCP server at startup — install with
`npm i -g @colbymchenry/codegraph@1.5.0` there, or delete those two files locally.

The installer also writes a `UserPromptSubmit` hook (`codegraph prompt-hook`) that
injects graph context into structural prompts. It was REMOVED deliberately on
2026-07-27 — it fires on any prompt with a symbol-like word and matches on token
overlap, not intent, so it spent ~16KB of context on unrelated symbols. Auto-sync does
not depend on it. `codegraph install --refresh` (run automatically by
`codegraph upgrade`) rewrites what a previous install configured and will re-add the
hook — after any upgrade, check `.claude/settings.json` and delete the `hooks` block
again, or re-run the install with `--no-permissions`.
