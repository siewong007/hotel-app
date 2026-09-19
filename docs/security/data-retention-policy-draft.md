# Data-Retention Policy (DRAFT — requires legal review)

Status: **draft**. Every period below is a proposed target, not a decided
policy. Malaysian PDPA's retention principle ("no longer than necessary"),
tax/company record-keeping obligations, and the hotel's own operational needs
must be reconciled by the hotel's designated officer/legal counsel before any
of this is enforced. Nothing in the application currently purges these stores
— this document exists so the decision happens on paper before it happens in
code.

## Scope

| Store | Contents | Proposed retention | Proposed trigger |
|---|---|---|---|
| `audit_logs` | staff actions, auth events, permission changes, data exports | 24 months, then hard-delete | nightly job |
| eKYC identity images (`private_uploads/ekyc`) | IC/passport photos, selfies | stay duration + 12 months after check-out, then delete with the guest record's purge | nightly job |
| `guests` (soft-deleted) | redacted rows (`PII_REDACTED`) | purge 24 months after `deleted_at` | nightly job |
| `email_deliveries` | queued/sent guest mail bodies | 90 days after terminal state | outbox worker |
| `guest_portal_sessions`, `refresh_tokens` | expired session rows | delete 30 days after expiry/revocation | nightly job |
| Data-transfer exports/imports (staged files) | full-table JSON snapshots | delete staging files immediately on completion; audit rows persist | worker cleanup |
| Backend/Caddy logs | request + error logs | 14 days local (current logrotate), longer only if shipped to central log store | logrotate |
| Nightly backups | DB dump + uploads tar | 14 nightly / 5 predeploy / 7 uploads local; off-site tier per bucket lifecycle | backup script |
| Invoices/ledger/payment rows | financial records | **do not purge** — subject to statutory retention (Malaysia: generally 7 years for business records); verify with counsel | never |

## Non-negotiables

- Purge jobs must write an `audit_logs` row per run (counts per store, never
  row contents) so retention itself is auditable.
- Legal hold: an incident or dispute freezes the relevant retention clock.
- eKYC images are the highest-sensitivity store: any retention reduction for
  them is a compliance win, not just storage hygiene.
- Soft-deleted guests must stay redacted before purge — the redaction is the
  privacy control, deletion is the hygiene control.

## Implementation checklist (when periods are approved)

1. Encode each approved period as a `system_settings` key (days), not a code
   constant.
2. One nightly `retention` job following the worker pattern in
   `modules/communications/worker.rs` (leased, batched, audited).
3. File deletion for eKYC images goes through the same path validation as
   upload deletion — never `rm` a path assembled from row data unchecked.
4. Update `production-readiness-assessment.md` item #5 and this file's status
   from draft to active.
