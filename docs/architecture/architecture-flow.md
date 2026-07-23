# Architecture Flow

Decisions and rationale live in [ADRS.md](ADRS.md); deployment steps live in
[the deployment guide](../guides/deployment.md).

## Web request flow

```text
Browser (React / MUI / TanStack Router and Query)
  └─ src/api/client.ts (ky, bearer token, auth events)
      └─ Vite proxy in development or Caddy in production
          └─ Axum routes, CORS, rate limits, and security headers
              └─ authentication and permission checks
                  └─ handlers
                      └─ services
                          └─ repositories
                              └─ PostgreSQL
```

## Desktop flow

```text
Tauri webview
  └─ Tauri IPC and backend-ready event
      └─ backend sidecar on a dynamically selected localhost port
          └─ bundled PostgreSQL runtime and resources
```

Desktop mode sets `HOTEL_DESKTOP_MODE`. The webview obtains the selected backend
port through Tauri IPC. The sidecar receives an explicit `ALLOWED_ORIGINS` list.

## PostgreSQL V1 lifecycle

A new empty database is initialized exactly once:

```text
database/postgres/migrations/0001_v1_baseline.sql
  → database/postgres/data.sql
  → database/postgres/seed.sql
```

Docker, server, and desktop deployments share this sequence. Existing databases
are not automatically reinitialized. See the
[database lifecycle](../../hotel-app-be/database/README.md).

## Important wiring checks

- Merge every new backend router in `routes/mod.rs`.
- Add new top-level API prefixes to `hotel-web-fe/vite.config.ts`.
- Register new pages in both `src/routes/` and `src/navigation/routeRegistry.tsx`.
- Keep SQL parameterized and validate it against PostgreSQL.
