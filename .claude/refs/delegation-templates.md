# Delegation Prompt Templates

Fill-in-the-blank prompts for the Agent tool. Copy the template, replace every
`{...}`, delete nothing else. Routing (which agent type + model) is in
`model-dispatch.md`. Every template already embeds the three required elements
(goal/motivation, acceptance criteria, report format) — do not strip them.

Path warning for ALL templates: this repo lives at
"/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app" — the volume name
contains a trailing space after "SSD". Always double-quote paths in shell commands.

---

## 1. SEARCH (Explore agent, haiku; sonnet if first pass misses)

> GOAL: Locate {what: e.g. "every place booking status transitions are written"}
> in {scope: e.g. "hotel-app-be/src"}. MOTIVATION: {why: e.g. "we need to add a
> status-change audit hook and must not miss a write path"}.
> Search breadth: {medium | very thorough}.
> Check at least these naming conventions: {list: e.g. "status =, set_status, UPDATE bookings SET status"}.
> ACCEPTANCE CRITERIA: (1) every hit reported as `path:line` with a ≤1-line
> description; (2) explicitly state which conventions/directories you checked and
> found EMPTY (absence claims need evidence); (3) no file contents pasted.
> REPORT FORMAT: a list of `path:line — description`, then a "checked but empty"
> list. Max 30 lines.

## 2. IMPLEMENTATION (general-purpose, sonnet; opus per rubric #1)

> GOAL: Implement {feature/fix} in {files/area}. MOTIVATION: {user-visible reason}.
> CONTEXT YOU MUST READ FIRST: .claude/rules/00-diagnosis.md (all three leak
> checklists apply), plus {specific files with line anchors}.
> SPEC: {exact behavior, inputs/outputs, edge cases. If SQL is involved: must use
> param!/sql_compat helpers and update BOTH database/postgres/ and
> DO NOT: {out-of-scope things, e.g. "refactor surrounding code, touch CI config"}.
> ACCEPTANCE CRITERIA: (1) {behavioral check, e.g. "POST /x returns 201 and row
> appears"}; (2) `cargo check --all-features` exits 0 [backend] and/or
> `bun run typecheck && bun run lint && bun run test` exit 0 [frontend];
> (3) new-endpoint checklist in 00-diagnosis.md Leak #3 walked — list each item
> and its status; (4) diff contains no unwrap-on-fallible, no raw fetch(), no
> literal NOW()/$1 in new SQL.
> REPORT FORMAT: files changed with line ranges; verification commands run and
> their exit status; checklist item statuses; open risks. Max 20 lines. Do not
> paste the diff.

## 3. REFACTORING (general-purpose; haiku with exact spec, sonnet if judgment needed)

> GOAL: Apply this exact transformation: {precise before→after pattern, with one
> concrete example diff}. Scope: {file list or glob}. MOTIVATION: {why}.
> BEHAVIOR MUST NOT CHANGE. If a site does not match the pattern cleanly, SKIP it
> and list it — do not improvise.
> ACCEPTANCE CRITERIA: (1) all matching sites transformed or listed as skipped;
> (2) {typecheck/lint/test commands} exit 0; (3) `git diff --stat` touches only
> files in scope.
> REPORT FORMAT: count transformed, list of skipped sites with `path:line` and
> one-line reason each, verification exit statuses. Max 15 lines.

## 4. RESEARCH (general-purpose, sonnet)

> GOAL: Answer: {precise question, e.g. "does Tauri 2 updater support delta
> updates on Windows, and what does it require of tauri.conf.json?"}.
> MOTIVATION: {decision this feeds}.
> SOURCES: prefer official docs/changelogs; note the version you verified against.
> Distinguish VERIFIED (cite URL/file) from INFERRED. If the answer cannot be
> confirmed, say "unconfirmed" — do not fill gaps from memory.
> ACCEPTANCE CRITERIA: (1) direct answer in first 3 lines; (2) every claim tagged
> verified/inferred with source; (3) long findings written to
> ".claude/reports/{topic}-{YYYY-MM-DD}.md", not pasted.
> REPORT FORMAT: answer, 3–5 key facts with tags, path to the report file. Max 15 lines.

## 5. REVIEW (fresh-context general-purpose, sonnet; opus for auth/money/schema)

Never assign review to the agent (or session) that wrote the code. For working-tree
diffs prefer the `/code-review` skill; use this template for reviewing files,
plans, or subagent output.

> GOAL: Adversarially review {path(s) or diff ref} against these criteria:
> {acceptance criteria of the original task}. MOTIVATION: independent check —
> the author's claims are NOT evidence; re-derive from the artifact itself.
> CHECK SPECIFICALLY: (1) contradictions with .claude/rules/*.md and CLAUDE.md;
> (2) wrong paths/commands/tool or model names (verify each against the repo —
> Glob the path, grep the script); (3) PostgreSQL query and schema violations per 00-diagnosis.md
> Leak #2; (4) ambiguous instructions a smaller model could misread — quote them.
> ACCEPTANCE CRITERIA: every finding has `path:line`, a severity
> (blocker/should-fix/nit), and a concrete suggested fix.
> REPORT FORMAT: verdict line (PASS / PASS-with-nits / FAIL), then findings by
> severity. Max 25 lines. "No findings" is acceptable only with a list of what
> you checked.

---

## Post-delegation duties of the commander (every time)

1. Check the report against the acceptance criteria YOU wrote — reject vague reports.
2. Failure → follow the upgrade path in model-dispatch.md (haiku→sonnet once;
   sonnet→opus after 2 failures, with full trace).
3. Anything reusable learned → append to `.claude/rules/lessons.md` (format in maintenance.md).
4. Relay conclusions to the user in plain sentences — never assume they saw the agent's output.

## Continuing an agent

To follow up with an agent that already has context, use SendMessage with its
ID/name instead of spawning a new Agent (a new Agent call starts cold and re-pays
the whole context cost).
