# Contributing to Hotel app

Thank you for your interest in contributing. This repository is organized as a three-project monorepo, so contributions should stay focused on the project area they affect.

## Repository Layout

| Directory | Purpose |
| --- | --- |
| `hotel-app-be/` | Rust backend API using Axum and SQLx. |
| `hotel-web-fe/` | React, TypeScript, Vite, and MUI frontend. |
| `hotel-desktop/` | Tauri desktop wrapper and bundled service resources. |

There is no root-level package manager workspace. Run commands from the relevant subdirectory.

## Getting Started

1. Fork the repository.
2. Clone your fork.
3. Create a focused branch.
4. Make a small, reviewable change.
5. Run the relevant checks before opening a pull request.

```bash
git clone https://github.com/<your-username>/hotel-app.git
cd hotel-app
git checkout -b feature/short-description
```

## Development Setup

### Backend

```bash
cd hotel-app-be
cp .env.example .env
sqlx migrate run
cargo run
```

For SQLite mode:

```bash
cd hotel-app-be
DATABASE_PATH=./hotel_data.db JWT_SECRET=change_me_to_a_32_character_secret cargo run --features sqlite --no-default-features
```

### Frontend

```bash
cd hotel-web-fe
npm install
npm run start
```

### Desktop

```bash
cd hotel-desktop
npm install
npm run desktop:prepare
npm run dev
```

## Coding Guidelines

### General

- Keep pull requests focused on one concern.
- Preserve existing route paths, response shapes, permissions, local storage keys, and database meanings unless the change explicitly fixes a documented issue.
- Do not commit real secrets, local `.env` files, generated logs, local databases, or build artifacts.
- Prefer existing libraries and project patterns before adding dependencies.
- Document intentional behavior changes in the pull request.

### Backend

- Keep route modules focused on route registration, guards, and extraction wiring.
- Keep handlers thin; place business rules in services and SQL in repositories where practical.
- Use parameterized SQL. Never interpolate user input into SQL strings.
- Use existing sanitization and validation helpers for user-provided text.
- Use transactions for multi-step mutations.
- Keep PostgreSQL and SQLite behavior aligned when touching database-sensitive code.
- Add focused tests for business logic, validation, permissions, payments, ledgers, night audit, and database helpers when relevant.

### Frontend

- Use the centralized API client in `hotel-web-fe/src/api/client.ts`.
- Do not call `fetch` directly for backend API requests.
- Use `hotel-web-fe/src/utils/storage.ts` for local storage access.
- Prefer MUI and existing shared components for UI consistency.
- Keep route-level components, feature components, hooks, and API services separated by responsibility.

### Desktop

- Keep Tauri commands UI-facing.
- Keep backend sidecar lifecycle code separate from PostgreSQL lifecycle code when adding new behavior.
- When changing desktop database resources, verify the backend resource source and the sync script.

## Validation Commands

Run the checks that match your change.

### Backend

```bash
cd hotel-app-be
cargo fmt
cargo check --all-features
cargo clippy --all-features -- -D warnings
cargo test
```

For SQLite-specific changes:

```bash
cd hotel-app-be
cargo check --features sqlite --no-default-features
```

### Frontend

```bash
cd hotel-web-fe
npx tsc --noEmit
npm run build
```

### Desktop

```bash
cd hotel-desktop/src-tauri
cargo fmt
cargo check
```

For desktop packaging/resource changes:

```bash
cd hotel-desktop
npm run sync:resources
npm run desktop:prepare
```

If you cannot run a command because of local tooling, sandboxing, or network limits, note that clearly in the pull request.

## Commit Messages

Use concise, descriptive commit messages. Conventional prefixes are welcome but not required.

Examples:

```text
feat: add booking timeline filters
fix: prevent duplicate ledger reversal
docs: improve desktop setup instructions
test: cover room availability search
```

## Pull Request Checklist

Before opening a pull request:

- Confirm the change is focused and reviewable.
- Update documentation if setup, API behavior, or user-visible workflows changed.
- Add or update tests when the change affects business logic or database behavior.
- Run the relevant validation commands.
- Ensure no secrets or local generated files are included.

## Reporting Issues

When opening an issue, include:

- A clear summary.
- Steps to reproduce.
- Expected and actual behavior.
- Environment details such as OS, Node.js version, Rust version, database mode, and browser if relevant.
- Screenshots or logs when they help explain the problem.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
