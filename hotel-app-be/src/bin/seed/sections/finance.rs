//! Finance: payments in every supported state, receipt requests, retry
//! capability, invoices, city ledgers, ledger payments. Ported from
//! staging.sql §50 and extended with `processing` and `void` payment rows,
//! which staging never covered.
//!
//! trg_sync_booking_payment_status recomputes bookings.payment_status on every
//! payment write: settled = completed payments of type booking/service/damage.
//! 'refunded'/'unpaid_deposit' are app-set states the trigger never emits, so
//! the final explicit UPDATEs mirror the refund flow (which writes
//! payment_status after recording the refund row).

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL_PAYMENTS).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_INVOICES).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_LEDGERS).execute(&mut **tx).await?;
    Ok(())
}

const SQL_PAYMENTS: &str = r#"
-- Bulk history payments: one completed payment per completed stay.
INSERT INTO public.payments (
    id, booking_id, amount, currency, payment_method, payment_type,
    transaction_id, payment_gateway, status, processed_at, processed_by,
    idempotency_key, created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT
    804000 + (b.id - 802000),
    b.id,
    b.total_amount + b.tourism_tax_amount + COALESCE(b.extra_bed_charge, 0),
    'USD',
    (ARRAY['credit_card','cash','online_payment','ewallet','bank_transfer','debit_card'])[(b.id - 802000) % 6 + 1],
    'booking',
    'TXN-STG-' || lpad((b.id - 802000)::text, 5, '0'),
    'stripe',
    'completed',
    b.check_in_date::timestamptz - interval '2 days',
    800006,
    'stg-pay-' || lpad((b.id - 802000)::text, 5, '0'),
    800006,
    b.check_in_date::timestamptz - interval '2 days'
FROM public.bookings b
WHERE b.id BETWEEN 802001 AND 802045
ORDER BY b.id;

-- Explicit payment scenarios.
INSERT INTO public.payments (
    id, booking_id, amount, currency, payment_method, payment_type,
    transaction_id, card_last_four, card_brand, payment_gateway,
    status, failure_reason, refund_amount, refunded_at, refund_reason,
    gateway_refund_id, notes, processed_at, processed_by, idempotency_key,
    created_by, created_at
)
OVERRIDING SYSTEM VALUE VALUES
    -- 802101 in-house: keycard deposit (collateral — excluded from settlement)
    -- plus a partial room payment -> payment_status 'partial'.
    (804101, 802101, 50.00, 'USD', 'credit_card', 'deposit', 'TXN-STG-1010', '4242', 'visa', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Keycard deposit', (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours', 800002, 'stg-pay-dep-101', 800002, (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours'),
    (804102, 802101, 500.00, 'USD', 'credit_card', 'booking', 'TXN-STG-1011', '4242', 'visa', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Part payment at check-in', (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours', 800002, 'stg-pay-part-101', 800002, (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours'),
    -- 802102 in-house: fully settled online incl. tourism tax (30).
    (804103, 802102, 1812.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1012', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Full prepayment', (SELECT today-10 FROM staging_ref)::timestamptz, 800006, 'stg-pay-102', 800006, (SELECT today-10 FROM staging_ref)::timestamptz),
    -- 802104 checked out: room payment + keycard deposit + its refund row.
    (804104, 802104, 560.00, 'USD', 'credit_card', 'booking', 'TXN-STG-1013', '1005', 'mastercard', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-12 FROM staging_ref)::timestamptz, 800006, 'stg-pay-104', 800006, (SELECT today-12 FROM staging_ref)::timestamptz),
    (804105, 802104, 50.00, 'USD', 'credit_card', 'deposit', 'TXN-STG-1014', '1005', 'mastercard', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Keycard deposit', (SELECT today-2 FROM staging_ref)::timestamptz + interval '15 hours', 800002, 'stg-pay-dep-104', 800002, (SELECT today-2 FROM staging_ref)::timestamptz + interval '15 hours'),
    (804106, 802104, 50.00, 'USD', 'credit_card', 'refund', 'TXN-STG-1015', '1005', 'mastercard', 'stripe', 'refunded', NULL, NULL, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', NULL, 're_804106', 'Keycard deposit refund', (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', 800002, 'stg-pay-ref-104', 800002, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours'),
    -- 802105 checked out: ewallet settlement.
    (804107, 802105, 172.00, 'USD', 'ewallet', 'booking', 'TXN-STG-1016', NULL, NULL, 'ewallet_grabpay', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-6 FROM staging_ref)::timestamptz, 800006, 'stg-pay-105', 800006, (SELECT today-6 FROM staging_ref)::timestamptz),
    -- 802106 arriving today: corporate settlement.
    (804108, 802106, 1448.17, 'USD', 'company_billing', 'booking', 'PO-TC-2026-Q3-0001', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'TechCorp PO settlement', (SELECT today-2 FROM staging_ref)::timestamptz, 800006, 'stg-pay-106', 800006, (SELECT today-2 FROM staging_ref)::timestamptz),
    -- 802107 arriving today: part bank transfer.
    (804109, 802107, 270.00, 'USD', 'bank_transfer', 'booking', 'TT-STG-2201', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Half paid by transfer', (SELECT today-1 FROM staging_ref)::timestamptz, 800006, 'stg-pay-107', 800006, (SELECT today-1 FROM staging_ref)::timestamptz),
    -- 802109 future: fully prepaid advance-purchase.
    (804110, 802109, 1582.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1017', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Advance-purchase prepay', (SELECT today-16 FROM staging_ref)::timestamptz, 800006, 'stg-pay-109', 800006, (SELECT today-16 FROM staging_ref)::timestamptz),
    -- 802115 voided: original payment refunded in full.
    (804111, 802115, 516.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1018', NULL, NULL, 'stripe', 'refunded', NULL, 516.00, (SELECT today-1 FROM staging_ref)::timestamptz, 'Cancellation >48h — full refund', 're_804111', 'Full refund on void', (SELECT today-9 FROM staging_ref)::timestamptz, 800006, 'stg-pay-111', 800006, (SELECT today-9 FROM staging_ref)::timestamptz),
    -- 802116 completed: card settlement.
    (804112, 802116, 486.00, 'USD', 'credit_card', 'booking', 'TXN-STG-1019', '4343', 'visa', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-11 FROM staging_ref)::timestamptz, 800006, 'stg-pay-112', 800006, (SELECT today-11 FROM staging_ref)::timestamptz),
    -- 802121 OTA paid online (incl. tourism tax 30).
    (804113, 802121, 321.60, 'USD', 'online_payment', 'booking', 'TXN-STG-1020', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-11 FROM staging_ref)::timestamptz, 800006, 'stg-pay-113', 800006, (SELECT today-11 FROM staging_ref)::timestamptz),
    -- 802122 long stay: staged part payments (2 of 3 instalments).
    (804114, 802122, 1000.00, 'USD', 'bank_transfer', 'booking', 'TT-STG-2202', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Instalment 1 of 3', (SELECT today-20 FROM staging_ref)::timestamptz, 800006, 'stg-pay-114', 800006, (SELECT today-20 FROM staging_ref)::timestamptz),
    (804115, 802122, 700.00, 'USD', 'bank_transfer', 'booking', 'TT-STG-2203', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Instalment 2 of 3', (SELECT today-3 FROM staging_ref)::timestamptz, 800006, 'stg-pay-115', 800006, (SELECT today-3 FROM staging_ref)::timestamptz),
    -- 802125 high-value: partial company settlement.
    (804116, 802125, 2000.00, 'USD', 'company_billing', 'booking', 'PO-TC-2026-Q3-0002', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'TechCorp part settlement', (SELECT today-5 FROM staging_ref)::timestamptz, 800006, 'stg-pay-116', 800006, (SELECT today-5 FROM staging_ref)::timestamptz),
    -- 802130 portal stay: settled online.
    (804117, 802130, 486.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1021', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Portal prepay', (SELECT today-6 FROM staging_ref)::timestamptz, 800006, 'stg-pay-117', 800006, (SELECT today-6 FROM staging_ref)::timestamptz),
    -- 802112 pending_payment hold: a failed card attempt (does not settle).
    (804118, 802112, 291.60, 'USD', 'online_payment', 'booking', 'TXN-STG-1022', '4002', 'visa', 'stripe', 'failed', 'card_declined', NULL, NULL, NULL, NULL, 'First attempt failed — retry link mailed', (SELECT today-4 FROM staging_ref)::timestamptz, NULL, 'stg-pay-118', 800006, (SELECT today-4 FROM staging_ref)::timestamptz),
    -- 802111 pending: gateway attempt still pending.
    (804119, 802111, 97.20, 'USD', 'online_payment', 'booking', 'TXN-STG-1023', NULL, NULL, 'stripe', 'pending', NULL, NULL, NULL, NULL, NULL, 'Awaiting gateway confirmation', CURRENT_TIMESTAMP - interval '2 hours', NULL, 'stg-pay-119', 800006, CURRENT_TIMESTAMP - interval '2 hours'),
    -- 802101 second partial payment scenario: service charge paid.
    (804120, 802101, 70.00, 'USD', 'cash', 'service', 'TXN-STG-1024', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Breakfast x2 settled at desk', (SELECT today FROM staging_ref)::timestamptz + interval '8 hours', 800002, 'stg-pay-120', 800002, (SELECT today FROM staging_ref)::timestamptz + interval '8 hours'),
    -- 802103 corporate in-house: partial direct-bill settlement.
    (804121, 802103, 400.00, 'USD', 'company_billing', 'booking', 'PO-GLX-0091', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Globex interim settlement', (SELECT today-1 FROM staging_ref)::timestamptz, 800006, 'stg-pay-121', 800006, (SELECT today-1 FROM staging_ref)::timestamptz),
    -- 802117 comp stay: guest settles the tourism tax only (foreign guest).
    (804122, 802117, 20.00, 'USD', 'cash', 'booking', 'TXN-STG-1025', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Tourism tax on comp stay', (SELECT today FROM staging_ref)::timestamptz - interval '1 day', 800002, 'stg-pay-122', 800002, (SELECT today FROM staging_ref)::timestamptz - interval '1 day'),
    -- 'processing': gateway has the auth, settlement not confirmed (802126).
    (804123, 802126, 324.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1026', NULL, NULL, 'stripe', 'processing', NULL, NULL, NULL, NULL, NULL, 'Gateway processing — awaiting capture', CURRENT_TIMESTAMP - interval '40 minutes', NULL, 'stg-pay-123', 800006, CURRENT_TIMESTAMP - interval '40 minutes'),
    -- 'void': duplicate charge voided before capture (802111's second attempt).
    (804124, 802111, 97.20, 'USD', 'online_payment', 'booking', 'TXN-STG-1027', '4242', 'visa', 'stripe', 'void', NULL, NULL, NULL, NULL, NULL, 'Duplicate submission voided', (SELECT today-1 FROM staging_ref)::timestamptz, 800006, 'stg-pay-124', 800006, (SELECT today-1 FROM staging_ref)::timestamptz),
    -- Anonymous booking 802202 settled online (pairs with its access token).
    (804125, 802202, 194.40, 'USD', 'online_payment', 'booking', 'TXN-STG-1028', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Anonymous prepay — B-STG-0202', (SELECT today-2 FROM staging_ref)::timestamptz, 800006, 'stg-pay-125', 800006, (SELECT today-2 FROM staging_ref)::timestamptz),
    (804126, 802203, 194.40, 'USD', 'online_payment', 'booking', 'TXN-STG-1029', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Anonymous prepay — B-STG-0203', (SELECT today-1 FROM staging_ref)::timestamptz, 800006, 'stg-pay-126', 800006, (SELECT today-1 FROM staging_ref)::timestamptz);

-- Receipt-upload requests against two payments.
INSERT INTO public.payment_receipt_requests (payment_id, requested_by, request_message, requested_at, uploaded_at)
VALUES
    (804109, 800006, 'Please upload the bank transfer slip for reconciliation', (SELECT today-1 FROM staging_ref)::timestamptz, NULL),
    (804114, 800006, 'Receipt required for instalment 1', (SELECT today-19 FROM staging_ref)::timestamptz, (SELECT today-18 FROM staging_ref)::timestamptz);

-- One unconsumed retry capability for the failed payment on 802112.
INSERT INTO public.payment_retry_capabilities (id, booking_id, payment_id, token_hash, expires_at)
OVERRIDING SYSTEM VALUE VALUES
    (804301, 802112, 804118, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000001', (SELECT today+2 FROM staging_ref)::timestamptz);

-- App-set payment statuses the trigger never emits.
UPDATE public.bookings SET payment_status = 'refunded' WHERE id = 802115;
UPDATE public.bookings SET payment_status = 'unpaid_deposit' WHERE id = 802114;
"#;

const SQL_INVOICES: &str = r#"
INSERT INTO public.invoices (
    id, invoice_number, booking_id, bill_to_guest_id, bill_to_corporate_id,
    billing_name, billing_address, billing_email, tax_id,
    issue_date, due_date, subtotal, tax_amount, discount_amount, total_amount,
    paid_amount, currency, line_items, status, invoice_type,
    room_charges, service_charges, created_by, sent_at, paid_at, notes
)
OVERRIDING SYSTEM VALUE VALUES
    (804501, 'INV-2026-STG-001', 802101, 801001, NULL, 'Aisha Rahman', 'Kuala Lumpur', 'aisha.rahman@staging.hotel-app.test', NULL,
        (SELECT today-1 FROM staging_ref), (SELECT today+4 FROM staging_ref), 1720.00, 137.60, 82.50, 1775.10, 550.00, 'USD',
        '[{"description":"Premier Suite x 3 nights","quantity":3,"unit_price":550.00,"amount":1650.00},{"description":"Breakfast Buffet x2","quantity":2,"unit_price":35.00,"amount":70.00},{"description":"Service tax 8%","quantity":1,"unit_price":137.60,"amount":137.60},{"description":"Loyalty discount 5%","quantity":1,"unit_price":-82.50,"amount":-82.50}]'::jsonb,
        'issued', 'booking', 1650.00, 70.00, 800006, (SELECT today-1 FROM staging_ref)::timestamptz, NULL, 'Balance due at check-out'),
    (804502, 'INV-2026-STG-002', 802104, 801004, NULL, 'Kenji Takahashi', 'Osaka, Japan', 'kenji.takahashi@staging.hotel-app.test', NULL,
        (SELECT today-2 FROM staging_ref), (SELECT today FROM staging_ref), 590.00, 43.20, 0.00, 633.20, 633.20, 'USD',
        '[{"description":"Deluxe Room x 2 nights","quantity":2,"unit_price":250.00,"amount":500.00},{"description":"Laundry x2","quantity":2,"unit_price":25.00,"amount":50.00},{"description":"Service tax 8%","quantity":1,"unit_price":44.00,"amount":44.00},{"description":"Tourism tax x2 nights","quantity":2,"unit_price":10.00,"amount":20.00}]'::jsonb,
        'paid', 'booking', 500.00, 50.00, 800006, (SELECT today-2 FROM staging_ref)::timestamptz, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', NULL),
    (804503, 'INV-2026-STG-003', 802116, 801002, NULL, 'Marcus Tan', 'Petaling Jaya', 'marcus.tan@staging.hotel-app.test', NULL,
        (SELECT today-10 FROM staging_ref), (SELECT today-3 FROM staging_ref), 450.00, 36.00, 0.00, 486.00, 486.00, 'USD',
        '[{"description":"Standard Room x 3 nights","quantity":3,"unit_price":150.00,"amount":450.00},{"description":"Service tax 8%","quantity":1,"unit_price":36.00,"amount":36.00}]'::jsonb,
        'paid', 'booking', 450.00, 0.00, 800006, (SELECT today-10 FROM staging_ref)::timestamptz, (SELECT today-7 FROM staging_ref)::timestamptz, NULL),
    -- Overdue corporate invoice.
    (804504, 'INV-2026-STG-004', 802116, NULL, '80000000-0000-4000-8000-000000000002', 'Globex (Malaysia) Sdn Bhd', 'Suite 8, Wisma UOA, Kuala Lumpur', 'ap@globex.staging.hotel-app.test', 'C-GLBX-117',
        (SELECT today-40 FROM staging_ref), (SELECT today-10 FROM staging_ref), 2400.00, 192.00, 300.00, 2292.00, 0.00, 'USD',
        '[{"description":"Corporate stays — August block","quantity":8,"unit_price":300.00,"amount":2400.00},{"description":"Service tax 8%","quantity":1,"unit_price":192.00,"amount":192.00},{"description":"Contract discount 12.5%","quantity":1,"unit_price":-300.00,"amount":-300.00}]'::jsonb,
        'overdue', 'booking', 2400.00, 0.00, 800006, (SELECT today-40 FROM staging_ref)::timestamptz, NULL, 'Second reminder sent'),
    -- Draft invoice not yet issued.
    (804505, 'INV-2026-STG-005', 802103, NULL, '80000000-0000-4000-8000-000000000002', 'Globex (Malaysia) Sdn Bhd', 'Suite 8, Wisma UOA, Kuala Lumpur', 'ap@globex.staging.hotel-app.test', 'C-GLBX-117',
        (SELECT today FROM staging_ref), (SELECT today+30 FROM staging_ref), 900.00, 72.00, 112.50, 859.50, 0.00, 'USD',
        '[{"description":"Deluxe Room x 4 nights (corp rate)","quantity":4,"unit_price":225.00,"amount":900.00},{"description":"Service tax 8%","quantity":1,"unit_price":72.00,"amount":72.00},{"description":"Contract discount 12.5%","quantity":1,"unit_price":-112.50,"amount":-112.50}]'::jsonb,
        'draft', 'booking', 900.00, 0.00, 800006, NULL, NULL, 'Issue at checkout'),
    -- Voided invoice (raised in error then voided).
    (804506, 'INV-2026-STG-006', 802127, 801018, NULL, 'Daniel Lee', 'Kuala Lumpur', 'daniel.lee@staging.hotel-app.test', NULL,
        (SELECT today-6 FROM staging_ref), (SELECT today+1 FROM staging_ref), 300.00, 24.00, 0.00, 324.00, 0.00, 'USD',
        '[{"description":"Standard Room x 2 nights","quantity":2,"unit_price":150.00,"amount":300.00},{"description":"Service tax 8%","quantity":1,"unit_price":24.00,"amount":24.00}]'::jsonb,
        'void', 'booking', 300.00, 0.00, 800006, (SELECT today-6 FROM staging_ref)::timestamptz, NULL, 'Voided — rebilled under INV-2026-STG-007'),
    (804507, 'INV-2026-STG-007', 802127, 801018, NULL, 'Daniel Lee', 'Kuala Lumpur', 'daniel.lee@staging.hotel-app.test', NULL,
        (SELECT today-5 FROM staging_ref), (SELECT today+25 FROM staging_ref), 300.00, 24.00, 0.00, 324.00, 0.00, 'USD',
        '[{"description":"Standard Room x 2 nights","quantity":2,"unit_price":150.00,"amount":300.00},{"description":"Service tax 8%","quantity":1,"unit_price":24.00,"amount":24.00}]'::jsonb,
        'issued', 'booking', 300.00, 0.00, 800006, (SELECT today-5 FROM staging_ref)::timestamptz, NULL, 'Unpaid stay — collections follow-up'),
    -- Refunded invoice behind the voided booking.
    (804508, 'INV-2026-STG-008', 802115, 801003, NULL, 'Emily Wilson', 'London, UK', 'emily.wilson@staging.hotel-app.test', NULL,
        (SELECT today-9 FROM staging_ref), (SELECT today-2 FROM staging_ref), 450.00, 36.00, 0.00, 486.00, 486.00, 'USD',
        '[{"description":"Standard Room x 3 nights","quantity":3,"unit_price":150.00,"amount":450.00},{"description":"Service tax 8%","quantity":1,"unit_price":36.00,"amount":36.00}]'::jsonb,
        'refunded', 'booking', 450.00, 0.00, 800006, (SELECT today-9 FROM staging_ref)::timestamptz, (SELECT today-8 FROM staging_ref)::timestamptz, 'Fully refunded — booking voided');
"#;

const SQL_LEDGERS: &str = r#"
-- City ledgers (corporate direct-bill); folio/invoice numbers are generated
-- by ledger triggers when omitted.
INSERT INTO public.customer_ledgers (
    id, company_name, company_registration_number, contact_person, contact_email,
    description, expense_type, amount, currency, status, paid_amount,
    booking_id, guest_id, invoice_date, due_date, post_type, transaction_type,
    folio_type, posting_date, transaction_date, is_posted, posted_at, created_by
)
OVERRIDING SYSTEM VALUE VALUES
    (804801, 'TechCorp Solutions Sdn Bhd', 'SA-2011-00442', 'Diana Lim', 'ap@techcorp.staging.hotel-app.test',
        'Room charges — TechCorp September block', 'accommodation', 4800.00, 'MYR', 'partial', 2400.00,
        NULL, NULL, (SELECT today-20 FROM staging_ref), (SELECT today+10 FROM staging_ref), 'room_charge', 'debit',
        'city_ledger', (SELECT today-20 FROM staging_ref), (SELECT today-20 FROM staging_ref), true, (SELECT today-20 FROM staging_ref)::timestamptz + interval '23 hours', 800006),
    (804802, 'TechCorp Solutions Sdn Bhd', 'SA-2011-00442', 'Diana Lim', 'ap@techcorp.staging.hotel-app.test',
        'Payment received — TT TT-STG-3301', 'payment', 2400.00, 'MYR', 'paid', 2400.00,
        NULL, NULL, (SELECT today-8 FROM staging_ref), NULL, 'payment', 'credit',
        'city_ledger', (SELECT today-8 FROM staging_ref), (SELECT today-8 FROM staging_ref), true, (SELECT today-8 FROM staging_ref)::timestamptz, 800006),
    (804803, 'Globex (Malaysia) Sdn Bhd', 'SA-2009-00117', 'Harold Sim', 'travel@globex.staging.hotel-app.test',
        'Room charges — Globex August stays', 'accommodation', 6250.00, 'MYR', 'overdue', 0.00,
        NULL, NULL, (SELECT today-45 FROM staging_ref), (SELECT today-15 FROM staging_ref), 'room_charge', 'debit',
        'city_ledger', (SELECT today-45 FROM staging_ref), (SELECT today-45 FROM staging_ref), true, (SELECT today-45 FROM staging_ref)::timestamptz + interval '23 hours', 800006),
    (804804, 'Globex (Malaysia) Sdn Bhd', 'SA-2009-00117', 'Harold Sim', 'travel@globex.staging.hotel-app.test',
        'In-stay charges — B-STG-1003', 'accommodation', 859.50, 'MYR', 'pending', 0.00,
        802103, NULL,   (SELECT today FROM staging_ref), (SELECT today+45 FROM staging_ref), 'room_charge', 'debit',
        'city_ledger', (SELECT today FROM staging_ref), (SELECT today FROM staging_ref), false, NULL, 800006),
    -- One voided ledger entry (posted in error).
    (804805, 'Initech Events', 'SA-2019-00788', NULL, 'events@initech.staging.hotel-app.test',
        'Event deposit — voided duplicate', 'accommodation', 1500.00, 'MYR', 'void', 0.00,
        NULL, NULL, (SELECT today-30 FROM staging_ref), NULL, 'advance_deposit', 'debit',
        'city_ledger', (SELECT today-30 FROM staging_ref), (SELECT today-30 FROM staging_ref), false, NULL, 800006);

UPDATE public.customer_ledgers SET void_at = (SELECT today-29 FROM staging_ref)::timestamptz, void_by = 800006, void_reason = 'Duplicate posting' WHERE id = 804805;

INSERT INTO public.customer_ledger_payments (id, ledger_id, payment_amount, payment_method, payment_reference, payment_date, receipt_number, notes, processed_by)
OVERRIDING SYSTEM VALUE VALUES
    (804901, 804801, 2400.00, 'bank_transfer', 'TT-STG-3301', (SELECT today-8 FROM staging_ref)::timestamptz, 'RCP-STG-0001', 'Part settlement', 800006);
"#;
