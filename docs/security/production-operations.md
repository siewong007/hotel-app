# Production security operations

This runbook applies to the web deployment only. The desktop/offline runtime is
intentionally not covered by these controls.

## Required release controls

Before a production release, CI must be green and the Security workflow must
have no unresolved secret-scan, CodeQL, dependency-review, or Rust advisory
finding. Review Dependabot updates as ordinary pull requests; do not merge a
security update without its normal test suite.

The production backend must set `ENVIRONMENT=production` (or
`APP_ENV=production`), use HTTPS-only non-localhost `ALLOWED_ORIGINS`, set a
real `PASSKEY_RP_ID`, and leave `SKIP_EMAIL_VERIFICATION=false`. Startup now
refuses the insecure combinations above. Staff API tokens are session-bound;
password resets, password changes, lockouts, deactivation, and deletion revoke
their sessions.

Protect the GitHub `production` environment with required reviewers and limit
deployment-secret access to the release maintainers. Rotate the Lightsail SSH
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
