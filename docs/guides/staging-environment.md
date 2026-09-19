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
Create `staging.saliminn.my` the same way as prod (proxied to the VPS). Until DNS exists, keep `PUBLIC_DNS_CUTOVER=false` in the staging workflow.

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

Seeding staging data is an explicit operation, never part of deploy:

```bash
# on the VPS, against the staging database only:
make db-baseline DATABASE_URL=postgres://…staging…   # fresh DB structure
make db-seed     DATABASE_URL=postgres://…staging…   # deterministic demo dataset
```

`db-seed` is safe to rerun — it resets the staging-owned id band
(800000-899999) in place. See `hotel-app-be/database/README.md` for details.
