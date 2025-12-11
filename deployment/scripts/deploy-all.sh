#!/bin/bash
set -e

VERSION=${1:-latest}

echo "========================================="
echo "Full Hotel App Deployment"
echo "Version: $VERSION"
echo "========================================="

# Build all services
echo ""
echo "Step 1: Building all services..."
BACKEND_VERSION=$VERSION \
FRONTEND_VERSION=$VERSION \
docker-compose build

# Stop services gracefully
echo ""
echo "Step 2: Stopping existing services..."
docker-compose stop

# Start database first
echo ""
echo "Step 3: Starting PostgreSQL database..."
docker-compose up -d postgres
echo "Waiting for database to be ready..."
sleep 10

# Run migrations
echo ""
echo "Step 4: Running database migrations..."
if docker-compose --profile migration run --rm db-migrator 2>/dev/null; then
  echo "✓ Migrations completed successfully"
else
  echo "⚠ No migrations to run or migration service not configured"
fi

# Start backend
echo ""
echo "Step 5: Starting backend API..."
docker-compose up -d backend
echo "Waiting for backend to initialize..."
sleep 5

# Start frontend
echo ""
echo "Step 6: Starting frontend..."
docker-compose up -d frontend
echo "Waiting for frontend to initialize..."
sleep 3

# Run health checks
echo ""
echo "Step 7: Running health checks..."
./deployment/scripts/health-check.sh

echo ""
echo "========================================="
echo "✓ Deployment complete!"
echo "========================================="
echo ""
echo "Services:"
echo "  - Frontend: http://localhost:3000"
echo "  - Backend API: http://localhost:3030"
echo "  - PostgreSQL: localhost:5433"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To check status: docker-compose ps"
