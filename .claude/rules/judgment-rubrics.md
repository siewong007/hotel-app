# Judgment Rubrics

High-level judgment converted into checklists a smaller model can execute.
Each rubric: criteria, one positive example, one negative example.
When a rubric and your instinct disagree, follow the rubric and note the
disagreement in `.claude/rules/lessons.md`.

## 1. When to upgrade the model (see also model-dispatch.md)

Upgrade when ANY of these is true:
- The task touches ≥2 of: SQL schema, auth/RBAC, money math (payments, ledgers,
  invoices, tax), booking state machine.
- You have failed the same subtask twice with different approaches.
- The fix requires holding >3 files' invariants in your head at once
  (e.g. bookings.rs + ledgers.rs + the V1 baseline SQL + a frontend page).
- You are about to write "probably" or "should work" about a correctness claim.

Do NOT upgrade for: volume (many files, mechanical pattern — that's a spec + haiku
batch job), or unfamiliarity you can resolve by reading one more file.

- ✅ Upgrade: "changing how `auto_post_company_ledger` computes `due_date` — this
  interacts with the partial unique index and booking-edit delta sync" → opus.
- ❌ Don't upgrade: "rename `folio_type` display label in 14 frontend files" →
  exact spec + haiku.

## 2. When something counts as truly complete

A task is complete ONLY when all of these hold:
1. The stated acceptance criteria pass, verified by execution or fresh read-back —
   not by re-reading your own diff.
2. Backend touched → `cargo check --all-features` passes (clippy for CI-ready).
   Frontend touched → `npm run typecheck && npm run lint && npm run test` pass.
3. Cross-cutting checklist from `00-diagnosis.md` Leak #3 walked item-by-item.
4. Schema touched → BOTH `database/postgres/` and `database/sqlite/` V1 resources updated (see `hotel-app-be/database/README.md`).
5. The user-visible summary states what was verified and HOW ("clippy clean, 42
   tests pass"), not "should be fine".

"It compiles" is not complete. "The subagent said it's done" is not complete.

- ✅ Complete: "Added endpoint; merged in routes/mod.rs; proxy entry added;
  clippy --all-features clean; vitest 3 new tests pass."
- ❌ Not complete: "Implemented the handler. The route registration should already
  pick it up." (Leak #3 item 1 unverified.)

## 3. When to stop and ask the user

Ask when ANY of these is true (and only these — otherwise proceed):
- Destructive or hard-to-reverse: deleting data/files you didn't create, force
  pushes, dropping columns, rewriting the V1 baseline SQL structure, changing
  `.github/workflows/ci.yml` semantics.
- Two legitimate designs with different business behavior (e.g. "should voiding a
  booking also void its city-ledger row?") — that is a hotel-operations decision,
  not a code decision.
- The request conflicts with a written rule in CLAUDE.md / these files.
- Money math or tax rules where the spec is ambiguous. Never guess financial policy.
- Retry budget exhausted (two retry rounds per model, having escalated through two
  models — see model-dispatch.md upgrade path) with no new information.

Do NOT ask for: which of two equivalent implementations to use, formatting,
whether to add a test (yes), or permission to run read-only commands.

- ✅ Ask: "Booking total changed after ledger partially paid — apply delta to
  `amount` or create an adjustment row? These produce different balances."
- ❌ Don't ask: "Should I use a match or if-let here?"

## 4. Wrong-direction signals — change approach instead of retrying

If you see any of these, STOP retrying the same approach:
- The fix keeps growing: attempt 2 touches more files than attempt 1, attempt 3 more still.
- You are adding special cases to survive tests rather than removing a wrong assumption.
- You are fighting the framework: hand-rolling what `sql_compat`, `core/db.rs`
  helpers, or the `api` client already provide.
- The same test fails for a *different* reason each attempt (your mental model is wrong).
- You are about to disable a lint, delete a test, or widen a type to make CI pass.

Required response: write down (one paragraph) what assumption all attempts shared,
then attack that assumption — usually by reading the code that *consumes* your
change rather than the code you're editing, or by escalating with the full trace.

- ✅ Change approach: "Both attempts assumed `daily_rates` always spans the stay;
  reading `update_booking_handler` shows it's rebuilt on date changes — patch there."
- ❌ Keep retrying: third attempt adds a `None` check on top of two previous `None` checks.

## 5. How to verify the quality floor

Before delivering ANY change, run this floor check (5 minutes, no judgment needed):
1. `git diff --stat` — does the change size match the task size? A 300-line diff for
   a one-line bug is a red flag; so is a 3-line diff for "implement feature".
2. Grep your diff for: `unwrap()` on Options that can be None in production,
   `println!`/`console.log` leftovers, literal `$1`/`?1`/`NOW()` in new SQL,
   `fetch(` in frontend code, `toISOString().split`.
3. Every new handler: `require_auth` present? `check_permission` string matches an
   existing `<resource>:<action>` pattern?
4. Run the narrowest real verification that exists: a named `cargo test <substring>`,
   a vitest file, or an actual curl against a dev server — not just compilation.
5. Ask: "if this is wrong, who loses money or access?" If the answer is anyone,
   apply rubric #1 (upgrade / second opinion) before shipping.

## Honesty clause (applies to every rubric)

Decomposition, validation, and multi-answer judging raise the floor; they do not
resolve vague requirements or taste. When you hit taste/ambiguity: (a) upgrade the
model, (b) get an external second opinion, or (c) tell the user plainly it's a
judgment call and present ≤2 options with a recommendation. Never manufacture
certainty. If a fact can be checked, check it; if it can't, write "unverified" next to it.
