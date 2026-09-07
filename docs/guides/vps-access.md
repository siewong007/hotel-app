# VPS Access Guide

This project shares a production VPS with the payroll and online-shopping
services. Use the dedicated local administrator key in `deploy/credentials/`; do
not use the GitHub Actions deployment key for interactive maintenance.

Migrated from AWS Lightsail to AIC cloud on 2026-09-05. The Lightsail box
(`13.251.162.88`) is retained only as a rollback target — see "Old host" below.

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

## Old host (Lightsail, rollback only)

`ubuntu@13.251.162.88` with `deploy/credentials/lightsail-default-ap-southeast-1.pem`
and `deploy/credentials/lightsail-known-hosts`. Host-key fingerprint
`SHA256:EvysNdkRZEdS5wOyNFI+lZs2dH589gW9ycQGAiVImsE`. It still holds a complete,
running copy of all four stacks. Do not decommission it until the DNS cutover
has been stable long enough to be confident, and remember that any writes taken
on the new host after cutover will not exist there.

```bash
ssh \
  -i deploy/credentials/lightsail-default-ap-southeast-1.pem \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=deploy/credentials/lightsail-known-hosts \
  ubuntu@13.251.162.88
```

## DNS cutover (completed 2026-09-07)

Cloudflare origin for every public hostname is the proxied AAAA
`2001:41d0:306:277a::2450`. Lightsail A records and the payrollmy.com
CloudFront addresses were removed the same day. SSL mode is **Full** (Caddy
still serves `internal` certificates until Origin CA certs are installed).

Keep Lightsail running for a few quiet days, then snapshot and delete. Any
writes taken on AIC after this cutover will not exist on Lightsail.
