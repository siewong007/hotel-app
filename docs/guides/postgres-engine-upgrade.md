# PostgreSQL Engine Upgrade (Dump and Restore)

This runbook moves the hotel database to a PostgreSQL build that cannot read
the existing data directory: one beta to the next, beta to GA, or a major
version. It works by dump and restore into a fresh volume. **Next planned use:
the PostgreSQL 19 GA move**, targeted for October 2026 (go-live checklist row
5). Beta on-disk formats have no supported upgrade path to GA, so the GA move
needs this procedure too. It first needs patches 0015 and 0016 applied on
beta3 (see the prerequisite below).

Written for the AIC host ([`vps-access.md`](vps-access.md)). Every command runs
as `root` on the host, where `docker` takes no `sudo`. Rehearse on staging
first (same host, `STACK=saliminn-staging`), then repeat on production.

**History.** First executed 2026-09-04 for 19beta2 → 19beta3, on the former
Lightsail host. Downtime was about 10 minutes. 108/108 tables matched exact
row counts and 71/71 sequences matched `last_value`. Two traps were hit for
real, and both are written into the steps below: compose needed `IMAGE_TAG`,
and a rolled-back host's compose file still pinned the old image. That
Lightsail-specific runbook was retired on 2026-10-05; recover it with
`git log --all -- docs/guides/postgres-beta3-cutover.md`.

## Prerequisite for 19beta4, RC, and GA: patches 0015 and 0016 on beta3

PostgreSQL 19 Beta 4 (released 2026-09-24) **reverted** SQL/PGQ, `ALTER TABLE …
SPLIT/MERGE PARTITION`, `FOR PORTION OF`, online data-checksum toggling, and
`pg_get_{role,tablespace,database}_ddl()`. The release candidate and GA keep
those reverts. The schema used two of them:

- **SQL/PGQ:** the V1 baseline created `public.hotel_graph`. Patch 0015 drops
  it, and the baseline no longer creates it.
- **`SPLIT PARTITION`:** `ensure_audit_logs_partition` ran it, behind
  `EXECUTE`, when a month's partition arrived after its rows. So the baseline
  still installed on beta4, but the daily partition upkeep failed at runtime.
  Patch 0016 rebuilds late partitions without it.

Both patches landed on 2026-10-06, and nothing in the repository uses any of
the other reverted features. A 2026-10-05 check missed `SPLIT PARTITION`
because it grepped the release notes' plural spelling, so grep a feature's own
SQL syntax.

**Both patches must be applied while the database still runs 19beta3**, before
step 3's dump. A beta3 dump that still holds the graph fails to restore on
beta4 or later. Check on the stack you are about to move:

```bash
docker exec "$DB" psql -U hotel_admin -d hotel_management -Atc "
  SELECT string_agg(version::text, ',' ORDER BY version) FROM hotel_schema_revisions
   WHERE generation = 1 AND version IN (15, 16);
  SELECT count(*) FROM pg_class WHERE relkind = 'g';"
```

Expect `15,16` and `0`. A backup taken before 0015 can still be restored onto
beta4 or later with the graph's TOC entry filtered out:
`pg_restore -l <dump> | grep -v 'PROPERTY GRAPH' > list.txt`, then
`pg_restore -L list.txt …`.

## Why the data directory has to be rebuilt

Starting a newer image on an older data directory fails at once, and the
deploy health check then rolls the release back:

```
FATAL:  database files are incompatible with server
DETAIL:  The database cluster was initialized with CATALOG_VERSION_NO 202607071,
         but the server was compiled with CATALOG_VERSION_NO 202607272.
HINT:  It looks like you need to initdb.
```

Until the data directory matches the image, **every deploy fails at this same
step**. The cause is not specific to any one commit. Testing the new image
against a *disposable* container proves nothing here, because a fresh initdb
always works.

## The trap that shapes this procedure

Both compose files bind-mount `/opt/<stack>/initdb` into
`docker-entrypoint-initdb.d`. The official image runs those scripts
(`01-v1-baseline.sql`, `02-seed.sql`) **whenever the volume is empty**. A fresh
volume would therefore initialise itself into a full schema, and restoring
the dump on top would collide on every table and seeded row. Step 7 moves the
directory aside so the new cluster comes up empty. **Do not skip it.**

## What you are working with

| Item | Production | Staging |
|---|---|---|
| `STACK` (Compose project, `/opt/$STACK`) | `saliminn` | `saliminn-staging` |
| DB container | `saliminn-db` | `saliminn-staging-db` |
| Volume | `saliminn_postgres_data` | `saliminn-staging_postgres_data` |
| Compose file on host | `/opt/saliminn/docker-compose.prod.yml` | `/opt/saliminn-staging/docker-compose.prod.yml` |
| Role / database | `hotel_admin` / `hotel_management` | `hotel_admin` / `hotel_management` |
| Mount point | `/var/lib/postgresql` | `/var/lib/postgresql` |

Set these once per shell, for the stack you are working on:

```bash
STACK=saliminn          # or saliminn-staging for the rehearsal
DB=${STACK}-db          # saliminn-db / saliminn-staging-db
VOL=${STACK}_postgres_data
```

### Every compose command needs the secrets sourced

The compose files declare `${POSTGRES_PASSWORD:?…}` and
`image: "saliminn-backend:${IMAGE_TAG:?…}"`. `deploy.sh` supplies both:
`secrets.env` holds the password, and `current-tag` holds the tag. Because the
file is named `secrets.env`, not `.env`, compose never reads it on its own. A
bare `docker compose …` therefore aborts, including at step 10 when the old
volume is already gone. Use this wrapper. It runs in a subshell, so the
secrets never land in your interactive shell:

```bash
dc() (
  set -a; . "/opt/$STACK/secrets.env"; set +a
  IMAGE_TAG=$(cat "/opt/$STACK/current-tag") \
    docker compose --project-name "$STACK" -f "/opt/$STACK/docker-compose.prod.yml" "$@"
)
```

### Decide how the new image gets pinned

Step 10 needs the host's compose file to name the **new** image. It gets
there in one of two ways:

- The release that bumps the pins has already been deployed. It failed at
  database start and rolled back, which is what happened in 2026-09. After
  that rollback the host's compose file is the **previous** release's copy and
  can still pin the old image. Step 10 checks for this.
- Or you edit the pin on the host by hand. This is temporary: the next deploy
  reinstalls the compose file from its release bundle.

Either way, the repository change bumps every pin together: the compose files,
`deploy/deploy{,-staging}.sh` `POSTGRES_IMAGE`, and the CI service images. The
desktop bundle is a separate release; see [Afterwards](#afterwards).

---

## Phase 1 — Capture

Nothing on the host changes in this phase. You can walk away from any step.

### 1. Connect and confirm the current state

Connect with the SSH command in [`vps-access.md`](vps-access.md), then:

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker exec "$DB" psql -U hotel_admin -d hotel_management -c 'SELECT version();'
```

Expect `$DB` to be healthy and on the **old** version. If it already reports
the new one, stop: the host is not in the state this runbook assumes.

### 2. Check free disk before writing two copies

```bash
df -h /opt
docker system df -v | grep "$VOL"
```

You need room for a logical dump *and* a tarball of the volume. The database
itself is small (about 85 MB in 2026-09). `deploy.sh` refuses to run with less
than 6 GiB free, so keep at least that much after both copies exist.

### 3. Take a fresh logical dump and prove it restores

These are the same flags the nightly backup uses, so the file is
interchangeable with existing backups.

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP=/opt/$STACK/backups/cutover-$TS.dump

docker exec "$DB" pg_dump --format=custom --no-owner --no-acl \
  -U hotel_admin hotel_management > "$DUMP"

docker exec -i "$DB" pg_restore --list < "$DUMP" > /dev/null && echo "DUMP OK"
ls -lh "$DUMP"
```

Expect `DUMP OK` and a non-trivial size. If `pg_restore --list` fails, stop:
a dump that cannot be listed cannot be restored.

### 4. Record a baseline to compare against after the restore

This is the step that later proves the restore was *complete*, not merely
successful.

```bash
docker exec "$DB" psql -U hotel_admin -d hotel_management -Atc "
  SELECT relname || '=' || (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname),
                        false, true, '')))[1]::text
  FROM pg_stat_user_tables
  ORDER BY relname;" | tee /root/rowcounts-before.txt
```

Keep this file; step 12 diffs against it.

### 5. Copy the dump off the host

Backups normally stay on the host, by owner decision. For a cutover, still
take one copy away before anything is destroyed. From your workstation, in
the repository root:

```bash
scp -P 20049 -i deploy/credentials/aic-vps-ed25519 -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=deploy/credentials/aic-known-hosts \
  "root@162.19.81.122:/opt/saliminn/backups/cutover-*.dump" ./
```

---

## Phase 2 — Cutover

Downtime starts here. Until phase 4 completes, the site returns 502 through
Caddy.

### 6. Stop the stack, leaving the volume intact

```bash
dc down
```

Use a plain `down`, **without `-v`**. The volume must survive this step,
because it is your physical rollback.

### 7. Neutralise the auto-init scripts

```bash
mv "/opt/$STACK/initdb" "/opt/$STACK/initdb.hold"
install -d -m 0755 "/opt/$STACK/initdb"
ls -la "/opt/$STACK/initdb"
```

Expect an empty directory. The bind mount still resolves, but the entrypoint
finds nothing to run.

### 8. Tarball the old volume (the second recovery path)

This is independent of the logical dump. If the restore misbehaves, the
tarball puts the old cluster back byte for byte.

```bash
install -d -m 0700 "/opt/$STACK/volbackup"
docker run --rm -v "$VOL":/from:ro -v "/opt/$STACK/volbackup":/to \
  alpine tar cf /to/pgdata-old.tar -C /from .
tar tf "/opt/$STACK/volbackup/pgdata-old.tar" | head
ls -lh "/opt/$STACK/volbackup/pgdata-old.tar"
```

If `tar tf` errors, stop. Do not continue to step 9.

### 9. Remove the old volume (point of no return)

Run this only after steps 3 and 8 have both reported success.

```bash
docker volume rm "$VOL"
docker volume ls | grep "$STACK"
```

From here, recovery goes through the tarball (step 8) or the dump (step 3).

### 10. Bring up PostgreSQL alone on the new image

Start only the database. The backend must never connect to an empty schema.

```bash
dc up -d postgres
sleep 15
docker logs "$DB" --tail 30
docker exec "$DB" psql -U hotel_admin -d hotel_management -c 'SELECT version();'
```

Expect a normal init and the **new** version. If baseline or seed SQL ran,
step 7 did not take effect: stop, tear down, and redo it.

**Read the reported version; do not assume it.** If the container reports the
old version, the compose file on the host still pins the old image (see
*Decide how the new image gets pinned*), and the empty volume was just
initialised by the old engine. Restoring into it would rebuild the original
problem. Recover like this, replacing the two image names:

```bash
dc down
docker volume rm "$VOL"     # empty; nothing to lose
cp -a "/opt/$STACK/docker-compose.prod.yml" "/opt/$STACK/docker-compose.prod.yml.pre-cutover"
sed -i 's|^\( *image: \)postgres:OLD *$|\1postgres:NEW|' "/opt/$STACK/docker-compose.prod.yml"
dc up -d postgres
```

Then check `SELECT version();` again before continuing.

---

## Phase 3 — Restore

### 11. Restore the dump

```bash
# $DUMP was set in step 3; set it again if you reconnected since.
docker exec -i "$DB" pg_restore --no-owner --no-acl --exit-on-error \
  -U hotel_admin -d hotel_management < "$DUMP"
echo "RESTORE EXIT=$?"
```

Expect `RESTORE EXIT=0` and no output. If it fails on an extension or a
comment, run it again without `--exit-on-error`, capture the errors, and judge
each one. Never accept a silent partial restore.

### 12. Diff the row counts against the baseline

This is the step that proves the migration. Do not shorten it.

```bash
docker exec "$DB" psql -U hotel_admin -d hotel_management -Atc "
  SELECT relname || '=' || (xpath('/row/c/text()',
           query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname),
                        false, true, '')))[1]::text
  FROM pg_stat_user_tables
  ORDER BY relname;" > /root/rowcounts-after.txt
diff /root/rowcounts-before.txt /root/rowcounts-after.txt && echo "ROW COUNTS MATCH"
```

These are exact `count(*)` values, not `n_live_tup` estimates, so the diff is
meaningful on its own. If any table comes up short, roll back rather than
debugging in place.

### 13. Spot-check money tables, sequences, and the schema revision

A sequence that is behind will collide on the next insert, which is worse
than a visible failure.

```bash
docker exec "$DB" psql -U hotel_admin -d hotel_management -c "
  SELECT count(*) AS bookings FROM bookings;
  SELECT count(*) AS ledgers  FROM customer_ledgers;
  SELECT count(*) AS payments FROM payments;
  SELECT max(id) AS max_booking_id FROM bookings;
  SELECT last_value FROM bookings_id_seq;
  SELECT max(version) AS schema_revision FROM hotel_schema_revisions WHERE generation = 1;"
```

Expect `last_value >= max_booking_id`, counts that match the baseline, and the
same schema revision as before. The backend refuses to start on a missing
revision.

### 14. Put the init scripts back

```bash
rmdir "/opt/$STACK/initdb"
mv "/opt/$STACK/initdb.hold" "/opt/$STACK/initdb"
```

They stay inert, because the volume is no longer empty.

---

## Phase 4 — Return to service

### 15. Start the full stack

```bash
dc up -d
dc ps
```

Expect the db, backend and frontend containers all to be healthy.

### 16. Smoke-test through Caddy, not just the container

```bash
curl -fsSL -o /dev/null -w '%{http_code}\n' https://saliminn.my/   # staging: staging.saliminn.my (basic auth)
curl -fsS https://saliminn.my/health
```

Expect `200`. The site root answers a cookie-less request with a 302 to the
landing page, which is why `-L` is there. `/health` should return
`{"status":"ok"}`. Its handler runs `SELECT 1`, so it proves connectivity only;
data integrity was steps 12–13. Then log in through the browser and open a
booking.

### 17. Deploy the current master

This confirms the pipeline is unblocked, not merely that the database is up.
Deploys run only from a successful CI run on the **tip** of master, so re-run
the deploy for the current tip, identified by its full SHA:

```bash
SHA=$(git ls-remote origin refs/heads/master | awk '{print $1}')
RUN=$(gh run list --workflow="Deploy production" --limit 20 \
        --json databaseId,headSha --jq ".[] | select(.headSha==\"$SHA\") | .databaseId" | head -1)
gh run rerun "$RUN" --failed && gh run watch "$RUN"
```

Check the **job** conclusion, not only the run's. A green run can contain
skipped jobs.

### 18. Retire the tarball once confident

Not on the same day. Wait a full business cycle, then reclaim the space:

```bash
rm -f "/opt/$STACK/volbackup/pgdata-old.tar" && rmdir "/opt/$STACK/volbackup"
```

Keep the `cutover-*.dump`; it falls under normal backup retention.

---

## Rollback

There are two independent paths. Both assume the stack is stopped (`dc down`).

**Path A: physical, from the tarball.** The fastest, and exact.

```bash
docker volume rm "$VOL"
docker volume create "$VOL"
docker run --rm -v "$VOL":/to -v "/opt/$STACK/volbackup":/from:ro \
  alpine tar xf /from/pgdata-old.tar -C /to
# pin the OLD image again before starting
sed -i 's|^\( *image: \)postgres:NEW *$|\1postgres:OLD|' "/opt/$STACK/docker-compose.prod.yml"
dc up -d
```

**Path B: logical, from the dump.** Use this if the tarball is unusable.
Create a fresh volume on the old image, keep `initdb` neutralised (step 7),
then restore the dump as in step 11.

Both paths edit the compose file on the host only, and the next deploy
overwrites it. To stay on the old engine for longer, revert the pin in the
repository too.

## Afterwards

- **Desktop bundle.** The desktop ships its own PostgreSQL. Its
  `CONFIGURED_POSTGRES_BUILD_IDENTITY` in
  `hotel-desktop/src-tauri/src/postgres.rs` still reads `19beta2`.
  `provision-pgsql.mjs` reads that constant and refuses a mismatched build.
  Bump it, the provisioned binaries, and `.github/workflows/desktop-build.yml`
  together in one desktop release. On first start after that update, the app
  sees the old data directory, offers "Restore from backup", and retires the
  old `pgdata` rather than deleting it
  ([`desktop-backup-restore.md`](desktop-backup-restore.md#major-version-upgrade-new-postgres-build-refuses-the-old-data-dir)).
  That only works if a recent managed backup exists, so say so in the release
  notes.
- **Pins left behind.** After the GA move, grep for the old tag
  (`git grep -n "postgres:19beta"`) and update
  [`../ongoing-dev.md`](../ongoing-dev.md) and the go-live checklist.
