#!/bin/bash

echo "======================================="
echo "Health Check - Hotel Management System"
echo "======================================="
echo ""

check_service() {
  local service=$1
  local url=$2
  local max_attempts=30

  echo "Checking $service..."
  for i in $(seq 1 $max_attempts); do
    if curl -f "$url" > /dev/null 2>&1; then
      echo "✓ $service is healthy"
      return 0
    fi
    if [ $i -eq $max_attempts ]; then
      break
    fi
    sleep 2
  done

  echo "✗ $service failed health check"
  return 1
}

# Check all services
ALL_HEALTHY=true

# Check PostgreSQL
echo "Checking PostgreSQL..."
if docker-compose exec -T postgres pg_isready -U hotel_admin > /dev/null 2>&1; then
  echo "✓ PostgreSQL is healthy"
else
  echo "✗ PostgreSQL failed health check"
  ALL_HEALTHY=false
fi

# Check Backend
if ! check_service "Backend API" "http://localhost:3030/health"; then
  ALL_HEALTHY=false
fi

# Check Frontend
if ! check_service "Frontend" "http://localhost:3000/"; then
  ALL_HEALTHY=false
fi

echo ""
echo "======================================="
if [ "$ALL_HEALTHY" = true ]; then
  echo "✓ All services are healthy!"
  echo "======================================="
  exit 0
else
  echo "✗ Some services are unhealthy"
  echo "======================================="
  echo ""
  echo "To check service status: docker-compose ps"
  echo "To view logs: docker-compose logs <service-name>"
  exit 1
fi
