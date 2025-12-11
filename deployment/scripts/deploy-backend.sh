#!/bin/bash
set -e

VERSION=${1:-latest}
echo "=================================="
echo "Deploying backend version: $VERSION"
echo "=================================="

# Health check current version
echo "Checking current backend health..."
if curl -f http://localhost:3030/health 2>/dev/null; then
  echo "✓ Current backend is healthy"
else
  echo "⚠ Backend not currently running or unhealthy"
fi

# Build new version
echo ""
echo "Building backend image..."
BACKEND_VERSION=$VERSION docker-compose build backend

# Deploy new version
echo ""
echo "Deploying new backend..."
BACKEND_VERSION=$VERSION docker-compose up -d --no-deps backend

# Wait for health check
echo ""
echo "Waiting for backend to be healthy..."
for i in {1..30}; do
  if curl -f http://localhost:3030/health 2>/dev/null; then
    echo ""
    echo "✓ Backend is healthy!"
    echo "✓ Deployment successful!"
    exit 0
  fi
  echo -n "."
  sleep 2
done

echo ""
echo "✗ Backend failed to become healthy!"
echo "✗ Deployment may have failed. Check logs with: docker-compose logs backend"
exit 1
