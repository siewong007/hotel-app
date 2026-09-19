# Production Go-Live Checklist

Companion to the [production readiness assessment](production-readiness-assessment.md),
whose verdict is **ready with conditions**. This checklist is the path from that
verdict to an evidenced "production-ready": every row names the action, where it
runs, and the proof that closes it. Nothing here is optional context — a row
without its evidence stays open, and the README limitation stays until all of
them close.

References: [deployment guide](../guides/deployment.md),
[backup/restore drill](backup-restore.md),
[production operations](production-operations.md),
[retention policy draft](data-retention-policy-draft.md),
[PG19 cutover runbook](../guides/postgres-beta3-cutover.md),
[desktop updater](../../hotel-desktop/UPDATER.md).

## Operator / host actions

Closes the P1 items in assessment §11. All run on the production host
(`/opt/saliminn`) or its GitHub/desktop secrets — none can be done from this
repository alone.

| # | Gate | Action | Evidence that closes it |
|---|---|---|---|
| 1 | §11 #2 — off-site backups | Provision a hotel-owned bucket + access list; set `SALIMINN_OFFSITE_REMOTE` (rclone `remote:path`) and `SALIMINN_AGE_RECIPIENTS_FILE` together on the backup unit — both are wired in `deploy/database-backup.sh` | `"offsite": true` in `/opt/saliminn/backups/backup-status.json`, plus one remote object pulled and restored |
| 2 | §11 #3 — least-privilege DB role | `psql "$DATABASE_URL" -f deploy/db-least-privilege.sql`, set the `hotel_app` password out-of-band (`ALTER ROLE hotel_app PASSWORD '…'`), repoint the backend `DATABASE_URL` at `hotel_app`, restart. Keep `hotel_admin` for `apply-patches.sh`/seed only | `SELECT current_user` on a backend connection returns `hotel_app`; patch runbook updated |
| 3 | §11 #4 — alert consumer | Write `SALIMINN_ALERT_WEBHOOK=<url>` into `/opt/saliminn/backup-alert.env`; add an external uptime probe on `https://<host>/health` | Forced backup failure POSTs once, recovery POSTs once (the script dedupes transitions); probe fires on downtime |
| 4 | §11 #6 — restore drill | Execute [backup-restore.md](backup-restore.md) end-to-end once | Recorded RTO; explicit RPO target set (≤24 h implied by nightly) |
| 5 | §11 #1 — PostgreSQL 19 GA | When PG19 GAs (Beta 4 ships 2026-09-24; GA targeted end of Oct 2026): rehearse [postgres-beta3-cutover.md](../guides/postgres-beta3-cutover.md) dump/restore on staging into a **fresh** volume (beta formats have no upgrade path), then prod. Bump compose pins and desktop `CONFIGURED_POSTGRES_BUILD_IDENTITY` in the same release | Staging rehearsal record; prod on the `postgres:19` GA image; desktop pgdata version gate verified against the new build |
| 6 | §11 #9 — desktop signing | Provision Windows PFX/thumbprint and Apple Developer ID + notarytool credentials per [UPDATER.md](../../hotel-desktop/UPDATER.md) (`TAURI_SIGNING_PRIVATE_KEY` is already set; cert secrets are env-gated) | Signed/notarized build verified end-to-end on macOS, Windows, and Linux |

## External validations

Not executable from this repository — they need counsel, testers, or
infrastructure owners.

| # | Gate | Action | Evidence |
|---|---|---|---|
| 7 | §14 — legal/PDPA review | Counsel confirms PDPA applicability, privacy-notice sufficiency, and approves the retention periods in [data-retention-policy-draft.md](data-retention-policy-draft.md) | Signed-off retention schedule — this unblocks row 11 |
| 8 | §11 #12 — processor register | Document every third-party processor (PayPal, Google, Cloudflare Turnstile, SMTP, hosting provider) and its DPA | Register document + legal review |
| 9 | §14 — penetration test | Authenticated web/API test; required after material auth, payment, or eKYC changes per [production-operations.md](production-operations.md) | Report + remediation record |
| 10 | §14 — edge/host hardening | Cloudflare WAF rules, DNS configuration, host firewall/SSH hardening, GitHub `production` environment reviewers | Config review record |

## Repo-side remainder

Development work, listed so the checklist is complete — these are not runbook
steps.

| # | Item | Blocker / note |
|---|---|---|
| 11 | Retention purge jobs | Blocked on row 7's sign-off, then implement per the draft policy's checklist. `audit_logs` is monthly-partitioned, so its purge is a partition detach/drop, not a `DELETE` scan |
| 12 | External job/audit-failure alerting | `system/jobs/failures` and audit-write-failure signals are in-app only; extend beyond the backup-health webhook |
| 13 | Restore/test depth | CI runs a `pg_dump`→`pg_restore` **schema** round-trip only; add a full restore + boot check, one happy-path E2E, and an annual load baseline |

## Closing the loop

When every row has its evidence: flip the §11 statuses in the readiness
assessment, update its verdict, and replace the README Limitations bullet —
that bullet is the public claim and must not run ahead of the evidence.
