-- Backfill bookings.booking_channel_id from the legacy free-text channel trail.
--
-- NOT part of the patch catalogue and nothing discovers it: run it by hand,
-- once, against a deployment that has bookings predating the structured
-- channel link. It changes business data, never schema, and a fresh install
-- has nothing for it to do.
--
--   psql "$DATABASE_URL" -f backfill-booking-channel-links.sql
--
-- Idempotent: only rows where booking_channel_id IS NULL are touched, so a
-- second run is a no-op. Re-running after new bookings arrive is harmless.
--
-- Side effect to expect: bookings.updated_at moves on every row it links,
-- because update_bookings_updated_at fires on any UPDATE. The channel columns
-- are the only business values written.
--
-- Two passes, deliberately conservative:
--   1. Parse the first '|' segment exactly as utils/report_labels.rs does
--      (strip ' - Ref:'/' Reference:' tails and a trailing ' Booking').
--   2. For rows pass 1 could not read, link only when the remarks name
--      exactly ONE known OTA anywhere. Naming two is the ambiguity that made
--      a stale note outrank a corrected one, so those are left alone.
-- Anything still unresolved keeps booking_channel_id NULL and continues to
-- render from the remarks fallback, exactly as it does today.

BEGIN;

CREATE TEMP TABLE channel_backfill_candidates ON COMMIT DROP AS
WITH parsed AS (
    SELECT b.id,
           regexp_replace(
               lower(
                   regexp_replace(
                       btrim(
                           regexp_replace(
                               split_part(COALESCE(b.remarks, ''), '|', 1),
                               '(\s+-\s*Ref:.*|\s+Reference:.*)$', '', 'i')
                       ),
                       '\s+Booking$', '', 'i')
               ),
               '[^a-z0-9]', '', 'g') AS token
    FROM bookings b
    WHERE b.booking_channel_id IS NULL
      AND lower(btrim(COALESCE(b.source, ''))) IN ('online', 'website')
),
canon AS (
    SELECT id,
           CASE token
               WHEN 'bookingcom'   THEN 'bookingcom'
               WHEN 'traveloka'    THEN 'traveloka'
               WHEN 'travelokacom' THEN 'traveloka'
               WHEN 'agoda'        THEN 'agoda'
               WHEN 'agodacom'     THEN 'agoda'
               WHEN 'expedia'      THEN 'expedia'
               WHEN 'expediacom'   THEN 'expedia'
               WHEN 'hotelscom'    THEN 'hotelscom'
               WHEN 'tripcom'      THEN 'tripcom'
               WHEN 'airbnb'       THEN 'airbnb'
               ELSE NULL
           END AS canon_token
    FROM parsed
)
SELECT c.id, bc.id AS channel_id, 1 AS pass
FROM canon c
JOIN booking_channels bc
  ON regexp_replace(lower(bc.name), '[^a-z0-9]', '', 'g') = c.canon_token
WHERE c.canon_token IS NOT NULL;

-- Pass 2: exactly one known OTA named anywhere in the remarks.
INSERT INTO channel_backfill_candidates (id, channel_id, pass)
SELECT h.id, min(h.channel_id), 2
FROM (
    SELECT b.id, bc.id AS channel_id
    FROM bookings b
    JOIN booking_channels bc
      ON bc.channel_type = 'ota'
     AND lower(COALESCE(b.remarks, '')) LIKE '%' || lower(bc.name) || '%'
    WHERE b.booking_channel_id IS NULL
      AND lower(btrim(COALESCE(b.source, ''))) IN ('online', 'website')
      AND b.id NOT IN (SELECT id FROM channel_backfill_candidates)
) h
GROUP BY h.id
HAVING count(DISTINCT h.channel_id) = 1;

UPDATE bookings b
   SET booking_channel_id = c.channel_id
  FROM channel_backfill_candidates c
 WHERE b.id = c.id
   AND b.booking_channel_id IS NULL;

\echo '--- linked, by channel and pass ---'
SELECT bc.name AS channel, c.pass, count(*) AS bookings
FROM channel_backfill_candidates c
JOIN booking_channels bc ON bc.id = c.channel_id
GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '--- still unlinked (keep rendering from remarks) ---'
SELECT status, count(*) AS bookings
FROM bookings
WHERE booking_channel_id IS NULL
  AND lower(btrim(COALESCE(source, ''))) IN ('online', 'website')
GROUP BY 1 ORDER BY 2 DESC;

COMMIT;
