#!/bin/bash

# Deployment script for Hotel Management System
# This script builds new Docker images and deploys the application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"

# Functions
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

# Check if required files exist
check_requirements() {
    log_info "Checking requirements..."

    if [ ! -f "$DOCKER_COMPOSE_FILE" ]; then
        log_error "Docker compose file not found: $DOCKER_COMPOSE_FILE"
        exit 1
    fi

    if [ ! -f "$ENV_FILE" ]; then
        log_warning "Environment file not found: $ENV_FILE (using .env.example)"
        ENV_FILE=".env.example"
    fi

    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi

    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null; then
        log_error "docker-compose command not found. Please install Docker Compose."
        exit 1
    fi
}

# Clean up old images and containers
cleanup() {
    log_info "Cleaning up old containers and images..."

    # Stop and remove containers
    docker-compose --env-file="$ENV_FILE" down --remove-orphans

    # Remove dangling images
    if [ "$(docker images -f "dangling=true" -q)" ]; then
        log_info "Removing dangling Docker images..."
        docker images -f "dangling=true" -q | xargs docker rmi -f
    fi
}

# Build images
build_images() {
    log_info "Building Docker images..."

    # Build specific services
    build_fe() {
        log_info "Building frontend image..."
        docker-compose --env-file="$ENV_FILE" build --no-cache frontend
    }

    build_be() {
        log_info "Building backend image..."
        docker-compose --env-file="$ENV_FILE" build --no-cache backend
    }

    # Build all images
    if [ "$1" = "all" ] || [ "$1" = "frontend" ]; then
        build_fe
    fi

    if [ "$1" = "all" ] || [ "$1" = "backend" ]; then
        build_be
    fi

    if [ -z "$1" ]; then
        build_fe
        build_be
    fi
}

# Deploy services
deploy() {
    log_info "Deploying services..."
    docker-compose --env-file="$ENV_FILE" up -d
}

# Health check
health_check() {
    log_info "Performing health checks..."

    max_attempts=30
    attempt=1

    while [ $attempt -le $max_attempts ]; do
        if docker-compose --env-file="$ENV_FILE" ps | grep -q "healthy"; then
            log_success "All services are healthy!"
            return 0
        fi

        log_warning "Waiting for services to be healthy... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done

    log_error "Health check failed after $max_attempts attempts"
    docker-compose --env-file="$ENV_FILE" logs
    return 1
}

# Main deployment function
run_deployment() {
    local service="$1"
    local skip_build="$2"
    local skip_cleanup="$3"

    if [ "$skip_cleanup" != "true" ]; then
        cleanup
    fi

    if [ "$skip_build" != "true" ]; then
        build_images "$service"
    fi

    deploy

    if [ "$NO_HEALTH_CHECK" != "true" ]; then
        health_check
    fi
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS] [SERVICE]

Deploy the Hotel Management System with Docker.

OPTIONS:
    -h, --help              Show this help message
    --skip-build            Skip image building phase
    --skip-cleanup          Skip cleanup phase (faster redeployment)
    --no-health-check       Skip health checks after deployment
    --env-file FILE         Use specific environment file (default: .env)

SERVICE:
    frontend                Deploy only frontend
    backend                 Deploy only backend
    all                     Deploy all services (default if no service specified)

EXAMPLES:
    $0                      # Deploy all services
    $0 frontend             # Deploy only frontend
    $0 --skip-build         # Redeploy without rebuilding
    $0 --env-file .env.prod # Use production environment

EOF
}

# Parse arguments
SERVICE=""
SKIP_BUILD="false"
SKIP_CLEANUP="false"
NO_HEALTH_CHECK="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        --skip-build)
            SKIP_BUILD="true"
            shift
            ;;
        --skip-cleanup)
            SKIP_CLEANUP="true"
            shift
            ;;
        --no-health-check)
            NO_HEALTH_CHECK="true"
            shift
            ;;
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        frontend|backend|all|"")
            SERVICE="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Main script
main() {
    log_info "Starting Hotel Management System deployment"

    check_requirements

    log_info "Environment file: $ENV_FILE"
    log_info "Docker Compose file: $DOCKER_COMPOSE_FILE"
    log_info "Service to deploy: ${SERVICE:-all}"

    run_deployment "$SERVICE" "$SKIP_BUILD" "$SKIP_CLEANUP"

    log_success "Deployment completed successfully!"
    log_info "Use 'docker-compose ps' to check service status"
    log_info "Use 'docker-compose logs -f <service>' to view logs"
}

main "$@"
