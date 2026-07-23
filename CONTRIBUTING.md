# Contributing to Hotel App

Thank you for your interest in contributing to the Hotel Management System! This document provides guidelines and instructions for contributing.

## Table of Contents
1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Project Structure](#project-structure)
5. [Coding Standards](#coding-standards)
6. [Testing Guidelines](#testing-guidelines)
7. [Pull Request Process](#pull-request-process)
8. [Commit Conventions](#commit-conventions)
9. [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior.

## Getting Started

### Initial Setup

See [README.md](README.md#quick-start) for installation instructions and `hotel-app-be/.env.example` for environment configuration.

### Development Commands

Quick reference for common tasks:

```bash
# Start backend (PostgreSQL)
make dev-be


# Start frontend
make dev-fe

# Typecheck all projects
make check-all

# Run all tests
make test-all

# Lint all projects
make lint-all

# Start full stack with Docker
make docker-up
```

## Development Workflow

### Branch Strategy

- `master` — stable, production-ready code
- `feature/<name>` — new features
- `fix/<name>` — bug fixes
- `refactor/<name>` — code restructuring
- `docs/<name>` — documentation changes

### Workflow

1. Create a branch from `master`
2. Make your changes
3. Run the verification commands for your project:
   ```bash
   # Backend
   cd hotel-app-be
   cargo fmt
   cargo check --all-features
   cargo clippy --all-features -- -D warnings
   cargo test --all-features

   # Frontend
   cd hotel-web-fe
   bun run typecheck
   bun run lint
   bun run test -- --run
   bun run build
   ```
4. Submit a pull request

## Project Structure

Project layout: see [README.md](README.md#project-structure) for the monorepo structure and module descriptions.
## Coding Standards

### Backend (Rust)

- **Formatting:** Use `cargo fmt` before committing
- **Linting:** Ensure `cargo clippy --all-features -- -D warnings` passes
- **Naming:**
  - Files and modules: `snake_case`
  - Functions and variables: `snake_case`
  - Types, structs, enums, traits: `PascalCase`
  - Constants: `SCREAMING_SNAKE_CASE`
- **Architecture:** Follow the layered pattern:
  `routes/` → `handlers/` → `services/` → `repositories/` → `models/`
- **SQL:** Always parameterize SQL queries. Never interpolate user input.
  Use PostgreSQL `$N` placeholders or the existing `param!(N)` helper.
- **Sanitization:** Apply `Sanitizer` from `utils/sanitization.rs` to free-text user input.
- **Errors:** Return generic error messages to clients; log specifics server-side.
- **Transactions:** Use transactions for multi-step mutations.

### Frontend (TypeScript/React)

- **TypeScript:** Prefer strict types; check with `bun run typecheck`
- **Naming:**
  - Components: `PascalCase` file and export names
  - Hooks: `useX` names in `useX.ts` files
  - Services: `<Domain>Service` in `<domain>.service.ts`
  - Event handlers: `handleX`
  - Boolean props/state: `isX`, `hasX`, `canX`, `shouldX`
- **API calls:** Always use `src/api/client.ts` (never `fetch` directly)
- **Storage:** Always use `src/utils/storage.ts` for localStorage access
- **State management:**
  - Server state: TanStack Query
  - Client state: Zustand
- **UI:** Prefer MUI components and existing shared components

### Desktop (Rust/Tauri)

- **Formatting:** Use `cargo fmt`
- **Commands:** Keep Tauri commands thin; delegate to backend modules
- **Resources:** Use sync scripts to keep desktop resources aligned with backend

## Testing Guidelines

### Backend Tests

- **Unit tests:** Pure logic tests without database
  - Place in the same file as the code being tested (inline `#[cfg(test)]`)
  - Or in separate test modules under `tests/`
- **Integration tests:** Database-backed tests
  - PostgreSQL tests: `cargo test --features postgres --no-default-features`
- **What to test:**
  - Pure business logic and calculations
  - SQL query builders and PostgreSQL helpers
  - Date, money, status, permission, and validation logic
  - Booking state transitions, payments, ledgers, night audit

### Frontend Tests

- **Framework:** Vitest with Testing Library
- **Component tests:** `*.test.tsx` with `@vitest-environment jsdom`
- **Pure utility tests:** `*.test.ts` (no DOM needed)
- **What to test:**
  - Utility functions (date formatting, currency, validation)
  - Component rendering and user interactions
  - Hook behavior and state management
  - API service functions (mock HTTP)

### Running Tests

```bash
# All tests
make test-all

# Backend
make test-be
make test-be-pg     # Requires PostgreSQL

# Frontend
make test-fe
```

## Pull Request Process

1. **Before submitting, verify:**
   - [ ] Code compiles without warnings
   - [ ] Linting passes (`clippy` for Rust, `eslint` for frontend)
   - [ ] All existing tests pass
   - [ ] New tests cover your changes
   - [ ] Formatting is applied (`cargo fmt`, Prettier for frontend)
   - [ ] Documentation is updated (README, inline docs, ADRs)
   - [ ] No unnecessary dependencies added

2. **Create a focused PR:**
   - Keep changes focused on a single concern
   - Do not combine refactoring with feature changes
   - Reference related issues

3. **PR description should include:**
   - What this PR does
   - Why this change is needed
   - How it was tested
   - Screenshots for UI changes (if applicable)
   - Any migration or deployment notes

4. **Review process:**
   - At least one approval required
   - All CI checks must pass
   - Address all review comments

## Commit Conventions

Use conventional commit messages:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code restructuring
- `test` — Adding or updating tests
- `docs` — Documentation changes
- `chore` — Maintenance, dependencies, tooling
- `ci` — CI configuration changes
- `style` — Formatting, styling (no code change)
- `perf` — Performance improvement

**Scopes (examples):**
- `backend`, `frontend`, `desktop`
- `auth`, `bookings`, `rooms`, `ledgers`, `payments`
- `ci`, `docs`, `deps`

**Examples:**
```
feat(bookings): add check-in workflow for group bookings
fix(auth): handle expired JWT token gracefully
refactor(backend): extract room repository from handler
test(frontend): add currency utility tests
docs: update deployment guide with Docker Compose
```

## Documentation

- **README.md** — Project overview, features, installation
- **docs/architecture/architecture-flow.md** — One-page system flow
- **docs/guides/deployment.md** — Deployment guide
- **docs/architecture/ADRS.md** — Architecture Decision Records
- **Inline documentation** — Rust docstrings (`///`) and TypeScript JSDoc

When adding a new feature (in your commits):
1. Update `README.md` with the feature description
2. Add API endpoint documentation if applicable
3. Update or add Architecture Decision Records for significant decisions
4. Add inline documentation for new functions and types
