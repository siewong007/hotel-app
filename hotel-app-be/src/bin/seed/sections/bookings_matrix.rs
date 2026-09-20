//! Booking matrix: 45 deterministic completed stays over the past ~4 months
//! (dashboard/occupancy filler) plus the hand-authored lifecycle matrix —
//! every non-"today" status: pending, pending_payment, pending_confirmation,
//! confirmed (incl. OTA/corporate/edge cases), no_show, voided, completed,
//! fully/partial complimentary, comp_void. Ported from staging.sql §40.
//!
//! Active-status rows get distinct rooms or disjoint windows to respect the
//! bookings_no_room_date_overlap exclusion — overlapping active stays are
//! DB-impossible by design and exercised by API tests, not fixtures.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL_HISTORY_FILL).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_MATRIX).execute(&mut **tx).await?;
    Ok(())
}

// `completed`/`checked_out`/`no_show`/`voided` are outside the
// bookings_no_room_date_overlap EXCLUDE predicate, so filler cannot
// double-book a room even where windows coincide.
const SQL_HISTORY_FILL: &str = r#"
INSERT INTO public.bookings (
    id, booking_number, guest_id, guest_name, room_id,
    check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, discount_amount, discount_percentage,
    total_amount, currency, status, payment_status,
    source, booking_channel_id, channel,
    actual_check_in, actual_check_out,
    is_posted, posted_date, posted_by,
    created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT
    802000 + n,
    'B-STG-' || lpad(n::text, 5, '0'),
    gst.id,
    gst.nick_name,
    rm.id,
    ci,
    ci + nights,
    v_adults,
    v_children,
    rt.base_price,
    ROUND(rt.base_price * nights, 2),
    ROUND(rt.base_price * nights * 0.08, 2),
    CASE WHEN gst.discount_percentage > 0
         THEN ROUND(rt.base_price * nights * gst.discount_percentage / 100, 2)
         ELSE 0 END,
    gst.discount_percentage,
    ROUND(rt.base_price * nights, 2)
        + ROUND(rt.base_price * nights * 0.08, 2)
        - CASE WHEN gst.discount_percentage > 0
               THEN ROUND(rt.base_price * nights * gst.discount_percentage / 100, 2)
               ELSE 0 END,
    'USD',
    'completed',
    'paid',
    (ARRAY['direct','website','ota','phone','walk_in'])[n % 5 + 1],
    bc.id,
    bc.name,
    (ci + interval '15 hours'),
    (ci + nights + interval '11 hours'),
    true, ci + nights, 800002,
    CASE WHEN n % 2 = 0 THEN 800002 ELSE 800003 END,
    (ci - (3 + n % 18))::timestamptz + interval '10 hours'
FROM generate_series(1, 45) AS n
JOIN LATERAL (
    SELECT 800300 + ((n - 1) % 20) + 1 AS room_id
) r ON true
JOIN public.rooms rm ON rm.id = r.room_id
JOIN public.room_types rt ON rt.id = rm.room_type_id
JOIN LATERAL (
    SELECT (SELECT today FROM staging_ref) - (140 - n * 3) AS ci,
           1 + (n % 3) AS nights
) d ON true
JOIN public.guests gst ON gst.id = 801000 + (n % 20) + 1
JOIN LATERAL (
    SELECT CASE WHEN rt.code = 'ECO' THEN 1 ELSE 1 + (n % 2) END AS v_adults,
           CASE WHEN rt.max_occupancy - (1 + (n % 2)) > 0 THEN n % 2 ELSE 0 END AS v_children
) occ ON true
LEFT JOIN public.booking_channels bc ON bc.channel_type =
    CASE (ARRAY['direct','website','ota','phone','walk_in'])[n % 5 + 1]
        WHEN 'direct' THEN 'direct' WHEN 'website' THEN 'website'
        WHEN 'ota' THEN 'ota' WHEN 'phone' THEN 'phone' ELSE 'walk_in' END
   AND bc.name = CASE (ARRAY['direct','website','ota','phone','walk_in'])[n % 5 + 1]
        WHEN 'ota' THEN 'Booking.com' WHEN 'website' THEN 'Direct Website'
        WHEN 'phone' THEN 'Phone' WHEN 'walk_in' THEN 'Walk-in' ELSE 'Direct' END;
"#;

const SQL_MATRIX: &str = r#"
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
    -- Future confirmed/pending spread.
    (802108,'B-STG-1008',NULL,801014,'Lucy K.','lucy.kim@staging.hotel-app.test','+82-10-0000-0014',NULL::uuid,800320,
        (SELECT today+5 FROM staging_ref),(SELECT today+8 FROM staging_ref),2,0,0,800503,632.50,1897.50,151.80,0.00,0.00,2049.30,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,'Honeymoon — flowers in room','Honeymoon setup arranged w/ HK','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '7 days'),
    (802109,'B-STG-1009',NULL,801008,'James O.','james.obrien@staging.hotel-app.test','+353-87-000-0008',NULL::uuid,800314,
        (SELECT today+10 FROM staging_ref),(SELECT today+17 FROM staging_ref),1,0,0,800504,200.00,1400.00,112.00,0.00,0.00,1512.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','paid','online_payment','LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Advance-purchase rate, prepaid','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '16 days'),
    (802111,'B-STG-1011',NULL,801012,'Sofia M.','sofia.mendoza@staging.hotel-app.test',NULL,NULL::uuid,800302,
        (SELECT today+3 FROM staging_ref),(SELECT today+4 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,NULL,'phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '1 day'),
    -- pending_payment: unpaid online hold (release scheduler watches these).
    (802112,'B-STG-1012',NULL,801013,'Tom H.','tom.hardy@staging.hotel-app.test','+61-400-000-013',NULL::uuid,800303,
        (SELECT today+2 FROM staging_ref),(SELECT today+5 FROM staging_ref),1,0,0,800501,90.00,270.00,21.60,0.00,0.00,291.60,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending_payment','unpaid',NULL,'OTA',NULL,NULL,
        NULL,NULL,false,false,NULL,'Online hold — awaiting first payment','ota','Booking.com',
        (SELECT id FROM booking_channels WHERE name='Booking.com'),'BDC-79011233',15.00,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '5 hours'),
    (802113,'B-STG-1013',NULL,801015,'Ahmad Z.','ahmad.z@staging.hotel-app.test','+60-12-600-1015',NULL::uuid,800308,
        (SELECT today+4 FROM staging_ref),(SELECT today+6 FROM staging_ref),2,0,0,800501,150.00,300.00,24.00,0.00,0.00,324.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending_confirmation','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,'Smoking room if available','Awaiting smoking-room confirmation','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '1 day'),
    -- Yesterday's no-show (deposit forfeited — payment_status UPDATE in finance).
    (802114,'B-STG-1014',NULL,801018,'Daniel L.','daniel.lee@staging.hotel-app.test','+60-12-600-1018',NULL::uuid,800309,
        (SELECT today-2 FROM staging_ref),(SELECT today-1 FROM staging_ref),1,0,0,800501,150.00,150.00,12.00,0.00,0.00,162.00,'USD',
        0,0.00,false,NULL,0,true,50.00,(SELECT today-4 FROM staging_ref)::timestamptz,
        'no_show','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'No-show; deposit forfeited','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '4 days'),
    -- Voided with refund (payment + refund rows live in finance).
    (802115,'B-STG-1015',NULL,801003,'Emily W.','emily.wilson@staging.hotel-app.test','+44-7700-901003',NULL::uuid,800310,
        (SELECT today+6 FROM staging_ref),(SELECT today+9 FROM staging_ref),2,0,0,800501,150.00,450.00,36.00,0.00,0.00,486.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'voided','refunded','online_payment','LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Cancelled >48h out — full refund issued','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz,800001,'Guest requested cancellation — full refund',false,NULL,800002,CURRENT_TIMESTAMP-interval '9 days'),
    -- Recent posted stay.
    (802116,'B-STG-1016',NULL,801002,'Marcus T.','marcus.tan@staging.hotel-app.test','+60-12-600-1002',NULL::uuid,800311,
        (SELECT today-10 FROM staging_ref),(SELECT today-7 FROM staging_ref),2,0,0,800501,150.00,450.00,36.00,0.00,0.00,486.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'completed','paid','credit_card','CORP',NULL,NULL,
        (SELECT today-10 FROM staging_ref)::timestamptz+interval '15 hours',(SELECT today-7 FROM staging_ref)::timestamptz+interval '11 hours',false,false,
        'King bed only',NULL,'direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,true,(SELECT today-7 FROM staging_ref),800002,CURRENT_TIMESTAMP-interval '15 days'),
    -- Complimentary stay (payment_status stays 'paid' per trigger branch).
    (802117,'B-STG-1017',NULL,801006,'Chen W.','chen.wei@staging.hotel-app.test','+86-138-0000-0006',NULL::uuid,800316,
        (SELECT today+14 FROM staging_ref),(SELECT today+16 FROM staging_ref),2,0,0,800501,250.00,0.00,0.00,500.00,100.00,0.00,'USD',
        0,0.00,true,'VIP goodwill — service recovery',2,false,0.00,NULL,
        'fully_complimentary','paid',NULL,'CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,NULL,'Fully complimentary — GM approved','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '2 days'),
    -- Partial complimentary: 1 of 3 nights comped.
    (802118,'B-STG-1018',NULL,801001,'Aisha R.','aisha.rahman@staging.hotel-app.test','+60-12-600-1001',NULL::uuid,800317,
        (SELECT today+20 FROM staging_ref),(SELECT today+23 FROM staging_ref),2,0,0,800501,250.00,750.00,60.00,250.00,33.33,560.00,'USD',
        0,0.00,true,'Loyalty free-night redemption',1,false,0.00,NULL,
        'partial_complimentary','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'One night comped via loyalty reward','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '1 day'),
    -- Multi-guest family at capacity boundary (PRE max_occupancy = 4).
    (802119,'B-STG-1019',NULL,801007,'Fatimah A.','fatimah.abdullah@staging.hotel-app.test','+60-12-600-1007',NULL::uuid,800322,
        (SELECT today+12 FROM staging_ref),(SELECT today+15 FROM staging_ref),2,2,0,800501,550.00,1650.00,132.00,0.00,0.00,1782.00,'USD',
        1,180.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,'Extra bed + connecting room if available','Family of 4 at max occupancy','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '4 days'),
    -- OTA booking with commission math.
    (802120,'B-STG-1020',NULL,801009,'Diana L.','diana.lim@staging.hotel-app.test','+60-12-600-1009','80000000-0000-4000-8000-000000000001'::uuid,800312,
        (SELECT today+7 FROM staging_ref),(SELECT today+10 FROM staging_ref),2,0,0,800502,135.00,405.00,32.40,50.63,12.50,386.77,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid','company_billing','CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,NULL,'Bill to TechCorp; PO TC-2026-Q3 required','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '8 days'),
    (802121,'B-STG-1021',NULL,801013,'Tom H.','tom.hardy@staging.hotel-app.test','+61-400-000-013',NULL::uuid,800304,
        (SELECT today+8 FROM staging_ref),(SELECT today+11 FROM staging_ref),1,0,0,800501,90.00,270.00,21.60,0.00,0.00,291.60,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','paid','online_payment','OTA',NULL,NULL,
        NULL,NULL,false,false,NULL,NULL,'ota','Expedia',
        (SELECT id FROM booking_channels WHERE name='Expedia'),'EXP-9018271',18.00,52.49,239.11,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '11 days'),
    -- 30-night long stay (max-length coverage).
    (802122,'B-STG-1022',NULL,801008,'James O.','james.obrien@staging.hotel-app.test','+353-87-000-0008',NULL::uuid,800305,
        (SELECT today+20 FROM staging_ref),(SELECT today+50 FROM staging_ref),1,0,0,800504,72.00,2160.00,172.80,0.00,0.00,2332.80,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','partial','bank_transfer','CORP',NULL,NULL,
        NULL,NULL,false,false,'Long-stay rate agreed','30-night corporate long stay','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '25 days'),
    -- Same-room disjoint-window bookings (boundary adjacency, no overlap).
    (802123,'B-STG-1023',NULL,801012,'Sofia M.','sofia.mendoza@staging.hotel-app.test',NULL,NULL::uuid,800302,
        (SELECT today+10 FROM staging_ref),(SELECT today+11 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Adjacent to B-STG-1011 — same room, no overlap','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '2 days'),
    -- Single-night minimum stay.
    (802124,'B-STG-1024',NULL,801018,'Daniel L.','daniel.lee@staging.hotel-app.test','+60-12-600-1018',NULL::uuid,800306,
        (SELECT today+1 FROM staging_ref),(SELECT today+2 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'Single-night minimum stay','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '6 hours'),
    -- High-value 10-night premier stay (large valid amount).
    (802125,'B-STG-1025',NULL,801006,'Chen W.','chen.wei@staging.hotel-app.test','+86-138-0000-0006','80000000-0000-4000-8000-000000000001'::uuid,800321,
        (SELECT today+15 FROM staging_ref),(SELECT today+25 FROM staging_ref),2,0,0,800502,495.00,4950.00,396.00,618.75,12.50,4727.25,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','partial','company_billing','CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,NULL,'Large-amount fixture; partial prepayment received','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '18 days'),
    -- Zero-discount explicit and unpaid past stay (bad-debt coverage).
    (802126,'B-STG-1026',NULL,801011,'Ravi',NULL,'+60-12-600-1011',NULL::uuid,800307,
        (SELECT today+3 FROM staging_ref),(SELECT today+5 FROM staging_ref),1,0,0,800501,150.00,300.00,24.00,0.00,0.00,324.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'Zero-discount fixture','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '1 day'),
    (802127,'B-STG-1027',NULL,801018,'Daniel L.','daniel.lee@staging.hotel-app.test','+60-12-600-1018',NULL::uuid,800310,
        (SELECT today-8 FROM staging_ref),(SELECT today-6 FROM staging_ref),1,0,0,800501,150.00,300.00,24.00,0.00,0.00,324.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_out','unpaid',NULL,'WKII',NULL,NULL,
        (SELECT today-8 FROM staging_ref)::timestamptz+interval '16 hours',(SELECT today-6 FROM staging_ref)::timestamptz+interval '10 hours',false,false,
        NULL,'Left without settling — follow up for payment','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '9 days'),
    -- Bookings on the out-of-order / maintenance rooms (status preserved by the
    -- trigger's guard branch — realistic "booked but room offline" cases).
    (802128,'B-STG-1028',NULL,801004,'Kenji T.','kenji.takahashi@staging.hotel-app.test','+81-90-1234-0004',NULL::uuid,800324,
        (SELECT today+10 FROM staging_ref),(SELECT today+13 FROM staging_ref),2,0,0,800501,450.00,1350.00,108.00,0.00,0.00,1458.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Room under maintenance — relocate before arrival','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '2 days'),
    (802129,'B-STG-1029',NULL,801005,'Priya N.','priya.nair@staging.hotel-app.test','+91-98-4500-0005',NULL::uuid,800323,
        (SELECT today+15 FROM staging_ref),(SELECT today+18 FROM staging_ref),2,0,0,800501,450.00,1350.00,108.00,0.00,0.00,1458.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Room out of order — engineering to confirm','ota','Agoda',
        (SELECT id FROM booking_channels WHERE name='Agoda'),'AGD-5577210',18.00,262.44,1195.56,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '3 days'),
    -- Second pending_payment with an aging hold (created ~30h ago vs the 24h
    -- unpaid_hold_release_hours setting — the release scheduler candidate).
    (802131,'B-STG-1031',NULL,801019,'Daniel L.','daniel.leigh@staging.hotel-app.test','+60-16-600-1019',NULL::uuid,800305,
        (SELECT today+1 FROM staging_ref),(SELECT today+3 FROM staging_ref),1,0,0,800501,90.00,180.00,14.40,0.00,0.00,194.40,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending_payment','unpaid',NULL,'OTA',NULL,NULL,
        NULL,NULL,false,false,NULL,'Aging unpaid hold — scheduler test candidate','ota','Trip.com',
        (SELECT id FROM booking_channels WHERE name='Trip.com'),'TRP-4488210',12.00,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '30 hours'),
    -- Voided complimentary stay.
    (802132,'B-STG-1032',NULL,801001,'Aisha R.','aisha.rahman@staging.hotel-app.test','+60-12-600-1001',NULL::uuid,800316,
        (SELECT today+20 FROM staging_ref),(SELECT today+22 FROM staging_ref),2,0,0,800501,250.00,0.00,0.00,500.00,100.00,0.00,'USD',
        0,0.00,true,'Event sponsor comp',2,false,0.00,NULL,
        'comp_void','void',NULL,'EVENTS',NULL,NULL,
        NULL,NULL,false,false,NULL,'Sponsor pulled out — comp voided','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz,800001,'Event cancelled by sponsor',false,NULL,800001,CURRENT_TIMESTAMP-interval '5 days')
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

-- Companion guests on the multi-guest family booking.
INSERT INTO public.booking_guests (id, booking_id, guest_id, first_name, last_name, age_group, is_primary)
OVERRIDING SYSTEM VALUE VALUES
    (803001, 802119, 801007, 'Fatimah', 'Abdullah', 'adult', true),
    (803002, 802119, NULL, 'Hassan', 'Abdullah', 'adult', false),
    (803003, 802119, NULL, 'Amira', 'Abdullah', 'child', false),
    (803004, 802119, NULL, 'Yusuf', 'Abdullah', 'child', false);
"#;
