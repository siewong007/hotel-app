# Model Dispatch Rules

Read this file BEFORE delegating any work with the Agent tool. It is the routing
authority for this repo. Written 2026-07-05; model facts verified in-session that day.

## Verified model facts (do not fill in from memory — re-verify if this file is >6 months old)

Agent tool `model` parameter accepts exactly: `haiku`, `sonnet`, `opus`, `fable`.
- `haiku`  → claude-haiku-4-5-20251001 (cheapest)
- `sonnet` → claude-sonnet-5 (default workhorse)
- `opus`   → claude-opus-5 (escalation tier; was claude-opus-4-8 when this file was written — corrected 2026-08-02)
- `fable`  → claude-fable-5 (rarely available; if a delegation with `model: "fable"`
  errors or is unavailable, fall back to `opus` — do not retry fable)

The Agent tool has NO effort parameter. Effort levels exist only on the
`/code-review` skill (`low`→`max`; `ultra` is a user-triggered, billed cloud review
you must never launch yourself). "Fast mode" (`/fast`) is a user-side toggle for
Opus output speed, not something you configure.

Available subagent types: `general-purpose` (all tools), `Explore` (read-only search;
CANNOT Write/Edit files), `Plan` (design/planning; CANNOT Write/Edit), `claude`
(catch-all), `claude-code-guide` (Claude Code/API questions only), `statusline-setup`
(status line config only).

Unconfirmed: whether requests safety-routed to Opus 4.8 consume the session's quota.
Recommended to test through the usage dashboard; do not assert either way.

## Rule 0: The commander does not execute

The main session (whatever model runs it) is the commander. It plans, delegates,
integrates results, and talks to the user. It does NOT personally do: repo-wide
scans, reading >2 large files, batch mechanical edits, web research, or long
validation runs. Those go to subagents. Exception: single-file surgical edits the
commander has already fully specified are cheaper done directly than delegated.

## Routing table

| Task | Agent type | Model | Why |
|---|---|---|---|
| Find where X is defined/used (broad sweep) | Explore | haiku | Mechanical; conclusion + file:line is all you need |
| Read-back validation of written files | general-purpose | haiku | Pure verbatim checking |
| Batch mechanical edits from an exact spec | general-purpose | haiku | Spec removes judgment; upgrade to sonnet on first failure |
| Implement a scoped feature/fix (spec exists) | general-purpose | sonnet | Default workhorse |
| Research (web docs, dependency behavior) | general-purpose | sonnet | Needs synthesis |
| Code review of a diff | Skill `/code-review` | (skill-managed) | Purpose-built; don't hand-roll |
| Design an implementation plan | Plan | sonnet | Upgrade to opus if cross-cutting (>2 subprojects or schema+API+UI) |
| Debugging after sonnet failed twice | general-purpose | opus | Escalation path below |
| Security-sensitive change (auth, RBAC, SQL, payments/ledger math) | general-purpose | opus | Cost of a miss is high |
| Adversarial second opinion on a risky judgment | general-purpose (fresh) | opus | Independent context is the point |

## The three required elements of every delegation

Every Agent prompt MUST contain, explicitly labeled:
1. **Goal and motivation** — what to produce and why it matters (so the agent can
   make sane micro-decisions).
2. **Acceptance criteria** — a checkable list. "Done" must be decidable by a machine
   or a read-back, e.g. "`cargo check --all-features` exits 0", "file exists at path P
   with sections A,B,C", not "code is clean".
3. **Report format** — max length and structure of the final message.

Templates for each task type: `.claude/refs/delegation-templates.md`. Use them.

## Reporting contract (put this in every delegation prompt)

Subagents return CONCLUSIONS and `file:line` references only. Anything long
(logs, scan results, drafts, diffs) gets written to a file — repo-facing content
under `.claude/reports/` or `.claude/refs/`, throwaway output in the session
scratchpad — and only the path comes back. Final message ≤15 lines unless the
template says otherwise. If a subagent replies with a wall of text, that is a
failed delegation prompt; fix the prompt, not the agent.

## Upgrade / downgrade path

- haiku fails once → retry the SAME subtask on sonnet. Do not re-prompt haiku.
- sonnet fails the same subtask twice → escalate to opus, and include the FULL
  failure trace (both attempts' prompts, outputs, and error evidence) in the opus
  prompt. Escalation without the trace wastes the upgrade.
- Once opus (or you) has cracked the pattern, write the pattern as an exact spec
  and downgrade back to haiku/sonnet for batch application.
- Hard cap: two retry rounds per model per subtask. After that, stop and either
  change approach (see `judgment-rubrics.md` → wrong-direction signals) or ask the user.
- Log every escalation in `.claude/rules/lessons.md` (format in `maintenance.md`).

## Validation is never self-validation

The agent (or commander) that produced work does not certify it. Minimum bars:
- **Files written** → a FRESH general-purpose (haiku) agent reads them back and checks
  against the acceptance criteria verbatim.
- **Code changes** → actual execution: backend `cargo check --all-features` (and
  `cargo clippy --all-features -- -D warnings` before claiming CI-ready);
  frontend `npm run typecheck && npm run lint && npm run test`. Compiler/tests are
  the fresh context.
- **High-risk judgment** (schema design, money math, auth changes) → second opinion
  from a fresh opus agent, or generate 2–3 candidate answers and have a fresh agent
  judge them against written criteria. If opinions conflict and you cannot resolve
  from evidence, stop and ask the user — say plainly that this is a taste/ambiguity
  case that decomposition cannot solve.
