#!/bin/sh
# Database Backup Script for Hotel Management System

set -e

# Configuration
BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/hotel_db_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Perform backup
echo "[$(date)] Starting database backup..."
pg_dump -h postgres \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -F plain \
    --no-owner \
    --no-acl \
    | gzip > "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo "[$(date)] Backup completed successfully: ${BACKUP_FILE}"

    # Get file size
    SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo "[$(date)] Backup size: ${SIZE}"

    # Remove old backups (keep only last N days)
    echo "[$(date)] Cleaning up old backups (keeping last ${RETENTION_DAYS} days)..."
    find "${BACKUP_DIR}" -name "hotel_db_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete

    # List remaining backups
    echo "[$(date)] Current backups:"
    ls -lh "${BACKUP_DIR}"/hotel_db_backup_*.sql.gz 2>/dev/null || echo "No backups found"
else
    echo "[$(date)] ERROR: Backup failed!" >&2
    exit 1
fi
