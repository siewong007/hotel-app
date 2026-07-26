# SQL Schema Evaluation — 2026-07-26

## Summary
Three checks completed on SQL schema usage, table definitions, database parity, and function/time-value conventions.

### Checks Performed
1. ✓ Extracted all table/function names referenced in SQL strings in hotel-app-be/src
2. ✓ Verified each reference exists in hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
3. ✓ Compared database files between hotel-app-be/database/postgres and hotel-desktop/src-tauri/database/postgres
4. ✓ Grepped for literal NOW() and CURRENT_DATE in SQL strings

---

## Finding 1: BLOCKER — sync_all_room_statuses Function Missing

**Severity:** Blocker (runtime failure)

**Location:** 
- Referenced: hotel-app-be/src/services/rooms.rs:1464
- Route: hotel-app-be/src/routes/rooms.rs:44
- Handler: services/rooms.rs:1458-1489 (sync_room_statuses_handler)

**Evidence:**
```
hotel-app-be/src/services/rooms.rs:1464:    let rows = sqlx::query("SELECT * FROM sync_all_room_statuses()")
```

**Issue:** The endpoint POST `/api/rooms/sync-statuses` is wired and will 500 at runtime when the function is invoked. The function `sync_all_room_statuses()` does not exist in the PostgreSQL baseline schema.

**Expected columns** (inferred from handler code):
- room_id (bigint)
- room_number (string)
- old_status (string)
- new_status (string)

**Fix required:** 
- Create the SQL function in the baseline OR
- Create a patch file hotel-app-be/database/postgres/patches/ if this is a post-V1 addition OR
- Remove the endpoint if it's not yet implemented

---

## Finding 2: SHOULD-FIX — Desktop Database Missing Patch/Upgrade Directories

**Severity:** Should-fix (missing tracking/upgrade files)

**Affected files:**
```
hotel-app-be/database/postgres/optimization/  ← missing from desktop
hotel-app-be/database/postgres/patches/       ← missing from desktop
hotel-app-be/database/postgres/upgrade/       ← missing from desktop
```

**Evidence:**
```bash
diff -rq hotel-app-be/database/postgres hotel-desktop/src-tauri/database/postgres
# Output: Only in hotel-app-be/database/postgres: optimization
#         Only in hotel-app-be/database/postgres: patches
#         Only in hotel-app-be/database/postgres: upgrade
```

**Context:** CLAUDE.md lesson log (2026-07-24) requires byte-identical copies between the two locations. The core files (migrations/0001_v1_baseline.sql, data.sql, seed.sql) are byte-identical and correct.

**Patches directory contains (7 files):**
- 2026-07-21-payments-approve-permission.sql
- 2026-07-22-room-types-pricing-columns.sql
- 2026-07-23-guest-booking-statuses.sql
- 2026-07-24-july-deluxe-loyalty-voucher.sql
- 2026-07-24-online-inventory-custom-pricing.sql
- 2026-07-24-payment-receipts.sql
- 2026-07-24-welcome-deluxe-voucher.sql

**Fix required:** Sync these directories to hotel-desktop/src-tauri/database/postgres/ to maintain parity per CLAUDE.md requirement.

---

## Finding 3: SHOULD-FIX — Direct NOW() Usage in SQL Strings

**Severity:** Should-fix (inconsistent with stated convention, but Postgres-only now)

**Locations:**
1. hotel-app-be/src/repositories/rbac.rs:661
   ```sql
   UPDATE roles SET ... updated_at = NOW() WHERE id = $3
   ```

2. hotel-app-be/src/repositories/company.rs:172
   ```sql
   UPDATE corporate_accounts SET ... updated_at = NOW() WHERE id = $15
   ```

**Context:** CLAUDE.md Leak #2 and lessons.md (2026-07-24) note that the project went Postgres-only recently, so the sql_compat::current_timestamp() convention may be stale. These use NOW() directly which works in PostgreSQL but violates the older dual-database convention.

**Note:** This may be acceptable post-migration, but should be documented in CLAUDE.md if it is. All found instances use NOW() directly, not through param!() helpers.

---

## Finding 4: SHOULD-FIX — Unused Dead Code with NOW()

**Severity:** Nit (unused constant)

**Location:** hotel-app-be/src/services/audit.rs:797

**Evidence:**
```rust
pub const AUDIT_LOGS_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS audit_logs (
    ...
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
...
"#
```

**Issue:** This constant is defined but never referenced anywhere in the codebase (grep finds only the definition, no usage). It's a CREATE TABLE migration embedded in Rust that appears to be dead code left over from an earlier approach.

**Fix:** Remove the unused constant or integrate it into a proper migration path if it's needed.

---

## Finding 5: SHOULD-FIX — Direct CURRENT_DATE Usage in SQL String

**Severity:** Should-fix (inconsistent with convention)

**Location:** hotel-app-be/src/repositories/bookings/lifecycle.rs:956

**Evidence:**
```rust
let hotel_today: NaiveDate = sqlx::query_scalar("SELECT CURRENT_DATE")
```

**Context:** Similar to Finding 3 — convention prefers sql_compat::current_date() but the recent migration to Postgres-only may make this acceptable. One direct instance found.

---

## All Tables Successfully Verified

All 30 table names found in SQL queries exist in the baseline:
- audit_logs, booking_channels, booking_guests, booking_history, booking_modifications
- bookings, booking_services, companies, corporate_account_contacts, corporate_accounts
- customer_ledger_payments, customer_ledgers, ekyc_verifications, email_campaigns
- guests, guest_portal_sessions, guest_preferences, invoices, loyalty_accounts
- loyalty_program_rules, loyalty_redemptions, loyalty_rewards, loyalty_transactions
- online_inventory_allocations, passkeys, payments, permissions, rate_plans
- rooms, room_rates, room_types, roles, role_permissions, user_guests, user_roles, users, vouchers

**Checked but empty (no references found in code):**
- amenities, booking_guests, ekyc_access_events, ekyc_decision_history, ekyc_idempotency_keys
- ekyc_notes, ekyc_reason_codes, ekyc_sensitive_reveals, email_deliveries, email_suppressions
- email_templates, guest_complimentary_credits, guest_documents, guest_notes, guest_reviews
- hotel_schema_revisions, housekeeping_tasks, loyalty_members, loyalty_memberships
- loyalty_tiers, maintenance_tickets, night_audit_details, night_audit_posted_nights
- night_audit_runs, notification_consent_events, notification_subscriptions
- points_transactions, promotion_room_types, promotions, refresh_tokens, reward_catalog
- reward_redemptions, room_changes, room_events, room_history, room_status_change_log
- room_status_transitions, room_type_amenities, self_checkin_events, services
- support_action_idempotency_keys, support_conversations, support_events, support_guest_request_idempotency_keys
- support_messages, system_settings, user_permissions, user_sessions, voucher_redemption_allocations
- voucher_redemptions

---

## Key Statistics

- Total SQL statements scanned: 433 sqlx::query patterns
- Unique table names referenced: 30
- Tables in baseline schema: 81
- Blocker findings: 1 (missing function)
- Should-fix findings: 3 (missing directories, direct NOW()/CURRENT_DATE usage)
- Nit findings: 1 (unused constant)

---

## Recommendations

1. **Immediate (blocker):** Implement sync_all_room_statuses() function or remove the endpoint before next deployment
2. **High priority:** Sync optimization/, patches/, and upgrade/ directories to desktop copy
3. **Medium priority:** Review NOW()/CURRENT_DATE usage post-Postgres-only migration and update CLAUDE.md if convention has changed
4. **Low priority:** Remove unused AUDIT_LOGS_MIGRATION constant
