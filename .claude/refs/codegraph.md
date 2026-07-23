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

The MCP integration normally syncs automatically. Run `codegraph sync .` after a
meaningful local change or before a fresh investigation when `status` reports pending
files. Use `codegraph index . --force` only to rebuild a missing or corrupted index.
