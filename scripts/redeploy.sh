#!/bin/bash

# Hotel Management System - Redeploy Script
# This script handles rebuilding and redeploying the application with zero-downtime

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -h, --help              Show this help message
    -s, --service SERVICE   Redeploy specific service (backend|frontend|all)
    -b, --backup            Create database backup before redeploying
    -p, --pull              Pull latest images instead of building
    -c, --clean             Clean build (no cache)
    --no-downtime           Use blue-green deployment strategy
    --profile PROFILE       Use specific docker-compose profile (production|monitoring)

Examples:
    $0                      # Redeploy all services
    $0 -s backend          # Redeploy only backend
    $0 -b -s all           # Backup database and redeploy all
    $0 -c --profile production  # Clean build with production profile

EOF
    exit 0
}

# Parse command line arguments
SERVICE="all"
BACKUP=false
PULL=false
CLEAN=false
NO_DOWNTIME=false
PROFILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -s|--service)
            SERVICE="$2"
            shift 2
            ;;
        -b|--backup)
            BACKUP=true
            shift
            ;;
        -p|--pull)
            PULL=true
            shift
            ;;
        -c|--clean)
            CLEAN=true
            shift
            ;;
        --no-downtime)
            NO_DOWNTIME=true
            shift
            ;;
        --profile)
            PROFILE="$2"
            shift 2
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Change to project root
cd "$PROJECT_ROOT"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    log_warning ".env file not found. Creating from .env.example..."
    if [ -f "${PROJECT_ROOT}/.env.example" ]; then
        cp "${PROJECT_ROOT}/.env.example" "$ENV_FILE"
        log_warning "Please review and update $ENV_FILE with your configuration"
        exit 1
    else
        log_error ".env.example not found. Please create .env file manually"
        exit 1
    fi
fi

# Load environment variables
set -a
source "$ENV_FILE"
set +a

log_info "Starting redeploy process..."
log_info "Service: $SERVICE"
log_info "Timestamp: $TIMESTAMP"

# Create backup if requested
if [ "$BACKUP" = true ]; then
    log_info "Creating database backup..."
    mkdir -p "$BACKUP_DIR"

    # Check if postgres container is running
    if docker ps | grep -q hotel-postgres; then
        docker exec hotel-postgres pg_dump \
            -U "${POSTGRES_USER:-hotel_admin}" \
            -d "${POSTGRES_DB:-hotel_management}" \
            > "${BACKUP_DIR}/backup_${TIMESTAMP}.sql"

        # Compress backup
        gzip "${BACKUP_DIR}/backup_${TIMESTAMP}.sql"
        log_success "Backup created: ${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
    else
        log_warning "Postgres container not running. Skipping backup."
    fi
fi

# Build docker-compose command
COMPOSE_CMD="docker compose"
if [ -n "$PROFILE" ]; then
    COMPOSE_CMD="$COMPOSE_CMD --profile $PROFILE"
fi

# Determine which services to redeploy
SERVICES=""
case $SERVICE in
    backend)
        SERVICES="backend"
        ;;
    frontend)
        SERVICES="frontend"
        ;;
    all)
        SERVICES="backend frontend"
        ;;
    *)
        log_error "Invalid service: $SERVICE. Must be 'backend', 'frontend', or 'all'"
        exit 1
        ;;
esac

# Pull or build images
if [ "$PULL" = true ]; then
    log_info "Pulling latest images..."
    $COMPOSE_CMD pull $SERVICES
else
    log_info "Building images..."
    BUILD_ARGS=""
    if [ "$CLEAN" = true ]; then
        BUILD_ARGS="--no-cache"
        log_info "Clean build enabled (no cache)"
    fi
    $COMPOSE_CMD build $BUILD_ARGS $SERVICES
fi

# Deployment strategy
if [ "$NO_DOWNTIME" = true ]; then
    log_info "Using zero-downtime deployment strategy..."

    # Scale up new containers
    for svc in $SERVICES; do
        log_info "Scaling up new $svc container..."
        $COMPOSE_CMD up -d --scale $svc=2 --no-recreate $svc

        # Wait for health check
        log_info "Waiting for $svc health check..."
        sleep 10

        # Scale down old container
        log_info "Scaling down old $svc container..."
        $COMPOSE_CMD up -d --scale $svc=1 --no-recreate $svc
    done
else
    log_info "Redeploying services: $SERVICES"
    $COMPOSE_CMD up -d --force-recreate $SERVICES
fi

# Wait for services to be healthy
log_info "Waiting for services to be healthy..."
sleep 5

# Check service health
for svc in $SERVICES; do
    if docker ps | grep -q "hotel-$svc"; then
        CONTAINER_ID=$(docker ps -qf "name=hotel-$svc")
        HEALTH=$(docker inspect --format='{{.State.Health.Status}}' $CONTAINER_ID 2>/dev/null || echo "unknown")

        if [ "$HEALTH" = "healthy" ] || [ "$HEALTH" = "unknown" ]; then
            log_success "$svc is running"
        else
            log_warning "$svc health status: $HEALTH"
        fi
    else
        log_error "$svc container not found"
    fi
done

# Clean up old images
log_info "Cleaning up unused images..."
docker image prune -f

# Show running containers
log_info "Current running containers:"
$COMPOSE_CMD ps

# Show logs for newly deployed services
log_info "Recent logs from deployed services:"
$COMPOSE_CMD logs --tail=20 $SERVICES

log_success "Redeploy completed successfully!"
log_info "Check application at:"
log_info "  Frontend: http://localhost:${FRONTEND_PORT:-3000}"
log_info "  Backend:  http://localhost:${BACKEND_PORT:-3030}"

# Optional: Run health checks
if command -v curl &> /dev/null; then
    log_info "Running health checks..."

    if echo "$SERVICES" | grep -q "backend"; then
        if curl -f -s "http://localhost:${BACKEND_PORT:-3030}/health" > /dev/null; then
            log_success "Backend health check passed"
        else
            log_error "Backend health check failed"
        fi
    fi

    if echo "$SERVICES" | grep -q "frontend"; then
        if curl -f -s "http://localhost:${FRONTEND_PORT:-3000}/" > /dev/null; then
            log_success "Frontend health check passed"
        else
            log_error "Frontend health check failed"
        fi
    fi
fi

exit 0
