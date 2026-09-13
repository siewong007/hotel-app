# Modernization Pass Implementation Plan

> **For agentic workers:** Executed inline by the architect agent on branch
> `modernization/2026-09-13`. Steps use checkbox syntax for tracking.

**Goal:** Remove legacy deps, bump justified versions, modernize tsconfig, and
rebuild documentation to describe the delivered system.

**Architecture:** Three independent sub-projects (no root workspace). FE bun,
BE cargo, desktop cargo+bun. All work validated by the repo's own gates:
`bun run typecheck && lint && test && build`, `cargo check/clippy/test`,
CI-equivalent desktop placeholder check.

**Tech Stack:** React 19 / TS 6 / Vite 8 / MUI 9 / TanStack Query+Router+Table,
Axum 0.8 / SQLx 0.8 / Tokio / PostgreSQL 19, Tauri 2.

## Global Constraints

- `bun` is the only JS package manager; `bun.lock` is the lockfile.
- Backend gates: `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`.
- FE gates: `bun run typecheck`, `bun run lint:strict`, `bun run test`, `bun run build`.
- Desktop check requires staged placeholder resources (see ci.yml desktop job).
- typescript-eslint caps TypeScript at `<6.1.0` — TypeScript stays on 6.x.
- Never touch the two dirty in-flight files (`promotions/repository.rs`,
  `tests/promotions_admin.rs`) or other sessions' untracked plans.
- No schema/SQL changes. No route/response-shape changes.
- A dependency is only removed after a repo-wide grep proves zero references.

## Audit findings driving the tasks

- FE unused deps: `ajv`, `@mui/lab`, `react-to-print`, `source-map-explorer`
  (pulls old `lodash`), `@types/babel__core` (no babel types referenced).
- FE misplaced: `@types/node`, `@types/react`, `@types/react-dom` in `dependencies`.
- FE overrides `fast-uri` + `lodash` exist only for the removed packages.
- FE majors behind: vitest 4→5, jsdom 29→30, web-vitals 4→6 (onFID removed →
  onINP), @tanstack/react-table 8→9 (hook rename + required `features`),
  @babel/core 7→8 (peer-allowed by @rolldown/plugin-babel), parser 8.65→8.70.
- Desktop Rust: `lazy_static` → `std::sync::LazyLock`; thiserror 1→2; rand
  0.8→0.10 (align with BE); sha2 0.10→0.11; dirs 5→7; windows 0.61→0.62;
  edition 2021→2024.
- Backend: `cargo update` for semver-compatible refresh; dirs 5→7. Evaluate
  jsonwebtoken 11, totp-rs 6, reqwest 0.13, constant_time_eq 0.6, sqlx 0.9
  against compile + (docker-backed) tests; keep what passes, document deferrals.
- Makefile `dev-be` runs bare `cargo run` — errors on multi-bin crate; fix to
  `cargo run --bin hotel-app-be`.
- Docs: no top-level ARCHITECTURE/FEATURES/DEVELOPMENT/API/DEPENDENCIES;
  `ongoing-dev.md` keeps RESOLVED entries its own header says to delete.

### Task 1: FE dependency cleanup

- [ ] Remove `ajv`, `@mui/lab`, `react-to-print`, `source-map-explorer`,
      `@types/babel__core`; move `@types/*` to devDependencies; drop
      `fast-uri` + `lodash` overrides
- [ ] `bun install`; grep-lockfile check the removed names are gone;
      `bun run typecheck && bun run lint:strict`

### Task 2: FE justified upgrades

- [ ] `bun add -d vitest@^5 @vitest/coverage-v8@^5 jsdom@^30 @typescript-eslint/parser@^8.70`
- [ ] `bun add web-vitals@^6.2.1`; update `src/reportWebVitals.ts` onFID→onINP
- [ ] `bun add @tanstack/react-table@^9`; migrate `DataTable.tsx` +
      `src/types/tanstack-table.d.ts` per v9 react migration guide
      (`useTable`/`useReactTable` rename, `features` option); revert to 8 if
      the table meta augmentation cannot be expressed
- [ ] `bun add -d @babel/core@^8` — keep only if `bun run build` passes
- [ ] Gates: typecheck, lint:strict, test, build

### Task 3: tsconfig modernization

- [ ] `target`/`lib` ES2020 → ES2024 (unblocks `.at()`, `findLast`,
      `Object.groupBy`; vite build.target is independent and stays ES2020/21)
- [ ] Enable strict flags that pass with ≤ ~15 trivial fixes each:
      candidates `noImplicitThis`, `strictBindCallApply`, `strictFunctionTypes`,
      `strictBuiltinIteratorReturn`, `useUnknownInCatchVariables`,
      `strictPropertyInitialization`, `noUnusedLocals`, `noUnusedParameters`,
      `verbatimModuleSyntax`. Measure per-flag error count; keep winners,
      document rejected flags in DEPENDENCIES.md
- [ ] `bun run typecheck` clean after each flag

### Task 4: Desktop Rust modernization

- [ ] Cargo.toml: edition 2024, thiserror 2, rand 0.10, sha2 0.11, dirs 7,
      windows 0.62, remove lazy_static
- [ ] `commands.rs`: `lazy_static!` → `std::sync::LazyLock`
- [ ] Stage CI placeholders; `cargo check`; `cargo clippy -- -D warnings`;
      `cargo fmt` on touched files
- [ ] `cargo update` semver-compatible refresh

### Task 5: Backend Rust modernization

- [ ] `cargo update`; bump `dirs` 5→7
- [ ] Try `constant_time_eq` 0.6, `reqwest` 0.13, `jsonwebtoken` 11,
      `totp-rs` 6, `sqlx` 0.9 — each only kept if `cargo check` clean AND
      relevant unit tests pass (docker postgres for DB-backed tests)
- [ ] Spin `docker compose up -d` postgres service; apply baseline+seed+patches
      via container psql; `DATABASE_URL=... cargo test --all-features`
- [ ] `cargo clippy --all-features -- -D warnings`; `cargo audit` if installed
- [ ] Fix Makefile `dev-be` → `cargo run --bin hotel-app-be`

### Task 6: Documentation reconstruction

- [ ] `docs/ARCHITECTURE.md` — canonical current-system doc (modules from
      `routes/mod.rs` + `src/features/`, entities from baseline, flows from
      architecture-flow.md)
- [ ] `docs/FEATURES.md` — feature registry w/ verified statuses
- [ ] `docs/DEPENDENCIES.md` — key deps, this pass's decisions, deferrals
- [ ] `docs/DEVELOPMENT.md` — verified commands only
- [ ] `docs/API.md` — conventions + domain map + openapi.json pointer
- [ ] Prune RESOLVED/CLOSED/SHIPPED entries from `docs/ongoing-dev.md`
- [ ] Update `README.md`, `CLAUDE.md` doc-map lines that drifted
- [ ] Sweep for stale refs to removed deps (ajv, mui/lab, react-to-print,
      lazy_static, web-vitals onFID)

### Task 7: Final validation + report

- [ ] Full gate suite; record PASS/FAIL honestly (pre-existing failures noted)
- [ ] `git diff` review; commits per logical unit
- [ ] Final modernization report in session output
