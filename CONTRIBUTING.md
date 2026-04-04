# Contributing to Hotel Management System

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create a branch** for your feature or fix

```bash
git clone https://github.com/<your-username>/hotel-app.git
cd hotel-app
git checkout -b feature/your-feature-name
```

## Development Setup

### Prerequisites

- Rust (2021 edition) with `cargo`
- Node.js 18+ with `npm`
- PostgreSQL 14+ (or use SQLite for local development)

### Backend

```bash
cd hotel-app-be
cp .env.example .env
# Edit .env with your local database credentials
cargo run
```

### Frontend

```bash
cd hotel-web-fe
npm install
npm run dev
```

### Desktop

```bash
cd hotel-desktop
npm install
npm run tauri dev
```

## Project Architecture

| Directory | Description |
|-----------|-------------|
| `hotel-app-be/` | Rust backend (Axum, SQLx, Tokio) |
| `hotel-web-fe/` | React frontend (TypeScript, Vite, MUI) |
| `hotel-desktop/` | Tauri desktop wrapper |

### Backend Structure

- `src/core/` - Auth, database, middleware, rate limiting
- `src/handlers/` - Request handlers (one file per domain)
- `src/models/` - Data models and request/response types
- `src/routes/` - Route definitions and request validation
- `src/services/` - Business logic (audit logging, etc.)
- `src/utils/` - Input sanitization, helpers
- `database/migrations/` - PostgreSQL migration files
- `database/seed-data/` - Initial seed data

### Frontend Structure

- `src/api/` - API service layer (one service per domain)
- `src/auth/` - Authentication context and providers
- `src/features/` - Feature modules (bookings, rooms, guests, etc.)
- `src/hooks/` - Custom React hooks
- `src/types/` - TypeScript type definitions

## Code Guidelines

### Backend (Rust)

- Use parameterized queries for all database operations (never interpolate user input)
- Apply input sanitization using `crate::utils::sanitization::Sanitizer` for user-provided text
- Add authentication guards (`require_auth`) to all protected routes
- Support both PostgreSQL and SQLite via `#[cfg(feature = ...)]` where needed
- Use transactions for multi-step database operations
- Return generic error messages to clients; log details server-side

### Frontend (TypeScript/React)

- Use the centralized `api` client from `src/api/client.ts` for all API calls (never use raw `fetch()`)
- Use the `storage` utility for localStorage access (not direct `localStorage.getItem()`)
- Define types in `src/types/` for all API request/response shapes
- Use MUI components for UI consistency

### General

- Write clear commit messages describing the "why", not just the "what"
- Keep PRs focused on a single concern
- Test your changes against both PostgreSQL and SQLite when modifying backend queries

## Submitting Changes

1. **Commit** your changes with a descriptive message
2. **Push** to your fork
3. **Open a Pull Request** against `master`

```bash
git add .
git commit -m "feat: description of your change"
git push origin feature/your-feature-name
```

### PR Guidelines

- Provide a clear summary of what changed and why
- Include steps to test your changes
- Ensure the backend compiles cleanly (`cargo check`)
- Ensure the frontend builds without errors (`npx tsc --noEmit`)

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include steps to reproduce for bugs
- Include your environment details (OS, Rust version, Node version, database)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
