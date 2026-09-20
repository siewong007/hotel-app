//! Wipe of every seed-owned row: children before parents inside the
//! 800000-899999 id band, plus generated-id children of band parents and
//! marker-tagged `job_runs`. Ported from staging.sql §05 — the exact same
//! delete set, so a rerun is a reset of the seed dataset, never an append.
//!
//! `audit_logs` is append-only by trigger and intentionally absent: its seed
//! rows are id-guarded at insert time instead. `two_factor_challenges`,
//! `passkeys`, `user_sessions` and friends cascade from the `users` delete.

pub const WIPE_SQL: &str = r#"
DELETE FROM public.voucher_redemption_allocations
 WHERE redemption_id IN (SELECT id FROM public.voucher_redemptions WHERE id BETWEEN 800000 AND 899999)
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.voucher_redemptions WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.payment_receipt_requests
 WHERE payment_id IN (SELECT id FROM public.payments WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.payment_retry_capabilities WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.customer_ledger_payments
 WHERE ledger_id IN (SELECT id FROM public.customer_ledgers WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.night_audit_posted_nights WHERE id BETWEEN 800000 AND 899999
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.night_audit_details WHERE id BETWEEN 800000 AND 899999
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.staff_notification_reads
 WHERE notification_id IN (SELECT id FROM public.staff_notifications WHERE id BETWEEN 800000 AND 899999)
    OR user_id BETWEEN 800000 AND 899999;
DELETE FROM public.support_messages
 WHERE conversation_id IN (SELECT id FROM public.support_conversations WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.support_events
 WHERE conversation_id IN (SELECT id FROM public.support_conversations WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.support_conversations WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.self_checkin_events WHERE id BETWEEN 800000 AND 899999
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.email_deliveries WHERE id BETWEEN 800000 AND 899999
    OR campaign_id IN (SELECT id FROM public.email_campaigns WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.loyalty_redemptions WHERE id BETWEEN 800000 AND 899999 OR member_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_transactions WHERE id BETWEEN 800000 AND 899999
    OR member_id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.reward_redemptions WHERE id BETWEEN 800000 AND 899999
    OR membership_id IN (SELECT id FROM public.loyalty_memberships WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.points_transactions WHERE id BETWEEN 800000 AND 899999
    OR membership_id IN (SELECT id FROM public.loyalty_memberships WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.loyalty_accounts WHERE id BETWEEN 800000 AND 899999 OR member_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_memberships WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_members WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_rewards WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_notes WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_preferences WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_documents WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_reviews WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_portal_sessions WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_complimentary_credits WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.notification_subscriptions WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.notification_consent_events WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.consent_records WHERE id BETWEEN 800000 AND 899999
    OR guest_id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.user_guests WHERE id BETWEEN 800000 AND 899999
    OR user_id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.invoices WHERE id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.customer_ledgers WHERE id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.payments WHERE id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_guests WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_history WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_modifications WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_services WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_changes WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.bookings WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.housekeeping_tasks WHERE id BETWEEN 800000 AND 899999
    OR room_id BETWEEN 800000 AND 899999;
DELETE FROM public.maintenance_tickets WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.room_events WHERE room_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_history WHERE room_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_status_change_log WHERE room_id BETWEEN 800000 AND 899999;
-- Keyed by (room_type_id, stay_date), no id column; covers bootstrap types too.
DELETE FROM public.online_inventory_allocations
 WHERE room_type_id IN (SELECT id FROM public.room_types
                        WHERE id BETWEEN 800000 AND 899999 OR code IN ('STD','DLX','STE','FAM'));
DELETE FROM public.room_rates WHERE rate_plan_id BETWEEN 800000 AND 899999
    OR room_type_id BETWEEN 800000 AND 899999;
DELETE FROM public.rooms WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.promotion_channels WHERE promotion_id BETWEEN 800000 AND 899999;
DELETE FROM public.promotion_loyalty_tiers WHERE promotion_id BETWEEN 800000 AND 899999;
DELETE FROM public.promotion_room_types WHERE promotion_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_type_amenities WHERE room_type_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_types WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.amenities WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.rate_plans WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.services WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.email_campaigns WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.email_templates WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.email_suppressions WHERE email LIKE '%@staging.hotel-app.test';
DELETE FROM public.vouchers WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.promotions WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_segments WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.night_audit_runs WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.staff_notifications WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.job_runs WHERE detail->>'staging_seed' = 'v1';
-- users.guest_id -> guests is the last edge into the guest band; clear it so
-- guests can be removed before the users that created them (guests.created_by
-- legitimately points at seed staff users).
UPDATE public.users SET guest_id = NULL WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guests WHERE id BETWEEN 800000 AND 899999;
-- companies/corporate_accounts.created_by -> users, so these precede the users delete.
DELETE FROM public.corporate_account_contacts
 WHERE corporate_account_id IN (SELECT id FROM public.corporate_accounts WHERE id::text LIKE '80000000-%');
DELETE FROM public.corporate_accounts WHERE id::text LIKE '80000000-%';
DELETE FROM public.companies WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.user_permissions WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.user_roles WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.team_members WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.user_sessions WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.refresh_tokens WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.users WHERE id BETWEEN 800000 AND 899999;
"#;
