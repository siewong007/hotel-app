# Repository reliability implementation plan

**Goal:** Deliver the four source-review improvements approved in this chat.
**Architecture:** Keep ledger accounting in its repository. Serialize imports with a PostgreSQL advisory lock held for the entire job. Separate deployed runtime privileges from administrative setup only after exercising the import path with restricted privileges. Align local full-validation commands with CI.
**Constraints:** Preserve routes and response shapes; no new dependencies; no production operations; use scratch PostgreSQL databases for tests; preserve other sessions' changes. Optional durable job-status storage is deferred: it needs schema and restart-recovery semantics beyond admission control.

## Tasks
- [x] Ledger: reproduce the existing ignored reversal regression against live PostgreSQL; inspect credit/debit and payment semantics; fix totals without inventing cash; enable regression and run ledger suites.
- [x] Imports: prove overlapping distinct uploads are rejected across independent database connections; acquire a database-wide import lock before registration/parse work and retain it through completion, including error/cancellation cleanup; preserve same-upload guard and test release/retry.
- [x] Privileges: trace runtime DDL and deployment credential provisioning; use the smallest compatible privilege split, test ordinary API DML and backup import with a restricted role, and update deployment/runbook safely. Do not swap credentials until compatibility is proven.
- [x] Local gates: require DATABASE_URL before full backend/all tests start; retain an explicitly named database-free path; make lint-all use lint:strict; verify missing-DB failure and command routing.
- [x] Integration: independent review, targeted live-PG tests, cargo check/fmt/clippy, affected script checks, documentation links; record exact limitations.

## Validation record
Local gates: /tmp/hotel-check-make-gates.py failed against the original Makefile and passed after the change (missing/blank DATABASE_URL, parallel launch ordering, valid URL, library-only target, strict lint routing). Actual `make lint-fe` passed. Documentation link check passed. Ledger/import live regression failures reproduced; implementations and privilege compatibility tests in progress.

2026-10-11 resume: original implementation workers were interrupted by usage limits. Lower-cost agents finish import/privilege work. Ledger source review found no actionable issue; 26 live ledger tests passed before interruption. Import first resumed run exposed missing scratch-DB helper functions; helpers installed and rerun pending. Privilege review identified nested search-path risk; new maintenance helper now owns a pinned-search-path body rather than calling the old function. Live restricted-role validation pending.

Import validation: all-features backup_v1 15/15 (24.09s), import 10/10 (1.08s), source review found no lock-lifetime issue. Dedicated lock session also owns mutation transaction; normal completion closes before terminal status. Panic registry recovery remains a documented preexisting limitation. Backend cargo check passes; two clippy needless-borrow findings fixed, rerun pending. Restricted-role SQL suite passed; real Rust runtime-role import and catalog/mirror verification still pending.

2026-10-12 final privilege verification: deploy/tests/run-runtime-privileges.sh exit 0 against disposable PostgreSQL, including noninteractive runtime password provisioning, denied administrative access and temporary-object shadow checks, 10 import tests and 13 backup tests; two tests requiring administrative fixture DDL remain covered by the full administrative suite. Patch 0017 SHA-256 38842afdb10bbaee1fc1fa55eadfafdeda98d897f98290522682db35f94232c5 is recorded in the scratch database; backend/desktop mirror check passes. Deployment scripts and documentation are ready, but no production/staging deployment was performed.

Final backend gates: cargo fmt --check, cargo check --all-features, and cargo clippy --all-features -- -D warnings exit 0. Full cargo test --all-features with scratch DATABASE_URL exit 0: 970 passed, zero failed/ignored across 65 result summaries (~2m16s test process). Initial schema comparison omitted catalog replay on the fresh DB; canonical fresh lifecycle is baseline→seed→patches, so final comparison uses that lifecycle on both paths.

Final convergence: current baseline+seed+all catalog patches and pre-change baseline+seed+all patches produce identical pg_dump schemas after excluding only random session restrict tokens; report-schema-drift.sh exit 0. Documentation links, shell syntax, Make gate behavior, and desktop mirrors pass. Changes remain uncommitted on codex/repo-reliability in the attached worktree; no production/staging operations or credential rotation performed.
