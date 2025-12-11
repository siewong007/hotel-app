# Hotel Management System - Deployment Guide

This guide explains how to deploy the Hotel Management System using Docker Compose with independent service deployment capabilities.

## Architecture Overview

The system consists of four main services:

1. **PostgreSQL Database** - Data persistence
2. **Backend API** (Rust/Axum) - Business logic and REST API
3. **Frontend** (React/Nginx) - User interface
4. **DB Migrator** - Database migration runner (optional)

All services are orchestrated using Docker Compose with support for independent deployment.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM available
- 10GB+ disk space

## Quick Start

### 1. Initial Setup

```bash
# Clone the repository (if not already done)
cd hotel-app

# Copy .env.example to .env and update values
cp .env.example .env
# Edit .env and set secure passwords and secrets

# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 2. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3030
- **API Health**: http://localhost:3030/health
- **PostgreSQL**: localhost:5433 (development)

## Environment Configuration

The `.env` file contains all configuration variables. Key variables:

```bash
# Database
POSTGRES_PASSWORD=<strong-password>
POSTGRES_PORT=5433  # 5433 for dev, 5432 for prod

# Backend
JWT_SECRET=<32-char-secret>
BACKEND_VERSION=latest
ALLOWED_ORIGINS=http://localhost:3000

# Frontend
FRONTEND_VERSION=latest
REACT_APP_API_URL=http://localhost:3030
```

## Independent Deployment

### Deploy Only Backend

```bash
# Using deployment script (recommended)
./deployment/scripts/deploy-backend.sh v1.2.3

# Or manually
BACKEND_VERSION=v1.2.3 docker-compose build backend
docker-compose up -d --no-deps backend
```

### Deploy Only Frontend

```bash
# Using deployment script (recommended)
./deployment/scripts/deploy-frontend.sh v1.2.3

# Or manually
FRONTEND_VERSION=v1.2.3 \
REACT_APP_API_URL=http://localhost:3030 \
docker-compose build frontend
docker-compose up -d --no-deps frontend
```

### Deploy All Services

```bash
# Using deployment script (recommended)
./deployment/scripts/deploy-all.sh v1.2.3

# Or manually
docker-compose down
docker-compose up -d
```

## Database Management

### Run Migrations

```bash
# Using the migration service
docker-compose --profile migration run --rm db-migrator

# Or manually
docker-compose exec postgres psql -U hotel_admin -d hotel_management -f /path/to/migration.sql
```

### Database Backup

```bash
# Create backup
docker-compose exec postgres pg_dump -U hotel_admin hotel_management > backup_$(date +%Y%m%d).sql

# Restore backup
docker-compose exec -T postgres psql -U hotel_admin hotel_management < backup_20251211.sql
```

### Reset Database

```bash
# Stop all services
docker-compose down

# Remove database volume (WARNING: destroys all data)
docker volume rm hotel-app_postgres-data

# Restart services (database will be re-initialized)
docker-compose up -d
```

## Development vs Production

### Development Mode (default)

Uses `docker-compose.override.yml` automatically:

```bash
docker-compose up -d
```

Features:
- PostgreSQL on port 5433
- Debug logging enabled
- Permissive CORS
- Local volume mounts

### Production Mode

Uses `docker-compose.prod.yml`:

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Features:
- Backend replicas: 3
- Frontend replicas: 2
- PostgreSQL not exposed externally
- Production logging levels
- Resource limits enforced

## Deployment Scripts

Located in `deployment/scripts/`:

### deploy-backend.sh
```bash
./deployment/scripts/deploy-backend.sh [version]
```
Deploys only the backend service with health checks.

### deploy-frontend.sh
```bash
./deployment/scripts/deploy-frontend.sh [version]
```
Deploys only the frontend service with health checks.

### deploy-all.sh
```bash
./deployment/scripts/deploy-all.sh [version]
```
Full system deployment:
1. Build all services
2. Stop existing services
3. Start PostgreSQL
4. Run migrations
5. Start backend
6. Start frontend
7. Health checks

### health-check.sh
```bash
./deployment/scripts/health-check.sh
```
Verifies all services are healthy.

### run-migrations.sh
Used internally by the db-migrator service. Can be run manually:
```bash
docker-compose --profile migration run --rm db-migrator
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs <service-name>

# Check service status
docker-compose ps

# Restart service
docker-compose restart <service-name>
```

### Database Connection Issues

```bash
# Check database is running
docker-compose exec postgres pg_isready -U hotel_admin

# Check database logs
docker-compose logs postgres

# Verify DATABASE_URL in .env uses 'postgres' as host (not 'localhost')
```

### Port Conflicts

If ports are already in use:

```bash
# Edit .env and change ports:
POSTGRES_PORT=5434
BACKEND_PORT=3031
FRONTEND_PORT=3001

# Restart services
docker-compose down && docker-compose up -d
```

### Build Issues

```bash
# Clean rebuild
docker-compose build --no-cache <service-name>

# Remove old images
docker-compose down --rmi all

# Rebuild all
docker-compose build
```

### Health Check Failures

```bash
# Check backend health manually
curl http://localhost:3030/health

# Check frontend manually
curl http://localhost:3000/

# View detailed logs
docker-compose logs --tail=100 backend
docker-compose logs --tail=100 frontend
```

## Rollback

### Rollback Backend

```bash
# Stop current version
docker-compose stop backend

# Deploy previous version
BACKEND_VERSION=v1.2.2 docker-compose up -d backend

# Verify
curl http://localhost:3030/health
```

### Rollback Frontend

```bash
docker-compose stop frontend
FRONTEND_VERSION=v1.2.2 docker-compose up -d frontend
```

## Monitoring

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Resource Usage

```bash
# Container stats
docker stats

# Service status
docker-compose ps

# Disk usage
docker system df
```

## Cleanup

### Remove Stopped Containers

```bash
docker-compose down
```

### Remove Volumes (WARNING: destroys data)

```bash
docker-compose down -v
```

### Complete Cleanup

```bash
# Stop and remove everything
docker-compose down --rmi all -v

# Remove local volumes
rm -rf volumes/
```

## Security Best Practices

1. **Change all default passwords** in `.env`
2. **Use strong JWT secrets** (minimum 32 characters)
3. **Set ALLOWED_ORIGINS** to your actual domain in production
4. **Don't expose PostgreSQL port** in production
5. **Use HTTPS** with reverse proxy in production
6. **Keep Docker and images updated**
7. **Backup database regularly**

## CI/CD Integration

The deployment scripts can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Deploy Backend
  run: ./deployment/scripts/deploy-backend.sh ${{ github.ref_name }}

- name: Health Check
  run: ./deployment/scripts/health-check.sh
```

## Support

For issues and questions:
- Check logs: `docker-compose logs`
- Review this guide
- Check Docker Compose documentation
- File an issue in the repository

## Version Management

Images are tagged with:
- `latest` - Most recent build
- `v1.2.3` - Specific version (recommended for production)

Always use version tags in production:

```bash
BACKEND_VERSION=v1.2.3 \
FRONTEND_VERSION=v1.2.3 \
docker-compose up -d
```
