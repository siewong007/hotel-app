# VPS Access Guide

This project shares the production Lightsail VPS with the payroll service. Use
the dedicated local administrator key in `deploy/credentials/`; do not use the
GitHub Actions deployment key for interactive maintenance.

## Connection details

- Lightsail instance: `Ubuntu-1`
- AWS region: `ap-southeast-1`
- Public IPv4: `13.251.162.88`
- SSH user: `ubuntu`
- Private key: `deploy/credentials/lightsail-vps-ed25519`
- Pinned host-key fingerprint:
  `SHA256:EvysNdkRZEdS5wOyNFI+lZs2dH589gW9ycQGAiVImsE`

From the repository root, connect with:

```bash
ssh \
  -i deploy/credentials/lightsail-vps-ed25519 \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=deploy/credentials/lightsail-known-hosts \
  ubuntu@13.251.162.88
```

The key permits normal SSH commands and an interactive terminal, but disables
SSH agent, TCP-port, and X11 forwarding. The `ubuntu` account has administrative
`sudo` access, so treat the key as a production root credential.

## Verify before use

Check local file permissions and the key fingerprint:

```bash
stat -f '%Sp %N' deploy/credentials/lightsail-vps-ed25519
ssh-keygen -lf deploy/credentials/lightsail-vps-ed25519
```

The private key must remain mode `0600`. The entire `deploy/credentials/`
directory is Git-ignored. Never commit, paste, email, or upload its contents.

To verify access without opening a shell:

```bash
ssh \
  -i deploy/credentials/lightsail-vps-ed25519 \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=deploy/credentials/lightsail-known-hosts \
  ubuntu@13.251.162.88 \
  'hostname && sudo docker ps --format "table {{.Names}}\t{{.Status}}"'
```

## Hotel database maintenance

The hotel database runs inside `saliminn-db`. Do not use the host PostgreSQL
service on port 5432; that belongs to payroll.

Open a hotel database shell with:

```bash
sudo docker exec -it saliminn-db \
  psql -U hotel_admin -d hotel_management
```

Before a mutation, confirm the target container and database:

```bash
sudo docker inspect --format '{{.Name}} {{.State.Health.Status}}' saliminn-db
sudo docker exec saliminn-db \
  psql -U hotel_admin -d hotel_management \
  --tuples-only --no-align \
  --command 'SELECT current_database(), current_user;'
```

## Temporary Lightsail recovery access

If the saved key is lost or revoked, AWS CLI profile `payroll-migration` can
request short-lived access for `Ubuntu-1` with
`aws lightsail get-instance-access-details`. Keep the returned private key and
certificate only in a mode-0600 temporary directory and remove them immediately
after use. Do not save AWS profile credentials in this repository.

## Rotation

The authorized-key comment is `hotel-app-local-vps-access-2026-07-18`. To
rotate access, generate and verify a replacement first, add its public key to
`/home/ubuntu/.ssh/authorized_keys`, test it in a separate session, then remove
the old line by its exact comment. Never delete or overwrite the whole
`authorized_keys` file.
