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

The fastest way to get the full stack running:

```bash
# Clone the repository
git clone https://github.com/siewong007/hotel-app.git
cd hotel-app

# Copy and configure environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and POSTGRES_PASSWORD

# Start all services
docker compose up -d

# Check service health
docker compose ps
curl http://localhost:3030/health
```

The services will be available at:
- **Frontend:** http://localhost:80
- **Backend API:** http://localhost:3030
- **PostgreSQL:** localhost:5432

---

## Oracle Cloud Always Free Development

The Terraform configuration in `infra/terraform/oci/environments/dev` provisions a low-cost
development environment on one Oracle Ampere A1 Flex VM. The VM runs the
existing Docker Compose stack, so there is no paid managed PostgreSQL service.
Its defaults use a conservative 2 OCPU and 12 GB of memory; check the limits
shown in your tenancy before increasing either value.

This design is intentionally a development/preview topology:

- The VM, database, and application share one failure domain.
- Always Free capacity can be unavailable in a selected availability domain.
- Always Free services have no production SLA, and idle instances can be reclaimed.
- PostgreSQL 19 Beta 1 is not supported for production data.

Create an OCI Vault secret for each required application secret, configure the
example variable file, and then preview the infrastructure before applying it:

```bash
cd infra/terraform/oci/environments/dev
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Do not put OCI API keys, database passwords, JWT secrets, or Terraform state in
Git. The directory includes an Object Storage backend example for teams that
need remote state; use the backend approach compatible with the Terraform
version installed in your environment.

Oracle references: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Terraform provider](https://docs.oracle.com/en-us/iaas/Content/dev/terraform/home.htm), and [Object Storage state](https://docs.oracle.com/en-us/iaas/Content/dev/terraform/object-storage-state.htm).

---

## Production Deployment

> **PostgreSQL 19 status:** the repository currently targets PostgreSQL 19
> Beta 1 for development. PostgreSQL identifies version 19 as a development
> release. Do not use this deployment path for production hotel data until 19
> reaches general availability and backup/restore plus load tests pass.

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 20 GB | 50+ GB (SSD) |
| PostgreSQL | 19 Beta 1 | 19 GA after validation |
| Reverse Proxy | — | Nginx or Caddy |
| TLS Certificate | — | Let's Encrypt |

### Architecture

```
                         ┌─────────────┐
                         │   CDN/CDN   │
                         │  (optional) │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │   Reverse   │
                         │   Proxy     │
                         │ (TLS term.) │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
       ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
       │  Backend    │  │  Frontend   │  │  Monitoring │
       │  Instance   │  │ (static)    │  │ (optional)  │
       └──────┬──────┘  └─────────────┘  └─────────────┘
              │
       ┌──────▼──────┐
       │ PostgreSQL  │
       │  (Primary)  │
       └─────────────┘
```

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

Prerequisites: a DNS A/AAAA record for your domain pointing at the server,
and ports 80 + 443 reachable from the internet.

```bash
# .env — in addition to the Quick Start values
DOMAIN=hotel.example.com
ACME_EMAIL=you@example.com
TRUST_PROXY_HEADERS=true                  # rate limiter reads X-Forwarded-For from Caddy
ALLOWED_ORIGINS=https://hotel.example.com
VITE_API_URL=https://hotel.example.com    # build arg — changing it requires --build

# Start (rebuild needed the first time and whenever VITE_API_URL changes)
docker compose --profile https up -d --build
```

Notes:
- The backend, frontend, and postgres ports are bound to `127.0.0.1` on the
  host; only Caddy (80/443) is publicly reachable.
- Certificates and ACME account state persist in the `caddy_data` volume.
  Deleting it forces re-issuance and can hit Let's Encrypt rate limits.
- For a local smoke test without a domain, leave `DOMAIN` unset (defaults to
  `localhost`) — Caddy self-signs a local certificate; use `curl -k`.

The manual Nginx instructions below remain the non-Docker alternative.

### Manual Deployment

#### 1. Database Setup

```bash
# Create database and user
sudo -u postgres psql -c "CREATE USER hotel_admin WITH PASSWORD 'strong_password';"
sudo -u postgres psql -c "CREATE DATABASE hotel_management OWNER hotel_admin;"

# Apply schema and seed data
PGPASSWORD=strong_password psql -h localhost -U hotel_admin -d hotel_management -f hotel-app-be/database/schema.sql
PGPASSWORD=strong_password psql -h localhost -U hotel_admin -d hotel_management -f hotel-app-be/database/data.sql
```

#### 2. Backend Deployment

```bash
cd hotel-app-be

# Build release binary
cargo build --release

# Run with production configuration
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

#### 3. Frontend Deployment

```bash
cd hotel-web-fe

# Build for production
VITE_API_URL=https://your-api-domain.com bun run build

# Deploy the dist/ directory to your web server
# Example with Nginx:
cp -r dist/* /var/www/hotel-frontend/
```

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name your-frontend-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name your-frontend-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-frontend-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-frontend-domain.com/privkey.pem;

    root /var/www/hotel-frontend;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
}
```

#### 4. Reverse Proxy for Backend API

```nginx
server {
    listen 443 ssl;
    server_name api.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/api.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeouts for long-running operations like night audit
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

### Docker Swarm / Kubernetes

For orchestrating with Docker Swarm:

```bash
# Deploy as a stack
docker stack deploy -c docker-compose.yml hotel-app
```

For Kubernetes, create the following resources:
- `Deployment` for backend (with health checks)
- `Service` for backend (ClusterIP)
- `Deployment` for frontend (Nginx serving static files)
- `Service` for frontend (LoadBalancer or Ingress)
- `StatefulSet` for PostgreSQL (with persistent volume)

---

## Desktop App Distribution

### Prerequisites

```bash
cd hotel-desktop
bun install
bun run desktop:prepare
```

### Building for Distribution

```bash
# Production build (creates .dmg on macOS, .msi on Windows, .AppImage on Linux)
bun run build
```

The built installer will be in `src-tauri/target/release/bundle/`.

### Build Variants

```bash
# Fast local verification build, no installer packaging
bun run build:fast

# Release binary build, no installer packaging
bun run build:no-bundle

# Debug build (faster, larger binary)
bun run build:debug

# Windows-only single-installer builds
bun run build:nsis
bun run build:msi

# Platform-specific (run on target platform)
bun run build  # macOS DMG
# For Windows/Linux, cross-compile from CI
```

`desktop:prepare` is cache-aware: it syncs database resources, builds the frontend bundle, builds the backend sidecar, and copies the sidecar in that order, skipping each artifact when its inputs are unchanged. Production builds use the release backend sidecar; `build:fast` and `build:debug` use the debug sidecar. Use `bun run desktop:prepare:force` to rebuild every prepared artifact.

### Desktop Configuration

Key environment variables for desktop mode:

```bash
HOTEL_DESKTOP_MODE=true        # Enables desktop-specific behavior
BACKEND_PORT=3030              # Starting port (auto-increments if busy)
SKIP_EMAIL_VERIFICATION=true   # Skip email verification in desktop mode
RUST_LOG=info                  # Logging level
HOTEL_LOG_DIR=./logs           # Log directory
```

---

## Environment Configuration

### Required Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `JWT_SECRET` | Token signing key (≥32 chars) | `your-random-secret-at-least-32-characters` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `https://app.domain.com,http://localhost:3000` |

### Important Security Variables

| Variable | Default | Recommendation |
|----------|---------|----------------|
| `TRUST_PROXY_HEADERS` | `false` | Only `true` behind a trusted reverse proxy |
| `SKIP_EMAIL_VERIFICATION` | (unset) | `false` in production; `true` for desktop |
| `ENVIRONMENT` | `production` | Set in `.env` for the target environment |

### Performance Tuning

```bash
# Connection pool
DATABASE_MAX_CONNECTIONS=20
DATABASE_ACQUIRE_TIMEOUT_SECS=30

# Cache TTLs
RBAC_CACHE_TTL_SECS=30
SETTINGS_CACHE_TTL_SECS=30

# Logging
RUST_LOG=info                # Use 'warn' for quieter logs
DATABASE_SLOW_STATEMENT_MS=500  # Log slow queries
```

---

## Database Setup

### PostgreSQL Setup

```bash
# From scratch
createdb hotel_management
psql -d hotel_management -f hotel-app-be/database/schema.sql
psql -d hotel_management -f hotel-app-be/database/data.sql

# Verify
psql -d hotel_management -c "\dt"  # Should show all tables
```

### SQLite Setup (Desktop/Offline)

SQLite is initialized automatically when running in SQLite mode:

```bash
cd hotel-app-be
DATABASE_PATH=./hotel_data.db JWT_SECRET="your-secret" cargo run --features sqlite --no-default-features
```

Default admin credentials after seed (from `database/data.sql`):

| Username | Password | Role |
|----------|----------|------|
| `admin` | `change-me` | Admin |

> **Important:** Change the default password immediately after first login.

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

Verify with:
```bash
curl -I https://your-api-domain.com/health
```

---

## Monitoring

### Health Check Endpoints

```bash
# Basic health (no auth required)
curl http://localhost:3030/health

# WebSocket status (no auth required)
curl http://localhost:3030/ws/status
```

### Logging

Backend logs are written to:
- Stderr (captured by Tauri sidecar in desktop mode)
- File under `HOTEL_LOG_DIR` or default `./logs/` directory
- Rotated daily with date-based filenames: `backend-YYYY-MM-DD.log`

### Metrics (Optional)

For production monitoring, consider:
1. **Prometheus** — metrics collection (configurable in `docker-compose.yml`)
2. **Grafana** — dashboards (admin password configurable)
3. **Health checks** — built-in endpoints for load balancer probes

### Integration with Monitoring Tools

```yaml
# Prometheus scrape config example
scrape_configs:
  - job_name: hotel-backend
    static_configs:
      - targets: ['localhost:3030']
```

---

## Backup and Recovery

### PostgreSQL Backup

```bash
# Daily backup (cron: 0 2 * * *)
pg_dump -h localhost -U hotel_admin hotel_management > /backups/hotel_$(date +%Y%m%d).sql

# Restore
psql -h localhost -U hotel_admin hotel_management < /backups/hotel_20250101.sql
```

### Desktop Data Backup

For desktop mode, back up the SQLite database file and the PostgreSQL data directory:

```bash
# SQLite
cp ./hotel_data.db ./backups/hotel_data_$(date +%Y%m%d).db

# PostgreSQL (desktop mode)
cp -r /path/to/pgsql/data /backups/pgsql_data_$(date +%Y%m%d)
```

### Backup via Docker

`docker-compose.yml` does not include a scheduled/automated backup service today — backups are manual only. Run `pg_dump` on demand, or schedule the same command externally (e.g. host cron):

```bash
# Manual backup
docker exec hotel-db pg_dump -U hotel_admin hotel_management > backup.sql
```

```bash
# Example: schedule it yourself with host cron (daily at 02:00)
0 2 * * * docker exec hotel-db pg_dump -U hotel_admin hotel_management > /backups/hotel_$(date +\%Y\%m\%d).sql
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

**Symptoms:**
- `FATAL: Database connection failed`
- `FATAL: Invalid JWT configuration`

**Solutions:**
1. Verify `DATABASE_URL` is correct and PostgreSQL is running
2. Ensure `JWT_SECRET` is at least 32 characters
3. Check PostgreSQL firewall settings
4. Verify `.env` file is present in `hotel-app-be/`

### CORS errors

**Symptoms:**
- Browser console shows CORS-related errors
- API requests blocked by browser

**Solutions:**
1. Check `ALLOWED_ORIGINS` includes the frontend origin
2. Verify the frontend URL is not using `http` when backend expects `https`
3. For development, use the Vite proxy (configured in `vite.config.ts`)

### Desktop app issues

**Symptoms:**
- Backend sidecar not starting
- PostgreSQL not initializing
- Port already in use

**Solutions:**
1. Check logs in app data directory (`~/Library/Application Support/HotelApp/logs/` on macOS)
2. Verify no other process is using the backend port
3. Ensure all system dependencies are installed
4. Re-run `bun run desktop:prepare:force`

### Performance issues

**Symptoms:**
- Slow API responses
- High database CPU usage
- Timeout errors

**Solutions:**
1. Check `DATABASE_SLOW_STATEMENT_MS` logs for slow queries
2. Verify connection pool settings (`DATABASE_MAX_CONNECTIONS`)
3. Monitor PostgreSQL `pg_stat_activity` for long-running queries
4. Consider adding database indexes for frequently queried columns
5. Scale backend replicas behind a load balancer

### Common Error Codes

| HTTP Status | Meaning | Common Causes |
|-------------|---------|---------------|
| 401 | Unauthorized | Missing/invalid JWT, expired token |
| 403 | Forbidden | Insufficient RBAC permissions |
| 422 | Validation Error | Invalid request body, missing required fields |
| 429 | Rate Limited | Too many requests, wait and retry |
| 500 | Internal Error | Backend exception, check application logs |
