# Production Security Operations

This runbook applies to the web deployment only. The desktop/offline runtime is
intentionally not covered by these controls.

## Required release controls

Before a production release, CI must be green and the Security workflow must
have no unresolved secret-scan, CodeQL, dependency-review, or Rust advisory
finding. Review Dependabot updates as ordinary pull requests; do not merge a
security update without its normal test suite.

The production backend must set `ENVIRONMENT=production` (or
`APP_ENV=production`), use HTTPS-only non-localhost `ALLOWED_ORIGINS`, set a
real `PASSKEY_RP_ID`, set `TOTP_ENCRYPTION_KEY` (without it TOTP seeds are
stored unencrypted), and leave `SKIP_EMAIL_VERIFICATION=false`. Startup now
refuses the insecure combinations above. Staff API tokens are session-bound;
password resets, password changes, lockouts, deactivation, and deletion revoke
their sessions.

The backend's `DATABASE_URL` role must not be a superuser. The shipped
`hotel_admin` role is one; run `deploy/db-least-privilege.sql` once to create
the DML-only `hotel_app` runtime role, then point the backend at it. Keep
`hotel_admin` for `apply-patches.sh` and `seed.sql` only.

Protect the GitHub `production` environment with required reviewers and limit
deployment-secret access to the release maintainers. Rotate the AIC VPS SSH
key and `JWT_SECRET` immediately after suspected disclosure. Rotating
`JWT_SECRET` deliberately invalidates all staff access tokens.

## Access reviews and incident response

Each month, a designated administrator must review active accounts, assigned
roles, passkeys, and privileged audit events. Remove dormant users and require
a fresh password/passkey enrollment for any account whose ownership is unclear.

For a suspected account or token compromise:

1. Deactivate the affected account or reset its password in the RBAC console;
   this revokes its active sessions.
2. Preserve relevant application, Caddy, and GitHub Actions logs outside the
   host before performing cleanup.
3. Review audit events and database changes for the incident window.
4. Rotate affected credentials, confirm CORS/proxy configuration, and record
   the timeline, scope, and corrective action.
5. Have an independent reviewer approve reactivation.

## External controls that need an operator

The repository cannot create cloud accounts, configure DNS/WAF/DDoS services,
or perform an independent penetration test. Before declaring the service live,
an operator must:

- configure a TLS edge/WAF with managed DDoS protection and request limits;
- send encrypted database backups to a separate account/provider and test a
  restore at least quarterly (see `backup-restore.md`);
- centralize Caddy, backend, and GitHub audit logs with retention appropriate
  to the hotel’s legal and incident-response obligations;
- commission an authenticated web/API penetration test after material auth,
  payment, or eKYC changes and track findings to closure.

## Alerting

`check-backup-health.sh` alerts on **transitions**: on a new or changed
failure it POSTs `{"text": "saliminn backup-health: UNHEALTHY: …"}` to a
webhook, and once on recovery. Alerting on transitions means the 15-minute
timer does not re-notify on one persistent failure.

To enable webhook delivery, create `/opt/saliminn/backup-alert.env`
(operator-owned, mode 0600, not part of the release bundle) with:

```bash
SALIMINN_ALERT_WEBHOOK=https://example.com/your-incoming-webhook
```

Slack, Discord, and ntfy incoming webhooks all accept that payload shape.
Staging reads `/opt/saliminn-staging/backup-alert.env`. Without the file the
check still logs to journald and writes the `backup-health.FAILED` marker —
that marker is also the integration point for any other monitor (uptime
probe, mail transport) the operator adds later.

The nightly backup ships off-host only when both variables are set on the
service (`systemctl edit saliminn-backup.service` → `[Service]`
`Environment=` lines):

```bash
Environment=SALIMINN_OFFSITE_REMOTE=remote:bucket/saliminn      # rclone remote + prefix
Environment=SALIMINN_AGE_RECIPIENTS_FILE=/etc/saliminn/backup-recipients.txt
```

Each artifact is age-encrypted, `rclone copy`'d, and `rclone check`-verified;
the run then reports `"offsite": true` in `backup-status.json`. A failed ship
marks the run `error` with category `offsite_failed` — the health check and
its webhook alert fire — while `last_success` still tracks the usable local
dump.

## Maintenance mode

There is no maintenance flag in the app; the proxy answers 503 during a
maintenance window while `/health` stays up for deploy smoke checks and
uptime probes.

**Container path** (`docker compose --profile https`): set
`MAINTENANCE_MODE=on` in the environment and reload Caddy
(`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`, or
restart the service). The toggle is read at config-adapt time, so it takes
effect on reload — unset or `off` restores normal routing.

**Production host** (host-level Caddy, `/etc/caddy/saliminn.Caddyfile`):
insert this block directly above the `@backend` matcher, then
`caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`:

```caddy
    @maintenance not path /health
    handle @maintenance {
        respond "Scheduled maintenance — please try again shortly." 503
    }
```

Remove the block and reload to end the window. Note that `deploy.sh`
regenerates the site file on each deploy, so a maintenance block left in
place does not survive a release — which is the intended behavior.

## Payment reconciliation

PayPal and bank-transfer payments are recorded by staff or by verified
webhook deliveries; neither path reconciles itself against the processor.

Weekly (or after any payment-incident report):

1. Export the period's payments from the ledgers/payments screens
   (`payments:read`) and compare against the PayPal activity log and bank
   statement for the same window.
2. Investigate any row present in PayPal/bank but absent in the app first —
   a webhook delivery failure or a missed manual entry — then the reverse
   (a recorded payment the processor never settled).
3. Check `system/jobs/failures` for `receipts` and webhook-processing job
   errors during the window.
4. Correct through the payment screens (void/re-record with references), so
   the ledger keeps an auditable trail — never edit `payments` rows directly
   in SQL.
5. Record the reconciliation date and any discrepancies found in the audit
   notes; recurring mismatches are an incident, not housekeeping.

## Data-breach response

The account-compromise steps above cover credentials. For suspected exposure
of guest, payment, or eKYC data:

1. Contain: deactivate implicated accounts, disable public intake (maintenance
   mode above) if the path is still open.
2. Preserve: copy backend logs, Caddy journal (`journalctl -u caddy`), and
   the `audit_logs` partitions for the window **off the host** before any
   cleanup — they are the forensic record.
3. Scope: audit queries (`resource_type`, `action`, timestamps) plus
   `ekyc_document_downloaded` events establish which records left.
4. Notify: Malaysian PDPA breach-notification obligations may apply once
   scope is known — the decision and timeline belong to the hotel's
   designated officer/legal counsel, not to this runbook.
5. Remediate the entry point, rotate `JWT_SECRET` (invalidates all staff
   sessions — plan the timing), DB credentials, and any implicated API keys.
6. Record timeline, scope, root cause, and corrective actions; require an
   independent review before closing.
