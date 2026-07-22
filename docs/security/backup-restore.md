# Backup and restore drill

The deploy script creates a local pre-deploy PostgreSQL dump. It is a rollback
aid, not a disaster-recovery backup: a host compromise or disk loss can destroy
both the database and those local files.

## Daily off-host backup

Run this from a protected operations host after configuring a separate backup
account with immutable/versioned storage and encryption at rest. Keep the
encryption key outside the VPS and test that the operations team can retrieve
it.

```bash
docker exec saliminn-db pg_dump --format=custom --no-owner --no-acl \
  -U hotel_admin hotel_management > hotel-$(date +%F).dump
sha256sum hotel-$(date +%F).dump > hotel-$(date +%F).dump.sha256
```

Encrypt the dump, upload it to the separate backup location, verify the remote
checksum, and securely remove the local copy. Retain backups according to the
hotel's recovery-point objective; retain enough versions to recover from
delayed discovery of malicious changes.

## Quarterly restore drill

1. Select a recent off-host encrypted backup and decrypt it only on an isolated
   restore host.
2. Start a fresh PostgreSQL container with an empty volume; never restore into
   production.
3. Restore the dump with `pg_restore --clean --if-exists --no-owner`.
4. Start the same backend image against that database and check `/health`.
5. Verify a sample of bookings, ledgers, users, documents metadata, and audit
   history against the expected backup timestamp.
6. Record the elapsed recovery time, any missing data, verifier, and follow-up
   work. Update the recovery-point/recovery-time objectives when reality does
   not meet them.

Do not mark a backup policy complete merely because backups upload: a successful
isolated restore is the acceptance criterion.
