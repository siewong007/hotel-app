# Decisions — APPROVED 2026-08-22 (owner sign-off in chat; items 1-5 applied)

Item 6 stays as-is per recommendation. Resolution notes below each entry.

## 1. Branch protection on master — APPLIED

Ruleset `master-protection` (id 21196959) is active: PR required on the default
branch, repository-admin bypass always. NOTE: this GitHub API surface rejects
`parameters` on pull_request rules entirely (0-approvals/merge-methods), so the
bare rule ships instead — functionally equivalent for a solo admin with bypass.

**Recommendation:** require PRs, but keep admin bypass so direct pushes stay
possible for solo hotfixes.

```
gh api repos/siewong007/hotel-app/rulesets -f name=master-protection \
  -F target=branch -F enforcement=active \
  -f 'conditions[ref_name][include][]=~DEFAULT_BRANCH' \
  -f 'rules[][type]=pull_request' \
  -f 'rules[][parameters][required_approving_review_count]=0' \
  -f 'rules[][parameters][dismiss_stale_reviews_on_push]=true'
```

`required_approving_review_count=0` means "PR must exist and pass checks" without
needing a second person. CI already gates on gitleaks, clippy, tests.

## 2. Voided bookings leave receivable open — ACCEPTED (no cascade)

**Recommendation:** cascade nothing; keep manual reconciliation.
Rationale: voiding is already rare + audit-logged; auto-reversing ledger rows
touches money history and risks masking genuine partial payments made before
the void. Add a daily ops report of open ledgers whose booking is voided
(query exists in `ledger_characterization.rs` fixtures) instead.

## 3. PayPal webhooks: auto-apply refunds? — ACCEPTED (stay manual)

**Recommendation:** no auto-apply yet. Signature-verified + audit-logged is
already in place; auto-applying mutates balances from an external trigger and
needs an idempotency design (PayPal event redelivery) plus a reconciliation
report first. Revisit when portal volume justifies it.

## 4. Manager role needs `audit:read` — APPLIED via patch 0007

**Recommendation:** grant it via a new patch `0007_manager_audit_read.sql`
(one INSERT into role_permissions + rbac_cache invalidation happens app-side).
Managers approve payments but cannot see the conflict banner today because the
banner requires `audit:read`.

## 5. GuestUpdateInput.is_active silent no-op — DOCUMENTED (removal deferred to next contract bump)

**Recommendation:** remove the field from the request model next time the
guest API contract gets a version bump; until then it is documented here and
at the model definition as accepted-but-ignored. Removing now breaks any client sending it.

## 6. getLedgerUiStatus unreachable 'draft'

**Recommendation:** leave as-is; zero-balance + un-invoiced reading "Paid" is
the safer customer-facing label. Product call to revisit.
