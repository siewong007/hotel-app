#!/bin/sh
set -e

echo "======================================="
echo "Running database migrations..."
echo "======================================="

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h $PGHOST -p $PGPORT -U $PGUSER; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "✓ PostgreSQL is ready"
echo ""

# Check if migrations directory exists and has files
if [ ! -d "/migrations" ] || [ -z "$(ls -A /migrations/*.sql 2>/dev/null)" ]; then
  echo "⚠ No migration files found in /migrations"
  echo "Skipping migrations..."
  exit 0
fi

# Run each migration file in order
echo "Executing migration files..."
for migration in /migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "Running migration: $(basename $migration)"
    psql -v ON_ERROR_STOP=1 --username "$PGUSER" --dbname "$PGDATABASE" -f "$migration"
    echo "✓ $(basename $migration) completed"
  fi
done

echo ""
echo "======================================="
echo "✓ All migrations completed successfully!"
echo "======================================="
