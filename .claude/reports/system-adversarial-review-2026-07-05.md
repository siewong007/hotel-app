# Adversarial Review — .claude agent OS (2026-07-05)

Reviewer: fresh-context general-purpose (opus). Scope: CLAUDE.md, .claude/rules/*.md,
.claude/refs/*.md. Only doc accuracy vs repo + internal consistency reviewed — not app code.

Verdict: **PASS-with-nits**

## 1. Conflicting rules

- **should-fix — judgment-rubrics.md:56 vs model-dispatch.md:79.** Rubric #3 says
  "Retry budget exhausted (2 rounds, 2 models)"; model-dispatch says "Hard cap: two
  retry rounds **per model** per subtask." A haiku reader could take "(2 rounds, 2
  models)" as a global cap of 2 attempts total, contradicting the per-model reading.
  Fix: change rubric #3 to "(2 retry rounds per model, across ≤2 models — see
  model-dispatch.md escalation path)".
- No other contradictions found. Checked: who-may-edit lists (maintenance.md:7 append-only
  lessons vs :20 ask-first CLAUDE.md — consistent, both allow stale-path fixes freely);
  escalation counts (haiku→sonnet once, sonnet→opus after 2 — consistent across files);
  line budgets vs auto-load (CLAUDE.md:5 and letter:71-76 both flag auto-load; consistent).

## 2. Wrong paths / commands / tool names

- **should-fix — ledger-workflow.md:22.** Claims the SQLite partial unique index
  `uq_customer_ledgers_booking_room_charge` is in "SQLite: migration 013". There is NO
  migration 013 (only 001–011 exist); the index actually lives in
  `hotel-app-be/database/sqlite_migrations/005_customer_ledgers_schema_sync.sql`. An agent
  syncing schema would hunt for a nonexistent file. Fix: change "migration 013" to
  "migration 005 (005_customer_ledgers_schema_sync.sql)".
- **nit — CLAUDE.md:117-118 / hotel-app-be/README.md.** Both reference
  `hotel-app-be/mcp-server/` (analytics-server, hotel-search-server). README references it
  but the directory does NOT exist on disk (`find` returns nothing). CLAUDE.md accurately
  reports README, but the underlying dir is absent — the note may mislead an agent looking
  for it. Fix: note "referenced in README but not present in the repo" or drop the path.
- Verified present (OK): routes/mod.rs, core/{auth,middleware,db,rate_limiter,sql_compat,
  rbac_cache}.rs, services/audit.rs, utils/{sanitization,validation}.rs, database/
  {schema.sql,data.sql,sqlite_migrations/}, hotel-web-fe/src/{api/client.ts,utils/storage.ts,
  utils/date.ts,auth/AuthContext.tsx,desktop/runtimeApi.ts,types/}, vite.config.ts,
  src/bin/{hash_password,fix_password}.rs, AGENTS.md, CONTRIBUTING.md, docs/guides/
  deployment.md, docs/architecture/ADRS.md, hotel-desktop/{BUILD_SPEED.md,UPDATER.md,
  src-tauri/{pgsql,src/postgres.rs,commands.rs}}, .env.example.
- Verified commands/scripts (OK): FE `start/test/typecheck/lint/build` all exist; desktop
  `dev/build/build:no-bundle/desktop:prepare:force` all exist; `cargo run --bin hash_password`
  bin exists.
- Verified CI claims (OK): `desktop` job "Desktop — Cargo Check" (ci.yml:217) DOES exist and
  stages `/dev/null` placeholders (ci.yml:245-254) then runs plain `cargo check` — the
  architecture-enhancements.md:17 and letter:29-33 claims are ACCURATE. Backend jobs run
  `cargo check/clippy/build --all-features -D warnings` + dual-DB tests + schema smoke as
  described. FE CI runs `npm run test -- --run` (CLAUDE.md:51 lists `npm run test`, which =
  `vitest run` — equivalent, not a defect).

## 3. Model names / tool schema

- model-dispatch.md:8-13 claims Agent `model` accepts `haiku/sonnet/opus/fable`. This IS
  independently verifiable from the Agent tool schema available to me, whose `model` enum is
  `sonnet, opus, haiku, fable` — MATCHES. The specific model-id mappings
  (claude-haiku-4-5-20251001 / claude-sonnet-5 / claude-opus-4-8 / claude-fable-5) are NOT
  independently verifiable from tool schemas; treat as author-asserted (the file itself flags
  "verified 2026-07-05, re-verify if >6 months old" — acceptable hedge).
- "Agent tool has NO effort parameter" (:15) — confirmed: the Agent tool schema exposes no
  effort field. Correct.
- **nit — model-dispatch.md:20-22** lists subagent types general-purpose/Explore/Plan/claude/
  claude-code-guide but omits `statusline-setup` (present in this environment). Minor; that
  type is a config helper, not routing-relevant. Fix: optional, add a parenthetical.

## 4. Ambiguous wording

- **nit — judgment-rubrics.md:56** "(2 rounds, 2 models)" — see finding 1; ambiguous count.
- **nit — model-dispatch.md:24 / letter:70** "safety-routed Opus 4.8 requests consume the
  session's quota" is explicitly marked Unconfirmed in both — correctly hedged, no fix needed.
- No other misreadable instructions found that would cause a smaller model to act wrongly.

## 5. Internal cross-references

- All `see X.md` targets exist: 00-diagnosis.md, model-dispatch.md, judgment-rubrics.md,
  delegation-templates.md, lessons.md, maintenance.md all present in .claude/rules/.
- All numbered refs resolve: "rubric #1/#3" (judgment-rubrics has 1–5), "Leak #1/#2/#3"
  (00-diagnosis has exactly 3), "templates #5"/"delegation-templates #5" (has 1–5),
  "item #5/#6" (architecture-enhancements has 8), "judgment-rubrics #3" (exists). No dangling
  cross-references.

## 6. Line budgets

- CLAUDE.md: **118 lines** — within ≤150 budget. PASS.
- .claude/rules/*.md total: **469 lines** (00-diagnosis 68, delegation-templates 104,
  judgment-rubrics 104, lessons 29, maintenance 68, model-dispatch 96). Under the
  always-loaded ≤500-line budget (maintenance.md line budgets). PASS, but only 31 lines of
  headroom — worth noting for future edits.

## Summary of actionable findings
- should-fix: ledger-workflow.md:22 "migration 013" → 005 (wrong/nonexistent path).
- should-fix: judgment-rubrics.md:56 retry-count wording vs model-dispatch.md:79.
- nits: CLAUDE.md:117 mcp-server dir absent on disk; model-dispatch.md:20 omits
  statusline-setup; rules total at 469/500 (low headroom).
