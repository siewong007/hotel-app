# Desktop Backup & Restore

The desktop app manages its own backup lifecycle — no cron, no manual pg_dump.

These managed pairs are a different artifact from the `hotel-backup` v1
**JSON** export on the same `/data-transfer` page: the JSON format carries
business data only and restores through the staged data-transfer pipeline
(see [data-transfer.md](data-transfer.md)). A managed pair is a full
logical dump of the bundled PostgreSQL plus its upload trees — the recovery
point for the whole desktop install.

## What a backup is

Each backup is a pair in `<data dir>/backups/`:

- `hotel-backup-YYYYMMDD-HHMMSS.dump` — custom-format `pg_dump` of the whole
  `hotel_management` database, verified with `pg_restore --list` at creation.
- `hotel-backup-YYYYMMDD-HHMMSS-uploads.tar.gz` — `uploads/` + `private_uploads/`
  (eKYC images, payment receipts, room photos) when any existed. Newest 14 pairs
  are kept; older ones are pruned automatically.

The data dir is `~/Library/Application Support/HotelApp` (macOS),
`%LOCALAPPDATA%\HotelApp` (Windows), `~/.local/share/HotelApp` (Linux).

## Schedule

First backup ~2 minutes after services come up, then every 24 h
(`FIRST_BACKUP_DELAY_SECS` / `BACKUP_INTERVAL_SECS` in `src-tauri/src/lib.rs`).
Failures log and retry next cycle; they never crash the app.

## In-app controls

`/data-transfer` → "Local backups" card (desktop builds only): list, back up
now, restore, open the backups folder. Off-app copies = copy files out of the
opened folder — arbitrary destination paths are refused by design
(`ensure_within_data_dir`).

## Recovery procedures

### Same-version restore (corruption, bad data day)

In-app: Local backups card → Restore → confirm → the app restarts itself.
CLI equivalent (postgres stopped or running — pg_restore handles it):

    pg_restore -h localhost -p 5433 -U hotel_admin -d hotel_management \
      --clean --if-exists --no-owner --no-privileges \
      ~/Library/Application\ Support/HotelApp/backups/hotel-backup-<ts>.dump
    tar -xzf ~/Library/Application\ Support/HotelApp/backups/hotel-backup-<ts>-uploads.tar.gz \
      -C ~/Library/Application\ Support/HotelApp/

The bundled binaries live under the app's `pgsql/bin` resource dir; any
matching-version `pg_restore` works. Every in-app restore first writes a
`hotel-backup-<now>.dump` safety backup — restoring *that* file rolls back a
restore.

### Major-version upgrade (new postgres build refuses the old data dir)

Automatic: the app detects the mismatch and offers "Restore from backup" at
startup (see `upgrade_database_from_backup`). The old `pgdata` is renamed
`pgdata-pg<ver>-retired-<ts>` — never deleted.

### Bare-metal / new machine

1. Install the app, let it initialize once, quit.
2. Replace `<data dir>/backups/` contents with the saved pair(s).
3. Start the app → Local backups → Restore the newest pair.
   (Or drop the pair anywhere and run the CLI form above.)
4. `pgdata` itself is NOT portable across versions — always move the logical
   backup, not the data directory.

### What is NOT covered

`pgdata` corruption *between* backups (latest dump wins — up to 24 h of writes
can be lost; shorten `BACKUP_INTERVAL_SECS` or back up before risky work), files
written outside the data dir, and anything the user never backed up before a
disk failure. Off-app copies are the real disaster-recovery story — the backups
folder is one filesystem.

Developer note: dev builds that ran before the sidecar's working directory
moved into the data dir may have left stray `uploads/`/`private_uploads/`
trees wherever the app was launched from. Those orphans belong to no backup
pair — verify the live trees under `<data dir>/` are intact, then delete the
strays.
