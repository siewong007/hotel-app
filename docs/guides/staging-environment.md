# Staging Environment

Staging runs on the AIC VPS alongside production, in an isolated Compose project.

| | Production | Staging |
| --- | --- | --- |
| Dir | `/opt/saliminn` | `/opt/saliminn-staging` |
| Host | `saliminn.my` | `staging.saliminn.my` |
| API port | `127.0.0.1:3030` | `127.0.0.1:3031` |
| FE port | `127.0.0.1:8081` | `127.0.0.1:8083` |
| Postgres | `postgres:19beta3` | `postgres:19beta3` |
| Auth | public (Cloudflare) | Caddy basic auth + Cloudflare |
| Workflow | `deploy.yml` | `deploy-staging.yml` |

## DNS / Cloudflare
`staging.saliminn.my` is live: it is proxied through Cloudflare to the VPS like production, and answers 401 until basic auth is supplied. The staging workflow runs with `PUBLIC_DNS_CUTOVER: "true"`, so every deploy also health-checks over public HTTPS. Setting it to anything else limits the check to the localhost probes.

## Basic auth
Credentials are **only** on the VPS: `/root/.saliminn-staging-basic-auth`. The hash file is `/opt/saliminn-staging/basic-auth.hash`. Nothing is stored in git.

## CI behaviour
- **Automatic:** after a green `CI` run on the latest `master` push, staging deploys.
- **Manual:** `workflow_dispatch` on `Deploy staging` can deploy a chosen SHA for bug hunts.
- Production remains on `deploy.yml` and is unchanged.

## Capacity
The box is 2 GB and already runs payroll, shop, HitPay sandbox, and prod hotel. Staging adds another Postgres. Pause HitPay sandbox if memory gets tight.

## Staging data

The staging Postgres runs the same `postgres:19beta3` image as production —
the V1 baseline is PG19-native end to end.

A staging deploy initializes an empty volume with the V1 baseline and bootstrap
`seed.sql` (through `initdb/`), then applies the patch catalog. **The demo
dataset is not part of any deploy.**

Loading it is an explicit, manual operation, and today there is no ready path.
The `seed` binary (`make db-seed` = `cargo run --bin seed -- --all`) is not
shipped in the backend image. Deploys ship saved images and scripts, not the
repository, so there is no checkout on the VPS for `make` to run in, and
`saliminn-staging-db` publishes no host port. Anyone
seeding staging has to get a `seed` build to the database deliberately: for
example, a Linux build run against the container network with
`APP_ENV=staging`. When it runs, it is safe to rerun. It resets only the
seed-owned id band (800000-899999).

The seed refuses an `APP_ENV`/`ENVIRONMENT` of `production`, but it trusts the
environment it is given. Note that the staging *backend* runs with
`ENVIRONMENT=production` and a PayPal-sandbox opt-out, so do not copy the
backend's environment into a seed run. See `hotel-app-be/database/README.md`
for scenarios and safety rules. Tracked in `../ongoing-dev.md`.
