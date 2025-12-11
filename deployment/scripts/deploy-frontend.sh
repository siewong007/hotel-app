#!/bin/bash
set -e

VERSION=${1:-latest}
API_URL=${REACT_APP_API_URL:-http://localhost:3030}

echo "=================================="
echo "Deploying frontend version: $VERSION"
echo "API URL: $API_URL"
echo "=================================="

# Health check current version
echo "Checking current frontend health..."
if curl -f http://localhost:3000/ 2>/dev/null; then
  echo "✓ Current frontend is healthy"
else
  echo "⚠ Frontend not currently running or unhealthy"
fi

# Build new version with correct API URL
echo ""
echo "Building frontend image..."
FRONTEND_VERSION=$VERSION \
REACT_APP_API_URL=$API_URL \
docker-compose build frontend

# Deploy new version
echo ""
echo "Deploying new frontend..."
FRONTEND_VERSION=$VERSION docker-compose up -d --no-deps frontend

# Wait for health check
echo ""
echo "Waiting for frontend to be healthy..."
for i in {1..20}; do
  if curl -f http://localhost:3000/ 2>/dev/null; then
    echo ""
    echo "✓ Frontend is healthy!"
    echo "✓ Deployment successful!"
    exit 0
  fi
  echo -n "."
  sleep 2
done

echo ""
echo "✗ Frontend failed to become healthy!"
echo "✗ Deployment may have failed. Check logs with: docker-compose logs frontend"
exit 1
