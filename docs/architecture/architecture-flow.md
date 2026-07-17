# Architecture Flow

One-page system flow. Decisions and rationale live in [ADRS.md](ADRS.md); deploy
steps in [../guides/deployment.md](../guides/deployment.md).

## Request flow (web)

```
Browser (React 19 / MUI / TanStack Router+Query)
  └─ src/api/client.ts (ky; bearer token, 401 → auth:unauthorized)
      └─ dev: Vite proxy :3000 → 127.0.0.1:3030   prod: Caddy → backend
          └─ routes/mod.rs::create_router (CORS, rate limits, security headers)
              └─ require_auth → check_permission("<resource>:<action>")
                  └─ handlers/<domain>.rs
                      ├─ services/ (business logic, audit.rs on every mutation)
                      └─ repositories/ or inline SQL (sql_query!/param! dual-DB)
                          └─ PostgreSQL 19 (prod/docker) | SQLite (lightweight/CI)
```

## Desktop flow (Tauri 2)

```
Tauri webview (tauri://localhost)
  └─ IPC: commands.rs get_status / backend-ready event → src/desktop/runtimeApi.ts
      └─ backend sidecar, 127.0.0.1 on first free port ≥ BACKEND_PORT
          └─ embedded PostgreSQL (src-tauri/pgsql/)
```

- `HOTEL_DESKTOP_MODE` set; `ALLOWED_ORIGINS` is a specific list, never `*`.
- Cookies are cross-site here (tauri:// → 127.0.0.1): SameSite=Strict means no
  session restore after restart — accepted trade-off (2026-07-06).

## Data lifecycle (V1)

New empty database → `postgres/migrations/0001_v1_baseline.sql` → `data.sql` →
`seed.sql`, applied exactly once (Docker, desktop, and `make db-setup` all use
this order). SQLite embeds the equivalent V1 resources. Existing V1 databases are
verified and left unchanged at startup. Canonical lifecycle doc:
[hotel-app-be/database/README.md](../../hotel-app-be/database/README.md).

## Deployment topology (docker compose)

```
Caddy (HTTPS) ── static frontend build
     └── /api → hotel-app-be (Axum, :3030) ── postgres:19beta2 volume
```

## Wiring points that bite (checklist in .claude/rules/00-diagnosis.md)

- New router → `.merge()` in `routes/mod.rs` or it 404s.
- New top-level API prefix → add to `hotel-web-fe/vite.config.ts` proxy list.
- New page → `src/routes/*.tsx` AND `src/navigation/routeRegistry.tsx`.
- SQL → dual-DB (`sql_query!`, `param!`, both `database/postgres/` and
  `database/sqlite/` resources); verify with `cargo check --all-features` AND
  `--features sqlite --no-default-features`.
