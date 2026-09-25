# VPS Access Guide

This project shares a production VPS with the payroll and online-shopping
services. Use the dedicated local administrator key in `deploy/credentials/`; do
not use the GitHub Actions deployment key for interactive maintenance.

Migrated from AWS Lightsail to AIC cloud on 2026-09-05. The Lightsail box and
every other AWS resource were deleted on 2026-09-25, so **this host is the only
copy of all four stacks and of their backups** — there is no rollback target.
See "Backups" below.

## Connection details

- Provider: AIC cloud (Proxmox LXC container, `vps-av1w`)
- Public IPv4: **none of its own.** `162.19.81.122` is shared with other
  tenants; only port `20049` forwards to this container's sshd. Ports 80/443 on
  that address belong to somebody else's Caddy.
- Public IPv6: `2001:41d0:306:277a::2450` — this is the real address of the
  host, and what Cloudflare proxies to. The address is a `/128` on an LXC
  veth. Duplicate Address Detection must stay off (`nodad` /
  `DuplicateAddressDetection=none` in `/etc/systemd/network/eth0.network`,
  persisted by `/etc/sysctl.d/99-lxc-ipv6-dad.conf`); otherwise the kernel
  marks the GUA `dadfailed tentative` and Cloudflare cannot reach the origin.
- Private NAT address: `10.10.10.52/24`
- SSH user: `root` (AIC ships the container with `PermitRootLogin yes`)
- Private key: `deploy/credentials/aic-vps-ed25519`
- Pinned host-key fingerprint:
  `SHA256:HV6OszvuYmwmWRLEY7z7jm8GojWZJppJlDBHIhJVUxw`

From the repository root, connect with:

```bash
ssh \
  -i deploy/credentials/aic-vps-ed25519 \
  -p 20049 \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=deploy/credentials/aic-known-hosts \
  root@162.19.81.122
```

The account is `root`, so treat the key as a production root credential.

`/root/.ssh/authorized_keys` also carries `aic-cloud-support-key-2026`, which
the provider installed and retains. Removing it may cut off provider support;
that is a deliberate decision, not routine hygiene.

## Verify before use

Check local file permissions and the key fingerprint:

```bash
stat -f '%Sp %N' deploy/credentials/aic-vps-ed25519
ssh-keygen -lf deploy/credentials/aic-vps-ed25519
```

The private key must remain mode `0600`. The entire `deploy/credentials/`
directory is Git-ignored. Never commit, paste, email, or upload its contents.

To verify access without opening a shell:

```bash
ssh \
  -i deploy/credentials/aic-vps-ed25519 \
  -p 20049 \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=deploy/credentials/aic-known-hosts \
  root@162.19.81.122 \
  'hostname && docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Note there is no `sudo` prefix on `docker` here: unlike the Lightsail `ubuntu`
account, this one is already root.

## What runs on this host

Ten containers across four Compose projects, all published to loopback only,
with the host Caddy as the sole public path:

| Project | Containers | Loopback ports |
|---|---|---|
| `saliminn` | `saliminn-{db,backend,frontend}` | 3030, 8081 |
| `payroll` | `payroll-{db,backend}` | 8080 |
| `online-shopping` | `online-shopping-{db,backend,frontend}` | 4000, 8082 |
| `online-shopping-hitpay-sandbox` | `…-{db,backend}` | 4001 |

Each Compose project is started from its own `/opt/<project>` directory with
`--project-name <project>`, which is what keeps the volume names stable.

## Hotel database maintenance

The hotel database runs inside `saliminn-db`. Unlike Lightsail, there is no
host PostgreSQL service on this box at all — the stale cluster that used to
serve port 5432 was not migrated, because nothing read from it.

Open a hotel database shell with:

```bash
docker exec -it saliminn-db psql -U hotel_admin -d hotel_management
```

Before a mutation, confirm the target container and database:

```bash
docker inspect --format '{{.Name}} {{.State.Health.Status}}' saliminn-db
docker exec saliminn-db \
  psql -U hotel_admin -d hotel_management \
  --tuples-only --no-align \
  --command 'SELECT current_database(), current_user;'
```

### Stale patch lineage (one-time, pre-fold databases)

*Done on staging and production 2026-09-14. Only needed for a database that
still records pre-fold `hotel_schema_revisions` rows — e.g. a dump restored
from before the fold, or a dev box that ran the 1.2–1.23 lineage.*

Symptom: `deploy.sh` aborts during the patch step with
`patch 1.2 checksum mismatch` — the database recorded generation-1 versions
under the old names/checksums (`1.2 google-subject`, `1.3
payment-idempotency`), and the current catalog republishes those versions as
`deposit-forfeited`/`guest-relations-phase2`.

Fix (production; for staging use `saliminn-staging-db`):

```bash
# 1. Confirm the stale lineage — old names like google-subject must be present.
docker exec saliminn-db psql -U hotel_admin -d hotel_management -X -c \
  "SELECT version, name, checksum FROM public.hotel_schema_revisions \
   WHERE generation = 1 ORDER BY version;"

# 2. Verified backup — never skip.
docker exec saliminn-db pg_dump --format=custom --no-owner --no-acl \
  -U hotel_admin hotel_management > /opt/saliminn/backups/lineage-reset-$(date -u +%Y%m%dT%H%M%SZ).dump

# 3. Delete only the post-baseline rows; the version=1 row is the frozen token.
docker exec saliminn-db psql -U hotel_admin -d hotel_management \
  -X -v ON_ERROR_STOP=1 -c \
  "DELETE FROM public.hotel_schema_revisions WHERE generation = 1 AND version > 1;"

# 4. Re-run the deploy. 5. Re-check the SELECT — expect 1.1 plus every
#    entry in patches/manifest.tsv (versions 2–8 today).
```

The full runbook — including the post-deploy export smoke test and the desktop
variant — lives in
[deployment.md](deployment.md#one-time-reset-stale-pre-fold-patch-lineage).

## TLS and the Cloudflare dependency

The origin is IPv6-only, so Cloudflare is not optional decoration — it is the
only way IPv4 visitors reach these sites. Caddy holds a per-zone certificate
selected by the `TLS_SALIMINN`, `TLS_EKOWAY`, and `TLS_PAYROLL` environment
variables (see `/etc/caddy/`); unset, each falls back to `internal`, which
serves a self-signed certificate that only Cloudflare's "Full" mode would
accept. Ports 80/443 are firewalled to Cloudflare's published ranges, and
Caddy's `trusted_proxies` list must stay in sync with them, or every visitor
will appear to the backends as a Cloudflare edge address and collectively trip
the per-IP rate limiters.

## Rotation

The authorized-key comment is `hotel-app-local-aic-access-2026-09-05`. To
rotate access, generate and verify a replacement first, add its public key to
`/root/.ssh/authorized_keys`, test it in a separate session, then remove the old
line by its exact comment. Never delete or overwrite the whole
`authorized_keys` file.

## Backups (local-only, by owner decision)

Since 2026-09-25 every backup stays on this host. The owner chose this over any
cloud destination (AWS S3, Cloudflare R2, or a paid AIC backup product) knowing
that losing the host loses the live data and every backup together. No cloud
credentials remain on the box.

| Stack | Nightly job | Location |
|---|---|---|
| hotel | `saliminn-backup.timer` → `/opt/saliminn/database-backup.sh` (DB + uploads) | `/opt/saliminn/backups` (`"offsite": false` is expected) |
| payroll | `payroll-backup.timer`; drop-in `payroll-backup.service.d/local.conf` runs `/usr/local/sbin/payroll-local-backup.sh` | `/srv/backups/payroll` (14 kept) |
| online-shopping | `online-shopping-backup.timer`; `backup.env` points at rclone remote `aiclocal` | `/opt/online-shopping/backups` + `/srv/backups/online-shopping` |

One-off archives taken before the AWS teardown:

- `/srv/backups/aws-archive/` — every S3 object (old payroll/online-shopping
  dumps, payroll Terraform state, payroll dev frontend) plus the deleted
  Route 53 zones' records.
- `/srv/backups/lightsail-final-20260925/` — final dumps of all four Lightsail
  databases. The hotel one is frozen at 2026-09-04 and predates the 2026-09-11
  data reload, so it is history, not a restore source.

## If the host is unreachable

The 2026-09-25 outage (about 04:16–06:07 UTC) was a provider-side hard stop of
the container: Cloudflare answered **522**, port 20049 returned *Network is
unreachable* while 443 on the shared IPv4 still answered (other tenants), and
the IPv6 address did not answer ping. Nothing here can fix that — raise it
with AIC. The same disk came back with no data loss; the journal showed no
shutdown sequence.

## DNS (Cloudflare only)

Cloudflare origin for every public hostname is the proxied AAAA
`2001:41d0:306:277a::2450`. Lightsail A records and the payrollmy.com
CloudFront addresses were removed on 2026-09-07; the unused Route 53 zones,
the CloudFront distribution and the Lightsail instance were deleted on
2026-09-25. SSL mode is **Full** (Caddy still serves `internal` certificates
until Origin CA certs are installed).
