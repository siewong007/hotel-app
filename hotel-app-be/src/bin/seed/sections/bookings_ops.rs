//! Today's front-desk working set: in-house, departing, and arriving bookings
//! (802101-802107, 802110) plus the self-check-in stay (802130), the services
//! catalog, and their add-on service rows. Ported from staging.sql §40/§50.
//!
//! Room status side effects come from the bookings trigger: checked_in rows
//! drive rooms to 'occupied', confirmed/pending rows to 'reserved' (the guard
//! preserves maintenance/out_of_order/dirty/cleaning/reserved_dirty), and
//! checked_out rows only dirty a room that was 'occupied'.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL_BOOKINGS).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_SERVICES).execute(&mut **tx).await?;
    Ok(())
}

const SQL_BOOKINGS: &str = r#"
INSERT INTO public.bookings (
    id, booking_number, folio_number, guest_id, guest_name, guest_email, guest_phone,
    corporate_account_id, room_id, check_in_date, check_out_date,
    adults, children, infants, rate_plan_id, room_rate, subtotal, tax_amount,
    discount_amount, discount_percentage, total_amount, currency,
    extra_bed_count, extra_bed_charge, is_complimentary, complimentary_reason,
    complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at,
    status, payment_status, payment_method, market_code, company_id, company_name,
    actual_check_in, actual_check_out, early_check_in, late_check_out,
    special_requests, internal_notes, source, channel, booking_channel_id,
    ota_reference, commission_rate, commission_amount, net_revenue,
    cancelled_at, cancelled_by, cancellation_reason,
    is_posted, posted_date, created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT * FROM (VALUES
    -- In-house now (rooms go 'occupied' via trigger).
    (802101,'B-STG-1001',NULL,801001,'Aisha R.','aisha.rahman@staging.hotel-app.test','+60-12-600-1001',NULL::uuid,800321,
        (SELECT today-1 FROM staging_ref),(SELECT today+2 FROM staging_ref),2,0,0,800501,550.00,1650.00,132.00,82.50,5.00,1699.50,'USD',
        0,0.00,false,NULL,0,true,50.00,(SELECT today-1 FROM staging_ref)::timestamptz+interval '6 hours',
        'checked_in','partial','credit_card','LEISURE',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz+interval '15 hours',NULL,false,false,
        'Quiet room, late dinner arrival','VIP — skyline suite pre-assigned','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL::timestamptz,NULL::bigint,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '30 days'),
    (802102,'B-STG-1002',NULL,801003,'Emily W.','emily.wilson@staging.hotel-app.test','+44-7700-901003',NULL::uuid,800322,
        (SELECT today-2 FROM staging_ref),(SELECT today+1 FROM staging_ref),2,0,0,800501,550.00,1650.00,132.00,0.00,0.00,1782.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_in','paid','online_payment','LEISURE',NULL,NULL,
        (SELECT today-2 FROM staging_ref)::timestamptz+interval '14 hours',NULL,true,false,
        'Vegetarian breakfast',NULL,'website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '10 days'),
    (802103,'B-STG-1003',NULL,801010,'Harold S.','harold.sim@staging.hotel-app.test','+60-12-600-1010','80000000-0000-4000-8000-000000000002'::uuid,800317,
        (SELECT today-3 FROM staging_ref),(SELECT today+1 FROM staging_ref),1,0,0,800502,225.00,900.00,72.00,112.50,12.50,859.50,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_in','unpaid','company_billing','CORP',801102,'Globex (Malaysia) Sdn Bhd',
        (SELECT today-3 FROM staging_ref)::timestamptz+interval '16 hours',NULL,false,false,
        NULL,'Direct-bill to Globex corporate account','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '14 days'),
    -- Departing today (trigger dirties the room only if it was 'occupied';
    -- these insert straight into checked_out so the rooms stay 'available').
    (802104,'B-STG-1004',NULL,801004,'Kenji T.','kenji.takahashi@staging.hotel-app.test','+81-90-1234-0004',NULL::uuid,800313,
        (SELECT today-2 FROM staging_ref),(SELECT today FROM staging_ref),1,0,0,800501,250.00,500.00,40.00,0.00,0.00,540.00,'USD',
        0,0.00,false,NULL,0,true,50.00,(SELECT today-2 FROM staging_ref)::timestamptz+interval '15 hours',
        'checked_out','paid','credit_card','LEISURE',NULL,NULL,
        (SELECT today-2 FROM staging_ref)::timestamptz+interval '15 hours',(SELECT today FROM staging_ref)::timestamptz+interval '10 hours',false,false,
        NULL,NULL,'ota','Booking.com',
        (SELECT id FROM booking_channels WHERE name='Booking.com'),'BDC-78381221',15.00,81.00,459.00,
        NULL,NULL,NULL,true,(SELECT today-1 FROM staging_ref),800002,CURRENT_TIMESTAMP-interval '12 days'),
    (802105,'B-STG-1005',NULL,801005,'Priya N.','priya.nair@staging.hotel-app.test','+91-98-4500-0005',NULL::uuid,800307,
        (SELECT today-1 FROM staging_ref),(SELECT today FROM staging_ref),1,0,0,800501,150.00,150.00,12.00,0.00,0.00,162.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_out','paid','ewallet','LEISURE',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz+interval '16 hours',(SELECT today FROM staging_ref)::timestamptz+interval '9 hours',false,false,
        'Early check-in requested','Early check-in granted 12:30','ota','Agoda',
        (SELECT id FROM booking_channels WHERE name='Agoda'),'AGD-5561209',18.00,29.16,132.84,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '6 days'),
    -- Arriving today (rooms go 'reserved').
    (802106,'B-STG-1006',NULL,801006,'Chen W.','chen.wei@staging.hotel-app.test','+86-138-0000-0006',NULL::uuid,800319,
        (SELECT today FROM staging_ref),(SELECT today+3 FROM staging_ref),2,0,0,800502,495.00,1485.00,118.80,185.63,12.50,1418.17,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','paid','company_billing','CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,'Airport transfer on arrival','VIP corporate — meet at lobby','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '20 days'),
    (802107,'B-STG-1007',NULL,801007,'Fatimah A.','fatimah.abdullah@staging.hotel-app.test','+60-12-600-1007',NULL::uuid,800315,
        (SELECT today FROM staging_ref),(SELECT today+2 FROM staging_ref),2,1,0,800501,250.00,500.00,40.00,0.00,0.00,540.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','partial','bank_transfer','LEISURE',NULL,NULL,
        NULL,NULL,false,false,'Connecting rooms preferred',NULL,'website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '3 days'),
    -- Same-day walk-in, unpaid (pays at the desk).
    (802110,'B-STG-1010',NULL,801011,'Ravi',NULL,'+60-12-600-1011',NULL::uuid,800301,
        (SELECT today FROM staging_ref),(SELECT today+1 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid','cash','WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'Walk-in, pays at check-in','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '2 hours'),
    -- auto_checked_in (self check-in path) — in-house now.
    (802130,'B-STG-1030',NULL,801020,'Portal Guest','guest.portal@staging.hotel-app.test','+60-12-600-1020',NULL::uuid,800309,
        (SELECT today-1 FROM staging_ref),(SELECT today+2 FROM staging_ref),1,0,0,800501,150.00,450.00,36.00,0.00,0.00,486.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'auto_checked_in','paid','online_payment','DIRECT',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz+interval '9 hours',NULL,true,false,
        NULL,'Self check-in via portal; keycard dispensed','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800013,CURRENT_TIMESTAMP-interval '6 days')
) AS v(
    id, booking_number, folio_number, guest_id, guest_name, guest_email, guest_phone,
    corporate_account_id, room_id, check_in_date, check_out_date,
    adults, children, infants, rate_plan_id, room_rate, subtotal, tax_amount,
    discount_amount, discount_percentage, total_amount, currency,
    extra_bed_count, extra_bed_charge, is_complimentary, complimentary_reason,
    complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at,
    status, payment_status, payment_method, market_code, company_id, company_name,
    actual_check_in, actual_check_out, early_check_in, late_check_out,
    special_requests, internal_notes, source, channel, booking_channel_id,
    ota_reference, commission_rate, commission_amount, net_revenue,
    cancelled_at, cancelled_by, cancellation_reason,
    is_posted, posted_date, created_by, created_at
);

-- Companion-guest row on the in-house VIP booking.
INSERT INTO public.booking_guests (id, booking_id, guest_id, first_name, last_name, age_group, is_primary)
OVERRIDING SYSTEM VALUE VALUES
    (803005, 802101, 801001, 'Aisha', 'Rahman', 'adult', true);
"#;

const SQL_SERVICES: &str = r#"
INSERT INTO public.services (id, name, category, description, unit_price, unit_type, tax_rate, is_taxable, is_active)
OVERRIDING SYSTEM VALUE VALUES
    (800401, 'Airport Transfer (KLIA)', 'transport', 'One-way sedan transfer to KLIA/KLIA2', 120.00, 'trip', 0.00, false, true),
    (800402, 'Breakfast Buffet',        'dining',    'Per-person halal buffet breakfast',     35.00,  'pax',  0.08, true,  true),
    (800403, 'Laundry — Wash & Fold',   'laundry',   'Per-bag same-day laundry',              25.00,  'bag',  0.08, true,  true),
    (800404, 'Minibar Restock',         'in_room',   'Premium minibar bundle',                60.00,  'item', 0.08, true,  true),
    (800405, 'Late Check-out (2pm)',    'front_desk','Extended checkout to 2pm',              50.00,  'item', 0.08, true,  true),
    (800406, 'Retired Service',         'legacy',    'Inactive catalog entry for filters',    10.00,  'item', 0.00, true,  false);

INSERT INTO public.booking_services (booking_id, service_id, quantity, unit_price, total_price, service_date, status, notes, created_by)
VALUES
    (802101, 800402, 2, 35.00, 70.00, (SELECT today FROM staging_ref)::timestamptz + interval '8 hours', 'completed', NULL, 800004),
    (802101, 800401, 1, 120.00, 120.00, (SELECT today + 2 FROM staging_ref)::timestamptz + interval '9 hours', 'pending', 'Departure transfer', 800002),
    (802102, 800402, 2, 35.00, 70.00, (SELECT today - 1 FROM staging_ref)::timestamptz + interval '8 hours', 'completed', 'Vegetarian covers', 800004),
    (802130, 800405, 1, 50.00, 50.00, (SELECT today + 2 FROM staging_ref)::timestamptz, 'pending', NULL, 800013),
    (802104, 800403, 2, 25.00, 50.00, (SELECT today - 1 FROM staging_ref)::timestamptz, 'completed', NULL, 800004),
    (802106, 800401, 1, 120.00, 120.00, (SELECT today FROM staging_ref)::timestamptz + interval '13 hours', 'in_progress', 'Arrival pickup — VIP', 800002);

-- The auto-checked-in stay (802130) went through the self-check-in kiosk flow.
INSERT INTO public.self_checkin_events (
    id, booking_id, guest_id, user_id, checked_in_at,
    room_key_issued, digital_key_sent, device_type, checkin_location, event_type, source
)
OVERRIDING SYSTEM VALUE VALUES
    (807501, 802130, 801020, 800013,
     (SELECT today-1 FROM staging_ref)::timestamptz + interval '9 hours',
     true, true, 'mobile', 'guest_portal', 'check_in', 'portal'),
    (807502, 802130, 801020, 800013,
     (SELECT today-1 FROM staging_ref)::timestamptz + interval '9 hours',
     true, false, 'kiosk', 'lobby_kiosk_1', 'key_issued', 'kiosk');
"#;
