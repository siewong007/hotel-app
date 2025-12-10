#!/bin/sh
# Database Restore Script for Hotel Management System

set -e

BACKUP_DIR="/backups"

# Check if backup file is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file>"
    echo ""
    echo "Available backups:"
    ls -lh "${BACKUP_DIR}"/hotel_db_backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if file exists
if [ ! -f "${BACKUP_FILE}" ]; then
    echo "ERROR: Backup file not found: ${BACKUP_FILE}"
    exit 1
fi

echo "[$(date)] Starting database restore from: ${BACKUP_FILE}"
echo "WARNING: This will overwrite the current database!"
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

# Restore database
echo "[$(date)] Restoring database..."
gunzip -c "${BACKUP_FILE}" | psql -h postgres \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}"

if [ $? -eq 0 ]; then
    echo "[$(date)] Database restored successfully!"
else
    echo "[$(date)] ERROR: Restore failed!" >&2
    exit 1
fi
