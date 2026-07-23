# Deployment Guide

This guide covers deploying the hotel management system in various environments.

## Table of Contents
1. [Quick Start (Docker Compose)](#quick-start-docker-compose)
2. [Oracle Cloud Always Free Development](#oracle-cloud-always-free-development)
3. [Production Deployment](#production-deployment)
4. [Desktop App Distribution](#desktop-app-distribution)
5. [Environment Configuration](#environment-configuration)
6. [Database Setup](#database-setup)
7. [Security Checklist](#security-checklist)
8. [Monitoring](#monitoring)
9. [Backup and Recovery](#backup-and-recovery)
10. [Troubleshooting](#troubleshooting)

---

## Quick Start (Docker Compose)

```bash
git clone https://github.com/siewong007/hotel-app.git
cd hotel-app
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and POSTGRES_PASSWORD
docker compose up -d
docker compose ps
curl http://localhost:3030/health
```

Available at: **Frontend** http://localhost:80, **Backend API** http://localhost:3030, **PostgreSQL** localhost:5432.

---

## Oracle Cloud Always Free Development

`infra/terraform/oci/environments/dev` provisions a low-cost dev environment
on one Oracle Ampere A1 Flex VM (2 OCPU / 12 GB defaults — check your tenancy
limits before raising either) running the existing Docker Compose stack, so
there is no paid managed PostgreSQL service. This is a development/preview
topology only: VM, database, and app share one failure domain; Always Free
capacity has no production SLA and can be unavailable or reclaimed; PostgreSQL
19 Beta 2 is not supported for production data.

Create an OCI Vault secret for each required application secret, then:

```bash
cd infra/terraform/oci/environments/dev
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform plan && terraform apply
```

Never commit OCI API keys, database passwords, JWT secrets, or Terraform
state — the directory includes an Object Storage backend example for teams
that need remote state.

Oracle references: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Terraform provider](https://docs.oracle.com/en-us/iaas/Content/dev/terraform/home.htm), and [Object Storage state](https://docs.oracle.com/en-us/iaas/Content/dev/terraform/object-storage-state.htm).

---

## Production Deployment

> **PostgreSQL 19 status:** the repository currently targets PostgreSQL 19
> Beta 2 for development. PostgreSQL identifies version 19 as a development
> release. Do not use this deployment path for production hotel data until 19
> reaches general availability and backup/restore plus load tests pass.

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 20 GB | 50+ GB (SSD) |
| PostgreSQL | 19 Beta 2 | 19 GA after validation |
| Reverse Proxy | — | Nginx or Caddy |
| TLS Certificate | — | Let's Encrypt |

### Architecture

An optional CDN and a TLS-terminating reverse proxy sit in front of the
backend and static frontend; the backend is the only component that talks to
PostgreSQL, and monitoring is an optional sidecar off the reverse proxy.

### Docker + Caddy HTTPS (recommended)

The repository ships a TLS entry point as a `caddy` service in
`docker-compose.yml` (enabled via the `https` profile) configured by
[`deploy/Caddyfile`](../../deploy/Caddyfile). Caddy obtains and renews
Let's Encrypt certificates automatically, redirects HTTP→HTTPS, and serves
the whole app on **one domain**: the API prefixes (`/api`, `/uploads`,
`/health`, `/ws` — the same list as `PROXY_PREFIXES` in
`hotel-web-fe/vite.config.ts`) are proxied to the backend, everything else to
the frontend SPA. Same-origin serving is required for the
`SameSite=Strict` refresh cookie to work — do **not** split the API onto a
separate subdomain.

Prerequisites: a DNS A/AAAA record for your domain, and ports 80+443 reachable from the internet.

```bash
# Add to .env, in addition to the Quick Start values:
DOMAIN=hotel.example.com
ACME_EMAIL=you@example.com
TRUST_PROXY_HEADERS=true                  # rate limiter reads X-Forwarded-For from Caddy
ALLOWED_ORIGINS=https://hotel.example.com
VITE_API_URL=                             # empty = use DOMAIN dynamically at runtime
docker compose --profile https up -d --build
```

Notes:
- Backend, frontend, and postgres ports bind to `127.0.0.1`; only Caddy (80/443) is public.
- Certs/ACME state persist in the `caddy_data` volume — deleting it forces re-issuance (rate-limit risk); no domain yet? leave `DOMAIN` unset (defaults to `localhost`) — Caddy self-signs, use `curl -k`.
- The manual Nginx instructions below remain the non-Docker alternative.

### Manual Deployment

#### 1. Database Setup

```bash
sudo -u postgres psql -c "CREATE USER hotel_admin WITH PASSWORD 'strong_password';"
sudo -u postgres psql -c "CREATE DATABASE hotel_management OWNER hotel_admin;"
```

Then run the V1 init sequence from [Database Setup](#database-setup) below
(baseline → data → seed, once only), prefixing each with
`PGPASSWORD=strong_password psql -h localhost -U hotel_admin -d hotel_management -f`.

#### 2. Backend Deployment

```bash
cd hotel-app-be
cargo build --release
DATABASE_URL=postgres://hotel_admin:strong_password@localhost:5432/hotel_management \
  JWT_SECRET="your-32-char-min-secret" \
  BACKEND_PORT=3030 \
  ALLOWED_ORIGINS=https://your-frontend-domain.com \
  RUST_LOG=info \
  ./target/release/hotel-app-be
```

Recommended to run as a systemd service:

```ini
[Unit]
Description=Hotel Management Backend
After=network.target postgresql.service
[Service]
Type=simple
User=hotel
WorkingDirectory=/opt/hotel-app/backend
EnvironmentFile=/opt/hotel-app/backend/.env
ExecStart=/opt/hotel-app/backend/hotel-app-be
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

#### 3. Frontend Deployment + Reverse Proxy

```bash
cd hotel-web-fe
bun run build
cp -r dist/* /var/www/hotel-frontend/   # or your web server's document root
```

Leave `VITE_API_URL` unset so the browser uses the current public origin at
runtime. Serve the SPA and reverse-proxy backend paths from the same HTTPS host;
this also keeps the `SameSite=Strict` refresh cookie available. The SPA needs a
fallback (`try_files $uri $uri/ /index.html`), while API and WebSocket paths need
upgrade headers and longer timeouts (night audit can run long), as in this
representative config:

```nginx
server {
    listen 443 ssl;
    server_name hotel.your-domain.com;
    ssl_certificate /etc/letsencrypt/live/hotel.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hotel.your-domain.com/privkey.pem;

    root /var/www/hotel-frontend;
    index index.html;

    location ~ ^/(?:api|uploads|ws)(?:/|$)|^/health$ {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Set `VITE_API_URL` only when intentionally targeting another API origin; because
it is a build-time override, changing that value requires rebuilding the frontend.

### Docker Swarm / Kubernetes

Docker Swarm: `docker stack deploy -c docker-compose.yml hotel-app`.

For Kubernetes, create the following resources:
- `Deployment` for backend (with health checks)
- `Service` for backend (ClusterIP)
- `Deployment` for frontend (Nginx serving static files)
- `Service` for frontend (LoadBalancer or Ingress)
- `StatefulSet` for PostgreSQL (with persistent volume)

---

## Desktop App Distribution

### Prerequisites and Build

```bash
cd hotel-desktop
bun install
bun run desktop:prepare
bun run build   # installer: .dmg on macOS, .msi on Windows, .AppImage on Linux — in src-tauri/target/release/bundle/
```

`desktop:prepare` is cache-aware: it syncs database resources, builds the frontend bundle, builds the backend sidecar, and copies the sidecar in that order, skipping each artifact when its inputs are unchanged. Production builds use the release backend sidecar; `build:fast` and `build:debug` use the debug sidecar. Use `bun run desktop:prepare:force` to rebuild every prepared artifact.

### Build Variants

| Command | Produces |
|---|---|
| `bun run build:fast` | Fast local verification build, no installer packaging |
| `bun run build:no-bundle` | Release binary, no installer packaging |
| `bun run build:debug` | Debug build (faster, larger binary) |
| `bun run build:nsis` / `build:msi` | Windows-only single-installer builds |
| `bun run build` | Platform-specific installer, run on the target platform (macOS DMG locally; cross-compile Windows/Linux from CI) |

### Desktop Configuration

```bash
HOTEL_DESKTOP_MODE=true        # Enables desktop-specific behavior
BACKEND_PORT=3030              # Starting port (auto-increments if busy)
SKIP_EMAIL_VERIFICATION=true   # Skip email verification in desktop mode
RUST_LOG=info                  # Logging level
HOTEL_LOG_DIR=./logs           # Log directory
```

---

## Environment Configuration

### Required and Security Variables

| Variable | Type | Default / Example | Purpose |
|----------|------|--------------------|---------|
| `DATABASE_URL` | Required | `postgres://user:pass@host:5432/db` | PostgreSQL connection string |
| `JWT_SECRET` | Required | `your-random-secret-at-least-32-characters` | Token signing key (≥32 chars) |
| `ALLOWED_ORIGINS` | Required | `https://app.domain.com,http://localhost:3000` | CORS allowed origins |
| `TRUST_PROXY_HEADERS` | Security | `false` | Only `true` behind a trusted reverse proxy |
| `SKIP_EMAIL_VERIFICATION` | Security | (unset) | `false` in production; `true` for desktop |
| `ENVIRONMENT` | Security | `production` | Set in `.env` for the target environment |

### Performance Tuning

```bash
DATABASE_MAX_CONNECTIONS=20
DATABASE_ACQUIRE_TIMEOUT_SECS=30
RBAC_CACHE_TTL_SECS=30
SETTINGS_CACHE_TTL_SECS=30
RUST_LOG=info                   # 'warn' for quieter logs
DATABASE_SLOW_STATEMENT_MS=500  # log slow queries
```

---

## Database Setup

### PostgreSQL Setup

```bash
createdb hotel_management
psql -d hotel_management -c "\dt"  # Verify: should show all tables after init
```

For the full V1 init order (baseline → data → seed, once only on a new empty
database), see
[`hotel-app-be/database/README.md`](../../hotel-app-be/database/README.md) —
it is the canonical database lifecycle reference.



```bash
cd hotel-app-be
```

The bootstrap seed deliberately does not install a shared usable password.
Set the administrator password before the first login:

```bash
cd hotel-app-be
DATABASE_URL="postgres://hotel_admin:strong_password@localhost:5432/hotel_management" \
  cargo run --bin fix_password -- admin '<strong-admin-password>'
```

---

## Security Checklist

### Pre-Deployment

- [ ] Change all default passwords (`POSTGRES_PASSWORD`, `JWT_SECRET`)
- [ ] Generate a strong JWT secret (`openssl rand -base64 48`)
- [ ] Verify `ALLOWED_ORIGINS` only contains trusted domains
- [ ] Set `TRUST_PROXY_HEADERS=false` unless behind a trusted proxy
- [ ] Enable TLS via reverse proxy (Docker: `--profile https` Caddy service; see [Docker + Caddy HTTPS](#docker--caddy-https-recommended))
- [ ] Review Content Security Policy in backend response headers
- [ ] Verify rate limiting is configured appropriately
- [ ] Ensure database firewall only allows backend IP access
- [ ] Run `cargo audit` on backend dependencies
- [ ] Run `bun audit` on frontend and desktop dependencies

### Operational Security

- [ ] Keep the backend and database on a private network
- [ ] Use read-only replicas for reporting/analytics queries
- [ ] Enable audit logging for all mutation operations
- [ ] Monitor failed authentication attempts
- [ ] Set up log rotation for application logs
- [ ] Regularly rotate JWT secrets and database passwords
- [ ] Keep Rust toolchain and dependencies updated

### The backend sends the following security headers automatically:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'; ...
Referrer-Policy: strict-origin-when-cross-origin
```

Verify with `curl -I https://your-api-domain.com/health`.

---

## Monitoring

### Health Check Endpoints

```bash
curl http://localhost:3030/health      # no auth required
curl http://localhost:3030/ws/status   # no auth required
```

### Logging

Backend logs are written to:
- Stderr (captured by Tauri sidecar in desktop mode)
- File under `HOTEL_LOG_DIR` or default `./logs/` directory
- Rotated daily with date-based filenames: `backend-YYYY-MM-DD.log`

### Metrics (Optional)

Scrape the backend with Prometheus (enable in `docker-compose.yml`) and chart it in Grafana, alongside the health endpoints above:

```yaml
scrape_configs:
  - job_name: hotel-backend
    static_configs: [{ targets: ['localhost:3030'] }]
```

---

## Backup and Recovery

### PostgreSQL Backup

```bash
pg_dump -h localhost -U hotel_admin hotel_management > /backups/hotel_$(date +%Y%m%d).sql   # cron: 0 2 * * *
psql -h localhost -U hotel_admin hotel_management < /backups/hotel_20250101.sql              # restore
```

### Desktop Data Backup


```bash
cp -r /path/to/pgsql/data /backups/pgsql_data_$(date +%Y%m%d)   # PostgreSQL (desktop mode)
```

### Backup via Docker

`docker-compose.yml` has no scheduled backup service — backups are manual, run on demand or scheduled externally (e.g. host cron):

```bash
docker exec hotel-db pg_dump -U hotel_admin hotel_management > backup.sql   # manual
0 2 * * * docker exec hotel-db pg_dump -U hotel_admin hotel_management > /backups/hotel_$(date +\%Y\%m\%d).sql   # host cron, daily 02:00
```

### Log Rotation

The backend writes one append-only file per calendar day (`backend-YYYY-MM-DD.log` under `HOTEL_LOG_DIR`) with no built-in size cap or cleanup. Rotate/prune it with `logrotate(8)` on Linux hosts:

```
# /etc/logrotate.d/hotel-app-be
/path/to/HOTEL_LOG_DIR/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
}
```

---

## Troubleshooting

### Backend won't start
- **Symptom:** `FATAL: Database connection failed` or `Invalid JWT configuration`.
- **Cause:** wrong/unreachable `DATABASE_URL`, `JWT_SECRET` under 32 chars, or missing `.env`.
- **Fix:** verify `DATABASE_URL` and that PostgreSQL is reachable (check its firewall), set a ≥32-char `JWT_SECRET`, confirm `.env` exists in `hotel-app-be/`.

### CORS errors
- **Symptom:** browser console shows CORS errors; requests blocked.
- **Cause:** frontend origin missing from `ALLOWED_ORIGINS`, or an http/https scheme mismatch.
- **Fix:** add the origin to `ALLOWED_ORIGINS`; in development, go through the Vite proxy instead of calling the backend directly.

### Desktop app issues
- **Symptom:** sidecar won't start, PostgreSQL won't initialize, or "port already in use".
- **Cause:** stale prepared artifacts, a port conflict, or a missing system dependency.
- **Fix:** check logs under `~/Library/Application Support/HotelApp/logs/` (macOS), free the backend port, then re-run `bun run desktop:prepare:force`.

### Performance issues
- **Symptom:** slow API responses, high database CPU, or timeouts.
- **Cause:** unindexed queries, an undersized connection pool, or one backend instance under load.
- **Fix:** check `DATABASE_SLOW_STATEMENT_MS` logs and `pg_stat_activity`, tune `DATABASE_MAX_CONNECTIONS`, add indexes, or scale backend replicas behind a load balancer.

### Common Error Codes

| HTTP Status | Meaning | Common Causes |
|-------------|---------|---------------|
| 401 | Unauthorized | Missing/invalid JWT, expired token |
| 403 | Forbidden | Insufficient RBAC permissions |
| 422 | Validation Error | Invalid request body, missing required fields |
| 429 | Rate Limited | Too many requests, wait and retry |
| 500 | Internal Error | Backend exception, check application logs |
