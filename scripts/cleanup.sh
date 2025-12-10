#!/bin/bash

# Hotel Management System - Cleanup Script
# This script removes all hotel-app related Docker resources

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

# Show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Clean up Docker resources for Hotel Management System.

Options:
    -h, --help          Show this help message
    -a, --all           Remove everything (containers, volumes, images, networks)
    -c, --containers    Remove only containers
    -v, --volumes       Remove only volumes (WARNING: Data loss!)
    -i, --images        Remove only images
    -n, --networks      Remove only networks
    --keep-data         Keep volumes (preserve database data)

Examples:
    $0                  # Interactive cleanup
    $0 --all           # Remove everything
    $0 -c -n           # Remove containers and networks only
    $0 --all --keep-data  # Remove everything except volumes

WARNING: This will permanently delete data. Make backups first!

EOF
    exit 0
}

# Parse command line arguments
REMOVE_ALL=false
REMOVE_CONTAINERS=false
REMOVE_VOLUMES=false
REMOVE_IMAGES=false
REMOVE_NETWORKS=false
KEEP_DATA=false
INTERACTIVE=true

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            ;;
        -a|--all)
            REMOVE_ALL=true
            INTERACTIVE=false
            shift
            ;;
        -c|--containers)
            REMOVE_CONTAINERS=true
            INTERACTIVE=false
            shift
            ;;
        -v|--volumes)
            REMOVE_VOLUMES=true
            INTERACTIVE=false
            shift
            ;;
        -i|--images)
            REMOVE_IMAGES=true
            INTERACTIVE=false
            shift
            ;;
        -n|--networks)
            REMOVE_NETWORKS=true
            INTERACTIVE=false
            shift
            ;;
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            ;;
    esac
done

# Change to project root
cd "$PROJECT_ROOT"

log_info "Hotel Management System - Docker Cleanup"
echo ""

# Interactive mode
if [ "$INTERACTIVE" = true ]; then
    log_warning "This script will help you clean up Docker resources."
    echo ""
    read -p "Do you want to stop and remove containers? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_CONTAINERS=true
    fi

    read -p "Do you want to remove volumes? (WARNING: Data loss!) (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_VOLUMES=true
    fi

    read -p "Do you want to remove images? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_IMAGES=true
    fi

    read -p "Do you want to remove networks? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REMOVE_NETWORKS=true
    fi
fi

# Set flags for --all
if [ "$REMOVE_ALL" = true ]; then
    REMOVE_CONTAINERS=true
    REMOVE_IMAGES=true
    REMOVE_NETWORKS=true
    if [ "$KEEP_DATA" = false ]; then
        REMOVE_VOLUMES=true
    fi
fi

echo ""
log_info "Cleanup plan:"
[ "$REMOVE_CONTAINERS" = true ] && echo "  - Remove containers"
[ "$REMOVE_VOLUMES" = true ] && echo "  - Remove volumes (DATA WILL BE LOST!)"
[ "$REMOVE_IMAGES" = true ] && echo "  - Remove images"
[ "$REMOVE_NETWORKS" = true ] && echo "  - Remove networks"
echo ""

if [ "$INTERACTIVE" = true ]; then
    read -p "Continue with cleanup? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cleanup cancelled."
        exit 0
    fi
fi

# Stop and remove containers
if [ "$REMOVE_CONTAINERS" = true ]; then
    log_info "Stopping and removing containers..."

    if docker compose ps -q 2>/dev/null | grep -q .; then
        docker compose down
        log_success "Containers removed"
    else
        log_info "No running containers found"
    fi
fi

# Remove volumes
if [ "$REMOVE_VOLUMES" = true ]; then
    log_warning "Removing volumes (this will delete all database data)..."

    VOLUMES=$(docker volume ls -q | grep -i hotel || true)
    if [ -n "$VOLUMES" ]; then
        echo "$VOLUMES" | xargs docker volume rm
        log_success "Volumes removed"
    else
        log_info "No hotel volumes found"
    fi
fi

# Remove images
if [ "$REMOVE_IMAGES" = true ]; then
    log_info "Removing images..."

    # Remove hotel-related images
    IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -i hotel || true)
    if [ -n "$IMAGES" ]; then
        echo "$IMAGES" | xargs docker rmi -f
    fi

    # Remove dangling images
    docker image prune -f
    log_success "Images removed"
fi

# Remove networks
if [ "$REMOVE_NETWORKS" = true ]; then
    log_info "Removing networks..."

    NETWORKS=$(docker network ls --format "{{.Name}}" | grep -i hotel || true)
    if [ -n "$NETWORKS" ]; then
        echo "$NETWORKS" | xargs docker network rm
    fi

    # Prune unused networks
    docker network prune -f
    log_success "Networks removed"
fi

# Show current status
echo ""
log_info "Current Docker status:"
echo ""

echo "Containers:"
docker ps -a | grep -i hotel || echo "  No hotel containers"
echo ""

echo "Volumes:"
docker volume ls | grep -i hotel || echo "  No hotel volumes"
echo ""

echo "Images:"
docker images | grep -i hotel || echo "  No hotel images"
echo ""

echo "Networks:"
docker network ls | grep -i hotel || echo "  No hotel networks"
echo ""

log_success "Cleanup completed!"

# Show disk space reclaimed
log_info "Disk space summary:"
docker system df

exit 0
