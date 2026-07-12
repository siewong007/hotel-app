# Enhancement Backlog — 2026-07-07

Synthesized from two scan reports (`.claude/reports/scan-backend-2026-07-07.md`,
`.claude/reports/scan-frontend-2026-07-07.md`) plus the two prior refs:
`architecture-enhancements.md` (desktop/packaging, 2026-07-05 — items there NOT
repeated here) and `security-audit-2026-07-06.md` (security — done, not repeated).
Line anchors rot — verify with Grep before relying on them. Suggested dispatch
follows `.claude/rules/model-dispatch.md`.

## P0 — correctness / money / auth exposure

1. **Add tests for the auth session flow and invoice numbering (zero coverage today).**
   `handlers/auth.rs`, `services/auth.rs`, `repositories/auth.rs`, and
   `repositories/invoice_numbers.rs` have no `#[test]` at all — login, JWT
   validation, refresh-cookie rotation, and invoice-number generation are the
   two places rubric #5 flags ("who loses money or access?"). First step: tests
   for invoice_numbers (pure logic, easy win), then an integration test hitting
   login→refresh→logout against a scratch SQLite DB (pattern: the 2026-07-07
   guest-portal smoke test in lessons.md). Effort M. Dispatch: sonnet;
   opus review if auth behavior must change to become testable.

2. **Fix the N+1 on `GET /bookings`.** `repositories/bookings/lifecycle.rs:892`
   → `services/auto_checkin.rs:71-89` runs an eKYC-summary query per booking —
   up to 500 queries per page. Batch it (one `WHERE booking_id IN (...)` query,
   or a JOIN in the list query). Acceptance: list endpoint issues O(1) eKYC
   queries (verify by counting queries in a log run), both DBs compile
   (`cargo check --all-features`). Effort M, Risk med. Dispatch: sonnet
   (touches bookings — walk 00-diagnosis Leak #2 checklist).

3. **Audit `services/rooms.rs` inline SQL for dual-DB divergence.** It holds 83
   of the 84 service-layer `sqlx::query` calls, none through `sql_query!` — the
   exact class the 2026-07-07 lesson says static checks can't catch. First step
   is an AUDIT ONLY (S): grep every column it references against both
   `database/schema.sql` and `database/sqlite_schema.sql` DDL; file findings before any
   refactor. Full migration to repositories + sql_compat is L and only worth it
   if the audit finds divergence or the file needs feature work. Dispatch:
   audit = haiku with exact spec; refactor = sonnet.

## P1 — guardrails (stop the debt growing)

4. **Harden CI.** `.github/workflows/ci.yml:34` runs `eslint . --quiet` (errors
   only) while `lint:strict --max-warnings=0` exists in package.json unused —
   warnings accumulate silently. Also missing: vitest coverage threshold
   (coverage block in vitest.config.ts is unenforced), any bundle-size check,
   any dependency audit. Do in order: (a) switch CI to lint:strict, fixing
   whatever warnings exist today; (b) add a low coverage floor and ratchet it.
   CI file is ASK-FIRST per maintenance.md — get user approval, back up first.
   Effort S–M. Dispatch: sonnet.

5. **Eliminate runtime `SELECT *`** at `repositories/bookings/lifecycle.rs:1406,
   1967, 3842, 4173` (create/update/checkin/reactivate paths) plus payment/rate/
   loyalty repos. None mismatched today, but this is the pattern that produced
   the guests.is_active runtime break (lessons.md 2026-07-07). Mechanical:
   replace with explicit column lists matching the struct. Acceptance: no
   `SELECT *` in src/ outside tests; `cargo check --all-features` passes; smoke
   one touched endpoint on scratch SQLite. Effort M, Risk low. Dispatch: haiku
   with exact per-site spec, sonnet on first failure.

6. **Characterization tests for the two money-critical page monoliths.**
   `BookingsPage.tsx` (2,586 lines) and `CustomerLedgerPage.tsx` (2,265 lines)
   have zero tests. Do NOT refactor first — add render + core-interaction
   vitest coverage, then split incrementally in later sessions. Effort L
   (tests M, decomposition L). Dispatch: sonnet.

## P2 — strategic / quality-of-life

7. **`any`-type burn-down, top-5 files first.** 537 `any` sites total, ~40% in
   5 files led by `src/types/dataTransfer.types.ts` (51). Typing those five
   yields the most safety per hour given `strict:false`. Effort M. Dispatch:
   haiku per-file with exact spec.

8. **Desktop session persistence (revisit an accepted limitation).** Desktop
   users re-login after every restart because the SameSite=Strict refresh
   cookie can't cross the tauri://localhost → 127.0.0.1 origin boundary
   (security-audit-2026-07-06.md). Options already scoped there: Tauri
   OS-keychain plugin, or a desktop-only refresh transport. BUSINESS decision
   first — ask the user whether re-login friction is worth solving. Effort M,
   Risk med (auth — opus + fresh review per dispatch rules).

9. **Carry-over desktop items** (tracked in architecture-enhancements.md, still
   open as of 2026-07-05): prove `desktop-build.yml` with a real run; sqlite
   feature keep-or-kill (user decision); arm-or-hide the updater; git history
   reclaim of the once-committed 16MB sidecar (user decision, filter-repo).

## Explicitly clean (scanned 2026-07-07 — don't re-scan)

- Recent commits `dcedf726`/`59c1e078` re-checked against the column-divergence
  bug class: clean; migration 014 committed and matches schema.sql.
- FE: zero TODO/FIXME/HACK, zero `@ts-ignore`/`@ts-expect-error`, no raw
  `fetch(`, no date-helper violations.
- BE: 97 unwrap/expect sites spot-checked (5/5 safe) — full audit not done.
- Unverified: whether `src/api/index.ts` barrel bloats the initial bundle
  (needs a real bundle-analyzer run); N+1s inside ledger/analytics repos
  (files too large for the scan budget).
