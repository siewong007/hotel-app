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
| Secrets | `/opt/saliminn/secrets.env` | `deploy.sh:18` |

### Every compose command below needs the secrets sourced

`deploy/docker-compose.prod.yml` declares `${POSTGRES_PASSWORD:?...}`, and `deploy.sh`
supplies it with `set -a; source "$SECRETS_FILE"` (`deploy.sh:161-164`) before invoking
compose. The file is named `secrets.env`, **not** `.env`, so compose does not pick it up on
its own. A bare `sudo docker compose ...` therefore aborts with
`POSTGRES_PASSWORD is required` — including at step 10, *after* the volume is gone.

Use this wrapper for every compose invocation in this runbook:

```bash
dc() {
  sudo bash -c 'set -a; source /opt/saliminn/secrets.env; set +a
    docker compose --project-name saliminn \
      -f /opt/saliminn/docker-compose.prod.yml "$@"' _ "$@"
}
```

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

# /opt/saliminn/backups is root-owned mode 0700 (deploy.sh:377). A shell redirection
# runs as *you*, not under sudo, so `sudo docker exec ... > "$DUMP"` fails with
# permission denied. Redirect inside the elevated shell instead.
sudo bash -c "docker exec saliminn-db \
  pg_dump --format=custom --no-owner --no-acl \
          -U hotel_admin hotel_management > '$DUMP'"

sudo bash -c "docker exec -i saliminn-db pg_restore --list < '$DUMP'" > /dev/null && echo "DUMP OK"
sudo ls -lh "$DUMP"
```

Expect `DUMP OK` and a non-trivial file size. If `pg_restore --list` fails, stop — a dump
that cannot be listed cannot be restored.

### 4. Record a baseline to compare against after restore

This is what proves the restore was complete, rather than merely successful.

```bash
sudo docker exec saliminn-db psql -U hotel_admin -d hotel_management -Atc "
  SELECT relname || '=' || (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname),
                        false, true, '')))[1]::text
  FROM pg_stat_user_tables
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
dc down
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
dc up -d postgres

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
# $DUMP is set in step 3; re-export it if you reconnected since.
sudo bash -c "docker exec -i saliminn-db \
  pg_restore --no-owner --no-acl --exit-on-error \
             -U hotel_admin -d hotel_management < '$DUMP'"

echo "RESTORE EXIT=$?"
```

Expect `RESTORE EXIT=0` and no output. If it fails on an extension or comment, re-run
without `--exit-on-error`, capture the errors and judge each one — but never accept a
silent partial restore.

### 12. Diff the row counts against the baseline

This is the step that actually proves the migration. Do not shorten it.

```bash
sudo docker exec saliminn-db psql -U hotel_admin -d hotel_management -Atc "
  SELECT relname || '=' || (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname),
                        false, true, '')))[1]::text
  FROM pg_stat_user_tables
  ORDER BY relname;" > /tmp/rowcounts-after.txt

diff /tmp/rowcounts-before.txt /tmp/rowcounts-after.txt && echo "ROW COUNTS MATCH"
```

These are exact `count(*)` values per table, not `n_live_tup` estimates, so no `ANALYZE`
step is needed and a diff is meaningful on its own. A real shortfall means roll back rather
than debug in place.

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
dc up -d
dc ps
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

Run `32585519355` is the Aug-22 attempt for `a1fd38e1`; re-running it now is refused by the
staleness gate (`deploy.yml:48` and the pre-flight in the deploy step both require the CI
run's sha to still be the tip of master). Re-run the deploy for the **current** master tip
instead:

```bash
SHA=$(git ls-remote origin refs/heads/master | awk '{print $1}')
RUN=$(gh run list --workflow="Deploy production" --limit 20 \
        --json databaseId,headSha --jq \
        ".[] | select(.headSha==\"$SHA\") | .databaseId" | head -1)
gh run rerun "$RUN" --failed && gh run watch "$RUN"
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
dc down
sudo docker volume rm saliminn_postgres_data
sudo docker volume create saliminn_postgres_data

sudo docker run --rm \
  -v saliminn_postgres_data:/to \
  -v /opt/saliminn/volbackup:/from:ro \
  alpine tar xf /from/pgdata-beta2.tar -C /to

# pin the image back to beta2 before starting
sudo sed -i 's/postgres:19beta3/postgres:19beta2/' /opt/saliminn/docker-compose.prod.yml
dc up -d
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

## Rehearsal result (2026-09-04)

The mechanism was rehearsed end to end in local Docker against a synthetic cluster built
from `0001_v1_baseline.sql` + `seed.sql` + patches 0002–0008 — the same initialisation
production had. It is **not** a rehearsal against production data; row counts here are seed
volumes, and the local host is arm64 while production is amd64 (catalog versions are
architecture-independent, and both matched production exactly).

- Reproduced the production failure precisely: beta3 on a beta2 volume gives the identical
  `CATALOG_VERSION_NO 202607071` -> `202607272` FATAL, container `exited`.
- Empty `docker-entrypoint-initdb.d` (step 7) left the fresh beta3 cluster at 0 tables, so
  the restore did not collide.
- `pg_restore --no-owner --no-acl --exit-on-error` returned 0 with no output.
- 108/108 tables matched on exact row counts; 71/71 sequences matched `last_value`.
- Post-restore objects present: 268 functions, 457 indexes, 40 triggers, 13 views.

What this does not cover: production data volume and dump duration, real disk headroom,
Caddy/502 behaviour during downtime, and the amd64 image.
