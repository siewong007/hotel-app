# PostgreSQL 19beta2 → 19beta3 Cutover

Runbook for migrating the live `hotel_management` database by dump and restore. The
catalog version changed between betas, so there is no in-place upgrade path — the data
directory has to be rebuilt.

Derived from `deploy/deploy.sh`, `deploy/docker-compose.prod.yml` and
`deploy/database-backup.sh` at commit `a1fd38e1`, plus the failure log of deploy run
`32585519355`. Commands assume the Lightsail host as `ubuntu` with `sudo`.

**Status at time of writing:** production healthy on beta2, deploys blocked, no data lost.
Expected downtime for the cutover is 10–20 minutes.

## Why this is necessary

Deploy run `32585519355` pulled `postgres:19beta3` against the existing beta2 data
directory. The server refused to start, the health check failed, and `deploy.sh` rolled
back cleanly.

```
saliminn-db  | FATAL:  database files are incompatible with server
saliminn-db  | DETAIL:  The database cluster was initialized with CATALOG_VERSION_NO 202607071,
saliminn-db  |          but the server was compiled with CATALOG_VERSION_NO 202607272.
saliminn-db  | HINT:  It looks like you need to initdb.
```

`deploy/docker-compose.prod.yml` and `deploy/deploy.sh` both pin `postgres:19beta3`. Until
the data directory matches, **every deploy fails at this same step** — this is not specific
to any one commit.

The beta3 bump was verified against a *disposable* beta3 container (fresh initdb, full
suite green), which is why the incompatibility did not surface until a deploy met an
existing data directory.

## The trap that shapes this plan

The prod compose bind-mounts `/opt/saliminn/initdb` into `docker-entrypoint-initdb.d`.
Those scripts — `01-v1-baseline.sql` and `02-seed.sql` — run automatically **whenever the
volume is empty**.

A fresh beta3 volume therefore self-initialises into a fully seeded schema, and restoring
the production dump on top collides on every table and seeded row. Step 7 moves the
directory aside so the new cluster comes up empty. **Do not skip it.**

## What you are working with

| Item | Value | Source |
|---|---|---|
| Compose project | `saliminn` | `deploy.sh:285` |
| Volume | `saliminn_postgres_data` | project + volume name |
| Container | `saliminn-db` | prod compose |
| Role / database | `hotel_admin` / `hotel_management` | prod compose |
| Mount point | `/var/lib/postgresql` | PG19 versioned layout |
| App directory | `/opt/saliminn` | `deploy.sh:15` |
| Backups | `/opt/saliminn/backups` | `deploy.sh:22` |

The failed deploy already wrote a verified custom-format dump before it touched anything
(`/opt/saliminn/backups/predeploy-*.dump`, checked with `pg_restore --list`). Step 3 takes
a fresh one anyway, because the database has served traffic since.

---

## Phase 1 — Capture

Nothing changes on the host. Every step here is reversible by walking away.

### 1. Connect and confirm the current state

```bash
ssh ubuntu@13.251.162.88
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker exec saliminn-db psql -U hotel_admin -d hotel_management -c 'SELECT version();'
```

Expect `saliminn-db` running `postgres:19beta2`, healthy. If it already reports beta3,
stop — the situation is not what this runbook assumes.

### 2. Check free disk before writing two copies

```bash
df -h /
docker system df -v | grep saliminn_postgres_data
```

You need headroom for a logical dump *and* a full tarball of the volume. `deploy.sh`
requires 6 GiB free for its own rollback path; keep at least that much after both land.

### 3. Take a fresh logical dump and prove it restores

Same flags the nightly job uses, so the artifact is interchangeable with existing backups.

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP=/opt/saliminn/backups/cutover-$TS.dump

sudo docker exec saliminn-db \
  pg_dump --format=custom --no-owner --no-acl \
          -U hotel_admin hotel_management > "$DUMP"

sudo docker exec -i saliminn-db pg_restore --list < "$DUMP" > /dev/null && echo "DUMP OK"
ls -lh "$DUMP"
```

Expect `DUMP OK` and a non-trivial file size. If `pg_restore --list` fails, stop — a dump
that cannot be listed cannot be restored.

### 4. Record a baseline to compare against after restore

This is what proves the restore was complete, rather than merely successful.

```bash
sudo docker exec saliminn-db psql -U hotel_admin -d hotel_management -Atc "
  SELECT relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY relname;" | tee /tmp/rowcounts-before.txt
```

Keep this file. Step 12 diffs against it.

### 5. Copy the dump off the host

Off-host shipping is still a manual step on this deployment. Do it before, not after.

```bash
# from your laptop
scp ubuntu@13.251.162.88:/opt/saliminn/backups/cutover-*.dump ./
```

---

## Phase 2 — Cutover

Downtime begins here. The site returns 502 through Caddy until phase 4 completes.

### 6. Stop the stack, leaving the volume intact

```bash
cd /opt/saliminn
sudo docker compose --project-name saliminn -f docker-compose.prod.yml down
```

Plain `down` with **no `-v`**. The volume must survive this step — it is your physical
rollback.

### 7. Neutralise the auto-init scripts

Without this, the fresh volume seeds itself and the restore collides.

```bash
sudo mv /opt/saliminn/initdb /opt/saliminn/initdb.hold
sudo install -d -m 0755 /opt/saliminn/initdb
ls -la /opt/saliminn/initdb
```

Expect an empty directory. The bind mount still resolves, but there is nothing for the
entrypoint to run.

### 8. Tarball the beta2 volume — the second recovery path

Independent of the logical dump. If the restore misbehaves, this puts the old cluster back
byte for byte.

```bash
sudo install -d -m 0700 /opt/saliminn/volbackup

sudo docker run --rm \
  -v saliminn_postgres_data:/from:ro \
  -v /opt/saliminn/volbackup:/to \
  alpine tar cf /to/pgdata-beta2.tar -C /from .

sudo tar tf /opt/saliminn/volbackup/pgdata-beta2.tar | head
ls -lh /opt/saliminn/volbackup/pgdata-beta2.tar
```

If `tar tf` errors, stop and do not proceed to step 9.

### 9. Remove the beta2 volume — point of no return

Only run this once steps 3 and 8 have both reported success.

```bash
sudo docker volume rm saliminn_postgres_data
sudo docker volume ls | grep saliminn
```

Recovery from here is via the tarball (step 8) or the dump (step 3).

### 10. Bring up postgres alone on beta3

Database only — the backend must not connect to an empty schema.

```bash
cd /opt/saliminn
sudo docker compose --project-name saliminn -f docker-compose.prod.yml up -d postgres

sleep 15
sudo docker logs saliminn-db --tail 30
sudo docker exec saliminn-db psql -U hotel_admin -d hotel_management -c 'SELECT version();'
```

Expect a normal init and version 19beta3. If you see baseline or seed SQL executing, step 7
did not take effect — stop, tear down, and redo it.

---

## Phase 3 — Restore

### 11. Restore the dump

```bash
sudo docker exec -i saliminn-db \
  pg_restore --no-owner --no-acl --exit-on-error \
             -U hotel_admin -d hotel_management < "$DUMP"

echo "RESTORE EXIT=$?"
```

Expect `RESTORE EXIT=0` and no output. If it fails on an extension or comment, re-run
without `--exit-on-error`, capture the errors and judge each one — but never accept a
silent partial restore.

### 12. Diff the row counts against the baseline

This is the step that actually proves the migration. Do not shorten it.

```bash
sudo docker exec saliminn-db psql -U hotel_admin -d hotel_management -Atc "
  SELECT relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY relname;" > /tmp/rowcounts-after.txt

diff /tmp/rowcounts-before.txt /tmp/rowcounts-after.txt && echo "ROW COUNTS MATCH"
```

Statistics can lag — if a table looks short, run `ANALYZE;` and re-check before concluding
anything. A real shortfall means roll back rather than debug in place.

### 13. Spot-check money and sequences

Sequences out of step collide on the next insert, which is worse than a visible failure.

```bash
sudo docker exec saliminn-db psql -U hotel_admin -d hotel_management -c "
  SELECT count(*) AS bookings FROM bookings;
  SELECT count(*) AS ledgers  FROM customer_ledgers;
  SELECT count(*) AS payments FROM payments;
  SELECT max(id) AS max_booking_id FROM bookings;
  SELECT last_value FROM bookings_id_seq;"
```

Expect `last_value >= max_booking_id` and counts matching the baseline.

### 14. Put the init scripts back

The next deploy reinstalls these anyway, but leave the host consistent.

```bash
sudo rmdir /opt/saliminn/initdb
sudo mv /opt/saliminn/initdb.hold /opt/saliminn/initdb
ls -la /opt/saliminn/initdb
```

They stay inert — the volume is no longer empty.

---

## Phase 4 — Return to service

### 15. Start the full stack

```bash
cd /opt/saliminn
sudo docker compose --project-name saliminn -f docker-compose.prod.yml up -d
sudo docker compose --project-name saliminn -f docker-compose.prod.yml ps
```

Expect `saliminn-db`, `saliminn-backend` and `saliminn-frontend` all healthy.

### 16. Smoke-test through Caddy, not just the container

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://saliminn.my/
curl -fsS https://saliminn.my/health
```

Expect `200` and `{"status":"ok"}`. `/health` is top level, not under `/api`, and Caddy
proxies it explicitly. The handler runs `SELECT 1`, so this proves connectivity only —
data integrity was steps 12–13. Then log in through the browser and open a booking.

### 17. Re-run the deploy that was blocked

Confirms the pipeline is unblocked, not merely that the database is up.

```bash
gh run rerun 32585519355 --failed
gh run watch 32585519355
```

### 18. Retire the tarball once confident

Not the same day. Give it a full business cycle, then reclaim the space.

```bash
sudo rm -f /opt/saliminn/volbackup/pgdata-beta2.tar
sudo rmdir /opt/saliminn/volbackup
```

Keep the `cutover-*.dump` — it falls under normal retention.

---

## Rollback

Two independent paths. Both assume the stack is stopped.

**Path A — physical, from the tarball.** Fastest and exact.

```bash
cd /opt/saliminn
sudo docker compose --project-name saliminn -f docker-compose.prod.yml down
sudo docker volume rm saliminn_postgres_data
sudo docker volume create saliminn_postgres_data

sudo docker run --rm \
  -v saliminn_postgres_data:/to \
  -v /opt/saliminn/volbackup:/from:ro \
  alpine tar xf /from/pgdata-beta2.tar -C /to

# pin the image back to beta2 before starting
sudo sed -i 's/postgres:19beta3/postgres:19beta2/' /opt/saliminn/docker-compose.prod.yml
sudo docker compose --project-name saliminn -f docker-compose.prod.yml up -d
```

**Path B — logical, from the dump.** Use if the tarball is unusable: rebuild a beta2
volume, let the init scripts create the schema, then restore over it.

Path A edits the compose file on the host only. That change is overwritten by the next
deploy, which reinstalls `docker-compose.prod.yml` from the release bundle — so a
host-level revert is a stopgap, not a fix. To hold on beta2 for longer, revert the pin in
the repository instead.

## Afterwards

Two follow-ups this cutover does not cover.

- **Desktop bundle.** `CONFIGURED_POSTGRES_BUILD_IDENTITY` in
  `hotel-desktop/src-tauri/src/postgres.rs` is still `19beta2`, and
  `provision-pgsql.mjs` `readExpectedVersion()` reads it directly and refuses a
  mismatched `POSTGRES_PREFIX` build. Bump it together with
  `.github/workflows/desktop-build.yml` in a desktop release, never separately.
- **19 GA.** This exact drill repeats when 19 leaves beta. Beta on-disk formats have no
  supported upgrade path to GA, so the dump-and-restore is mandatory then regardless.

## Unverified

This runbook has not been rehearsed against a scratch copy of production. For certainty
before the real cutover, restore `cutover-*.dump` into a throwaway beta3 container and run
steps 11–13 against it — that exercises the risky part with no production exposure.
