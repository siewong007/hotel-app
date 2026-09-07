# Salim Inn staging (same VPS as production)

Staging runs on the AIC VPS alongside production, in an isolated Compose project.

| | Production | Staging |
| --- | --- | --- |
| Dir | `/opt/saliminn` | `/opt/saliminn-staging` |
| Host | `saliminn.my` | `staging.saliminn.my` |
| API port | `127.0.0.1:3030` | `127.0.0.1:3031` |
| FE port | `127.0.0.1:8081` | `127.0.0.1:8083` |
| Postgres | `postgres:19beta3` | `postgres:16` |
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
