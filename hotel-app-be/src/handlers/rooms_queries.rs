//! Database-specific SQL queries for rooms handlers
//!
//! This module provides query strings that work with both PostgreSQL and SQLite.

/// Get rooms query - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOMS_QUERY: &str = r#"
WITH current_bookings AS (
    SELECT DISTINCT ON (room_id)
        room_id,
        status as booking_status,
        check_in_date,
        check_out_date
    FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
      AND check_out_date >= CURRENT_DATE
    ORDER BY room_id,
        CASE
            WHEN status IN ('checked_in', 'auto_checked_in') THEN 1
            WHEN status = 'confirmed' AND check_in_date <= CURRENT_DATE THEN 2
            WHEN status = 'confirmed' THEN 3
            WHEN status = 'pending' AND check_in_date <= CURRENT_DATE THEN 4
            ELSE 5
        END,
        check_in_date
)
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN false
        WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE THEN false
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty') THEN false
        ELSE true
    END as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL::DECIMAL as average_rating,
    NULL::BIGINT as review_count,
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN 'occupied'
        WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE THEN 'reserved'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN r.status
        ELSE 'available'
    END as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
ORDER BY r.room_number
"#;

/// Get rooms query - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOMS_QUERY: &str = r#"
WITH current_bookings AS (
    SELECT
        room_id,
        status as booking_status,
        check_in_date,
        check_out_date
    FROM bookings b1
    WHERE status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
      AND check_out_date >= date('now')
      AND b1.id = (
          SELECT b2.id FROM bookings b2
          WHERE b2.room_id = b1.room_id
            AND b2.status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
            AND b2.check_out_date >= date('now')
          ORDER BY
              CASE
                  WHEN b2.status IN ('checked_in', 'auto_checked_in') THEN 1
                  WHEN b2.status = 'confirmed' AND b2.check_in_date <= date('now') THEN 2
                  WHEN b2.status = 'confirmed' THEN 3
                  WHEN b2.status = 'pending' AND b2.check_in_date <= date('now') THEN 4
                  ELSE 5
              END,
              b2.check_in_date
          LIMIT 1
      )
)
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    CAST(COALESCE(r.custom_price, rt.base_price) AS TEXT) as price_per_night,
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN 0
        WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= date('now') THEN 0
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty') THEN 0
        ELSE 1
    END as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL as average_rating,
    NULL as review_count,
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN 'occupied'
        WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= date('now') THEN 'reserved'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN r.status
        ELSE 'available'
    END as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = 1
ORDER BY r.room_number
"#;

/// Search rooms with date range - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const SEARCH_ROOMS_WITH_DATES_QUERY: &str = r#"
WITH conflicting_bookings AS (
    SELECT DISTINCT room_id
    FROM bookings
    WHERE status NOT IN ('cancelled', 'no_show', 'checked_out')
      AND (check_in_date < $2 AND check_out_date > $1)
)
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
    true as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL::DECIMAL as average_rating,
    NULL::BIGINT as review_count,
    'available' as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN conflicting_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
  AND r.status NOT IN ('maintenance', 'out_of_order')
  AND cb.room_id IS NULL
ORDER BY COALESCE(r.custom_price, rt.base_price)
"#;

/// Search rooms with date range - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const SEARCH_ROOMS_WITH_DATES_QUERY: &str = r#"
WITH conflicting_bookings AS (
    SELECT DISTINCT room_id
    FROM bookings
    WHERE status NOT IN ('cancelled', 'no_show', 'checked_out')
      AND (check_in_date < ?2 AND check_out_date > ?1)
)
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    CAST(COALESCE(r.custom_price, rt.base_price) AS TEXT) as price_per_night,
    1 as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL as average_rating,
    NULL as review_count,
    'available' as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN conflicting_bookings cb ON cb.room_id = r.id
WHERE r.is_active = 1
  AND r.status NOT IN ('maintenance', 'out_of_order')
  AND cb.room_id IS NULL
ORDER BY COALESCE(r.custom_price, rt.base_price)
"#;

/// Search rooms without date range - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const SEARCH_ROOMS_NO_DATES_QUERY: &str = r#"
WITH current_bookings AS (
    SELECT DISTINCT ON (room_id)
        room_id,
        status as booking_status,
        check_in_date
    FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
      AND check_out_date >= CURRENT_DATE
    ORDER BY room_id,
        CASE
            WHEN status IN ('checked_in', 'auto_checked_in') THEN 1
            WHEN status = 'confirmed' AND check_in_date <= CURRENT_DATE THEN 2
            ELSE 3
        END,
        check_in_date
)
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
    true as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL::DECIMAL as average_rating,
    NULL::BIGINT as review_count,
    'available' as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
  AND r.status NOT IN ('maintenance', 'out_of_order')
  AND (cb.room_id IS NULL OR NOT (
      cb.booking_status IN ('checked_in', 'auto_checked_in') OR
      (cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE)
  ))
ORDER BY COALESCE(r.custom_price, rt.base_price)
"#;

/// Search rooms without date range - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const SEARCH_ROOMS_NO_DATES_QUERY: &str = r#"
WITH current_bookings AS (
    SELECT
        room_id,
        status as booking_status,
        check_in_date
    FROM bookings b1
    WHERE status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
      AND check_out_date >= date('now')
      AND b1.id = (
          SELECT b2.id FROM bookings b2
          WHERE b2.room_id = b1.room_id
            AND b2.status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
            AND b2.check_out_date >= date('now')
          ORDER BY
              CASE
                  WHEN b2.status IN ('checked_in', 'auto_checked_in') THEN 1
                  WHEN b2.status = 'confirmed' AND b2.check_in_date <= date('now') THEN 2
                  ELSE 3
              END,
              b2.check_in_date
          LIMIT 1
      )
)
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    CAST(COALESCE(r.custom_price, rt.base_price) AS TEXT) as price_per_night,
    1 as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL as average_rating,
    NULL as review_count,
    'available' as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = 1
  AND r.status NOT IN ('maintenance', 'out_of_order')
  AND (cb.room_id IS NULL OR NOT (
      cb.booking_status IN ('checked_in', 'auto_checked_in') OR
      (cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= date('now'))
  ))
ORDER BY COALESCE(r.custom_price, rt.base_price)
"#;

/// Get room by ID - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_BY_ID_QUERY: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type,
       COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
       CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
       rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = $1
"#;

/// Get room by ID - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_BY_ID_QUERY: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type,
       CAST(COALESCE(r.custom_price, rt.base_price) AS TEXT) as price_per_night,
       CASE WHEN r.status IN ('available', 'cleaning') THEN 1 ELSE 0 END as available,
       rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = ?1
"#;

/// Update room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const UPDATE_ROOM_WITH_STATUS_QUERY: &str = r#"
UPDATE rooms
SET room_number = $1,
    custom_price = $2,
    status = $3,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $4
"#;

/// Update room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const UPDATE_ROOM_WITH_STATUS_QUERY: &str = r#"
UPDATE rooms
SET room_number = ?1,
    custom_price = ?2,
    status = ?3,
    updated_at = datetime('now')
WHERE id = ?4
"#;

/// Update room without status - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const UPDATE_ROOM_NO_STATUS_QUERY: &str = r#"
UPDATE rooms
SET room_number = $1,
    custom_price = $2,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $3
"#;

/// Update room without status - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const UPDATE_ROOM_NO_STATUS_QUERY: &str = r#"
UPDATE rooms
SET room_number = ?1,
    custom_price = ?2,
    updated_at = datetime('now')
WHERE id = ?3
"#;

/// Check room exists - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_ROOM_NUMBER_EXISTS: &str = "SELECT id FROM rooms WHERE room_number = $1";

/// Check room exists - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_ROOM_NUMBER_EXISTS: &str = "SELECT id FROM rooms WHERE room_number = ?1";

/// Check room type exists - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_ROOM_TYPE_EXISTS: &str = "SELECT id FROM room_types WHERE id = $1";

/// Check room type exists - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_ROOM_TYPE_EXISTS: &str = "SELECT id FROM room_types WHERE id = ?1";

/// Insert room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_QUERY: &str = r#"
INSERT INTO rooms (room_number, room_type_id, floor, building, custom_price, is_accessible, status, is_active)
VALUES ($1, $2, $3, $4, $5, $6, 'available', true)
RETURNING id
"#;

/// Insert room - SQLite version (no RETURNING, use last_insert_rowid)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_QUERY: &str = r#"
INSERT INTO rooms (room_number, room_type_id, floor, building, custom_price, is_accessible, status, is_active)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'available', 1)
"#;

/// Check room exists by ID - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_ROOM_EXISTS_BY_ID: &str = "SELECT id FROM rooms WHERE id = $1";

/// Check room exists by ID - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_ROOM_EXISTS_BY_ID: &str = "SELECT id FROM rooms WHERE id = ?1";

/// Check room has active booking (currently checked in) - PostgreSQL version
/// Only blocks deletion if there's a guest currently checked in
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_ROOM_HAS_ACTIVE_BOOKING: &str =
    "SELECT id FROM bookings WHERE room_id = $1 AND status = 'checked_in' LIMIT 1";

/// Check room has active booking (currently checked in) - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_ROOM_HAS_ACTIVE_BOOKING: &str =
    "SELECT id FROM bookings WHERE room_id = ?1 AND status = 'checked_in' LIMIT 1";

/// Delete all bookings for a room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const DELETE_ROOM_BOOKINGS: &str = "DELETE FROM bookings WHERE room_id = $1";

/// Delete all bookings for a room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const DELETE_ROOM_BOOKINGS: &str = "DELETE FROM bookings WHERE room_id = ?1";

/// Delete room status change logs for a room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const DELETE_ROOM_STATUS_LOGS: &str = "DELETE FROM room_status_change_log WHERE room_id = $1";

/// Delete room status change logs for a room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const DELETE_ROOM_STATUS_LOGS: &str = "DELETE FROM room_status_change_log WHERE room_id = ?1";

/// Legacy: Check room has bookings - PostgreSQL version (kept for compatibility)
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_ROOM_HAS_BOOKINGS: &str = "SELECT id FROM bookings WHERE room_id = $1 LIMIT 1";

/// Legacy: Check room has bookings - SQLite version (kept for compatibility)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_ROOM_HAS_BOOKINGS: &str = "SELECT id FROM bookings WHERE room_id = ?1 LIMIT 1";

/// Delete room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const DELETE_ROOM_QUERY: &str = "DELETE FROM rooms WHERE id = $1";

/// Delete room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const DELETE_ROOM_QUERY: &str = "DELETE FROM rooms WHERE id = ?1";

/// Check active booking - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_ACTIVE_BOOKING: &str = r#"
SELECT id FROM bookings
WHERE room_id = $1
AND status = 'checked_in'
AND check_in_date <= CURRENT_DATE
AND check_out_date >= CURRENT_DATE
LIMIT 1
"#;

/// Check active booking - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_ACTIVE_BOOKING: &str = r#"
SELECT id FROM bookings
WHERE room_id = ?1
AND status = 'checked_in'
AND check_in_date <= date('now')
AND check_out_date >= date('now')
LIMIT 1
"#;

/// Get room status - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_STATUS: &str = "SELECT status FROM rooms WHERE id = $1";

/// Get room status - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_STATUS: &str = "SELECT status FROM rooms WHERE id = ?1";

/// Get room number - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_NUMBER: &str = "SELECT room_number FROM rooms WHERE id = $1";

/// Get room number - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_NUMBER: &str = "SELECT room_number FROM rooms WHERE id = ?1";

/// Get existing room for update - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_EXISTING_ROOM_FOR_UPDATE: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type,
       COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
       CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
       rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at, r.custom_price::text
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = $1
"#;

/// Get existing room for update - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_EXISTING_ROOM_FOR_UPDATE: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type,
       CAST(COALESCE(r.custom_price, rt.base_price) AS TEXT) as price_per_night,
       CASE WHEN r.status IN ('available', 'cleaning') THEN 1 ELSE 0 END as available,
       rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at, CAST(r.custom_price AS TEXT)
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = ?1
"#;

/// Check booking valid for reservation - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CHECK_BOOKING_FOR_RESERVATION: &str = "SELECT id FROM bookings WHERE id = $1 AND room_id = $2 AND status IN ('confirmed', 'pending')";

/// Check booking valid for reservation - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CHECK_BOOKING_FOR_RESERVATION: &str = "SELECT id FROM bookings WHERE id = ?1 AND room_id = ?2 AND status IN ('confirmed', 'pending')";

/// Update room status with dates - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const UPDATE_ROOM_STATUS_WITH_DATES: &str = r#"
UPDATE rooms
SET status = $1,
    notes = COALESCE($2, notes),
    status_notes = $3,
    reserved_start_date = $4,
    reserved_end_date = $5,
    maintenance_start_date = $6,
    maintenance_end_date = $7,
    cleaning_start_date = $8,
    cleaning_end_date = $9,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $10
"#;

/// Update room status with dates - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const UPDATE_ROOM_STATUS_WITH_DATES: &str = r#"
UPDATE rooms
SET status = ?1,
    notes = COALESCE(?2, notes),
    status_notes = ?3,
    reserved_start_date = ?4,
    reserved_end_date = ?5,
    maintenance_start_date = ?6,
    maintenance_end_date = ?7,
    cleaning_start_date = ?8,
    cleaning_end_date = ?9,
    updated_at = datetime('now')
WHERE id = ?10
"#;

/// Insert room history - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_HISTORY: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status,
    start_date, end_date, changed_by, notes, is_auto_generated
)
VALUES ($1, $2, $3, $4, $5, $6, $7, false)
"#;

/// Insert room history - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_HISTORY: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status,
    start_date, end_date, changed_by, notes, is_auto_generated
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
"#;

/// Insert room event - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_EVENT: &str = r#"
INSERT INTO room_events (room_id, event_type, status, priority, notes, created_by)
VALUES ($1, 'status_change', 'completed', 'normal', $2, $3)
"#;

/// Insert room event - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_EVENT: &str = r#"
INSERT INTO room_events (room_id, event_type, status, priority, notes, created_by)
VALUES (?1, 'status_change', 'completed', 'normal', ?2, ?3)
"#;

/// Clear maintenance dates - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const CLEAR_MAINTENANCE_DATES: &str = r#"
UPDATE rooms
SET maintenance_start_date = NULL,
    maintenance_end_date = NULL,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    reserved_start_date = NULL,
    reserved_end_date = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
"#;

/// Clear maintenance dates - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const CLEAR_MAINTENANCE_DATES: &str = r#"
UPDATE rooms
SET maintenance_start_date = NULL,
    maintenance_end_date = NULL,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    reserved_start_date = NULL,
    reserved_end_date = NULL,
    updated_at = datetime('now')
WHERE id = ?1
"#;

/// End maintenance and set available - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const END_MAINTENANCE_SET_AVAILABLE: &str = r#"
UPDATE rooms
SET status = 'available',
    maintenance_start_date = NULL,
    maintenance_end_date = NULL,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    reserved_start_date = NULL,
    reserved_end_date = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
"#;

/// End maintenance and set available - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const END_MAINTENANCE_SET_AVAILABLE: &str = r#"
UPDATE rooms
SET status = 'available',
    maintenance_start_date = NULL,
    maintenance_end_date = NULL,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    reserved_start_date = NULL,
    reserved_end_date = NULL,
    updated_at = datetime('now')
WHERE id = ?1
"#;

/// Insert room history simple - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_HISTORY_SIMPLE: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status, changed_by, notes, is_auto_generated
)
VALUES ($1, $2, 'available', $3, $4, false)
"#;

/// Insert room history simple - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_HISTORY_SIMPLE: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status, changed_by, notes, is_auto_generated
)
VALUES (?1, ?2, 'available', ?3, ?4, 0)
"#;

/// End cleaning update - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const END_CLEANING_UPDATE: &str = r#"
UPDATE rooms
SET status = $1,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $2
"#;

/// End cleaning update - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const END_CLEANING_UPDATE: &str = r#"
UPDATE rooms
SET status = ?1,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    updated_at = datetime('now')
WHERE id = ?2
"#;

/// Insert room history for cleaning - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_HISTORY_CLEANING: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status, changed_by, notes, is_auto_generated
)
VALUES ($1, 'cleaning', $2, $3, 'Cleaning completed by staff', false)
"#;

/// Insert room history for cleaning - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_HISTORY_CLEANING: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status, changed_by, notes, is_auto_generated
)
VALUES (?1, 'cleaning', ?2, ?3, 'Cleaning completed by staff', 0)
"#;

/// Update booking room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const UPDATE_BOOKING_ROOM: &str = "UPDATE bookings SET room_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2";

/// Update booking room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const UPDATE_BOOKING_ROOM: &str = "UPDATE bookings SET room_id = ?1, updated_at = datetime('now') WHERE id = ?2";

/// Set room dirty - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const SET_ROOM_DIRTY: &str = "UPDATE rooms SET status = 'dirty', updated_at = CURRENT_TIMESTAMP WHERE id = $1";

/// Set room dirty - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const SET_ROOM_DIRTY: &str = "UPDATE rooms SET status = 'dirty', updated_at = datetime('now') WHERE id = ?1";

/// Set room occupied - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const SET_ROOM_OCCUPIED: &str = "UPDATE rooms SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = $1";

/// Set room occupied - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const SET_ROOM_OCCUPIED: &str = "UPDATE rooms SET status = 'occupied', updated_at = datetime('now') WHERE id = ?1";

/// Insert room change - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_CHANGE: &str = r#"
INSERT INTO room_changes (booking_id, from_room_id, to_room_id, guest_id, reason, changed_by)
VALUES ($1, $2, $3, $4, $5, $6)
"#;

/// Insert room change - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_CHANGE: &str = r#"
INSERT INTO room_changes (booking_id, from_room_id, to_room_id, guest_id, reason, changed_by)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
"#;

/// Insert room history for room change - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_HISTORY_CHANGE: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status,
    changed_by, notes, is_auto_generated
)
VALUES ($1, $2, $3, $4, $5, $6)
"#;

/// Insert room history for room change - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_HISTORY_CHANGE: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status,
    changed_by, notes, is_auto_generated
)
VALUES (?1, ?2, ?3, ?4, ?5, 0)
"#;

/// Insert booking modification - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_BOOKING_MODIFICATION: &str = r#"
INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by)
VALUES ($1, 'room_change', $2, $3, $4)
"#;

/// Insert booking modification - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_BOOKING_MODIFICATION: &str = r#"
INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by)
VALUES (?1, 'room_change', ?2, ?3, ?4)
"#;

/// Get room change history - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_CHANGE_HISTORY: &str = r#"
SELECT
    rc.id,
    rc.booking_id,
    b.booking_number,
    rc.from_room_id,
    fr.room_number as from_room_number,
    frt.name as from_room_type,
    rc.to_room_id,
    tr.room_number as to_room_number,
    trt.name as to_room_type,
    rc.guest_id,
    g.full_name as guest_name,
    rc.reason,
    rc.changed_by,
    u.full_name as changed_by_name,
    rc.changed_at
FROM room_changes rc
JOIN bookings b ON rc.booking_id = b.id
JOIN rooms fr ON rc.from_room_id = fr.id
JOIN room_types frt ON fr.room_type_id = frt.id
JOIN rooms tr ON rc.to_room_id = tr.id
JOIN room_types trt ON tr.room_type_id = trt.id
JOIN guests g ON rc.guest_id = g.id
LEFT JOIN users u ON rc.changed_by = u.id
WHERE ($1::BIGINT IS NULL OR rc.booking_id = $1)
  AND ($2::BIGINT IS NULL OR rc.guest_id = $2)
  AND ($3::BIGINT IS NULL OR rc.from_room_id = $3 OR rc.to_room_id = $3)
ORDER BY rc.changed_at DESC
LIMIT $4
"#;

/// Get room change history - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_CHANGE_HISTORY: &str = r#"
SELECT
    rc.id,
    rc.booking_id,
    b.booking_number,
    rc.from_room_id,
    fr.room_number as from_room_number,
    frt.name as from_room_type,
    rc.to_room_id,
    tr.room_number as to_room_number,
    trt.name as to_room_type,
    rc.guest_id,
    g.full_name as guest_name,
    rc.reason,
    rc.changed_by,
    u.full_name as changed_by_name,
    rc.changed_at
FROM room_changes rc
JOIN bookings b ON rc.booking_id = b.id
JOIN rooms fr ON rc.from_room_id = fr.id
JOIN room_types frt ON fr.room_type_id = frt.id
JOIN rooms tr ON rc.to_room_id = tr.id
JOIN room_types trt ON tr.room_type_id = trt.id
JOIN guests g ON rc.guest_id = g.id
LEFT JOIN users u ON rc.changed_by = u.id
WHERE (?1 IS NULL OR rc.booking_id = ?1)
  AND (?2 IS NULL OR rc.guest_id = ?2)
  AND (?3 IS NULL OR rc.from_room_id = ?3 OR rc.to_room_id = ?3)
ORDER BY rc.changed_at DESC
LIMIT ?4
"#;

/// Insert room event with scheduled date - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const INSERT_ROOM_EVENT_FULL: &str = r#"
INSERT INTO room_events (room_id, event_type, status, priority, notes, scheduled_date, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
"#;

/// Insert room event with scheduled date - SQLite version (no RETURNING)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const INSERT_ROOM_EVENT_FULL: &str = r#"
INSERT INTO room_events (room_id, event_type, status, priority, notes, scheduled_date, created_by)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
"#;

/// Get room event by ID - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_EVENT_BY_ID: &str = r#"
SELECT id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
FROM room_events WHERE id = $1
"#;

/// Get room event by ID - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_EVENT_BY_ID: &str = r#"
SELECT id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
FROM room_events WHERE id = ?1
"#;

/// Update room status simple - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const UPDATE_ROOM_STATUS_SIMPLE: &str = "UPDATE rooms SET status = $1 WHERE id = $2";

/// Update room status simple - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const UPDATE_ROOM_STATUS_SIMPLE: &str = "UPDATE rooms SET status = ?1 WHERE id = ?2";

/// Get room detailed status - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_DETAILED_STATUS: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type, r.status,
       CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
       r.notes, r.last_cleaned_at, r.last_inspected_at,
       r.reserved_start_date, r.reserved_end_date,
       r.maintenance_start_date, r.maintenance_end_date,
       r.cleaning_start_date, r.cleaning_end_date,
       r.connecting_room_id, r.status_notes
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = $1
"#;

/// Get room detailed status - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_DETAILED_STATUS: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type, r.status,
       CASE WHEN r.status IN ('available', 'cleaning') THEN 1 ELSE 0 END as available,
       r.notes, r.last_cleaned_at, r.last_inspected_at,
       r.reserved_start_date, r.reserved_end_date,
       r.maintenance_start_date, r.maintenance_end_date,
       r.cleaning_start_date, r.cleaning_end_date,
       r.connecting_room_id, r.status_notes
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = ?1
"#;

/// Get current booking for room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_CURRENT_BOOKING_FOR_ROOM: &str = r#"
SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
       b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
       b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
       b.booking_number, NULL::VARCHAR as post_type, NULL::VARCHAR as rate_code, b.created_at
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id
WHERE b.room_id = $1
  AND b.status NOT IN ('cancelled', 'checked_out')
  AND b.check_in_date <= CURRENT_DATE
  AND b.check_out_date > CURRENT_DATE
ORDER BY b.check_in_date DESC
LIMIT 1
"#;

/// Get current booking for room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_CURRENT_BOOKING_FOR_ROOM: &str = r#"
SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
       b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
       b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
       b.booking_number, NULL as post_type, NULL as rate_code, b.created_at
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id
WHERE b.room_id = ?1
  AND b.status NOT IN ('cancelled', 'checked_out')
  AND b.check_in_date <= date('now')
  AND b.check_out_date > date('now')
ORDER BY b.check_in_date DESC
LIMIT 1
"#;

/// Get next booking for room - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_NEXT_BOOKING_FOR_ROOM: &str = r#"
SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
       b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
       b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
       b.booking_number, NULL::VARCHAR as post_type, NULL::VARCHAR as rate_code, b.created_at
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id
WHERE b.room_id = $1
  AND b.status = 'confirmed'
  AND b.check_in_date > CURRENT_DATE
ORDER BY b.check_in_date ASC
LIMIT 1
"#;

/// Get next booking for room - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_NEXT_BOOKING_FOR_ROOM: &str = r#"
SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
       b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
       b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
       b.booking_number, NULL as post_type, NULL as rate_code, b.created_at
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id
WHERE b.room_id = ?1
  AND b.status = 'confirmed'
  AND b.check_in_date > date('now')
ORDER BY b.check_in_date ASC
LIMIT 1
"#;

/// Get room events - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_EVENTS: &str = r#"
SELECT id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
FROM room_events
WHERE room_id = $1
ORDER BY created_at DESC
LIMIT 10
"#;

/// Get room events - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_EVENTS: &str = r#"
SELECT id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
FROM room_events
WHERE room_id = ?1
ORDER BY created_at DESC
LIMIT 10
"#;

/// Get room history - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_HISTORY: &str = r#"
SELECT
    rh.id,
    rh.room_id,
    rh.from_status,
    rh.to_status,
    rh.start_date,
    rh.end_date,
    rh.changed_by,
    u.full_name as changed_by_name,
    rh.created_at,
    rh.notes,
    rh.is_auto_generated
FROM room_history rh
LEFT JOIN users u ON rh.changed_by = u.id
WHERE rh.room_id = $1
ORDER BY rh.created_at DESC
LIMIT 50
"#;

/// Get room history - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_HISTORY: &str = r#"
SELECT
    rh.id,
    rh.room_id,
    rh.from_status,
    rh.to_status,
    rh.start_date,
    rh.end_date,
    rh.changed_by,
    u.full_name as changed_by_name,
    rh.created_at,
    rh.notes,
    rh.is_auto_generated
FROM room_history rh
LEFT JOIN users u ON rh.changed_by = u.id
WHERE rh.room_id = ?1
ORDER BY rh.created_at DESC
LIMIT 50
"#;

/// Get room reviews - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_REVIEWS: &str = r#"
SELECT
    gr.id,
    gr.guest_id,
    g.full_name as guest_name,
    gr.room_type_id,
    gr.overall_rating,
    gr.cleanliness_rating,
    gr.staff_rating,
    gr.facilities_rating,
    gr.value_rating,
    gr.location_rating,
    gr.title,
    gr.review_text,
    gr.pros,
    gr.cons,
    gr.recommend,
    gr.stay_type,
    gr.is_verified,
    gr.helpful_count,
    gr.created_at
FROM guest_reviews gr
INNER JOIN guests g ON gr.guest_id = g.id
INNER JOIN room_types rt ON gr.room_type_id = rt.id
WHERE rt.name = $1 AND gr.is_published = true
ORDER BY gr.created_at DESC
"#;

/// Get room reviews - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_REVIEWS: &str = r#"
SELECT
    gr.id,
    gr.guest_id,
    g.full_name as guest_name,
    gr.room_type_id,
    gr.overall_rating,
    gr.cleanliness_rating,
    gr.staff_rating,
    gr.facilities_rating,
    gr.value_rating,
    gr.location_rating,
    gr.title,
    gr.review_text,
    gr.pros,
    gr.cons,
    gr.recommend,
    gr.stay_type,
    gr.is_verified,
    gr.helpful_count,
    gr.created_at
FROM guest_reviews gr
INNER JOIN guests g ON gr.guest_id = g.id
INNER JOIN room_types rt ON gr.room_type_id = rt.id
WHERE rt.name = ?1 AND gr.is_published = 1
ORDER BY gr.created_at DESC
"#;

/// Get rooms with occupancy - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOMS_WITH_OCCUPANCY: &str = r#"
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
    CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
    rt.description,
    rt.max_occupancy,
    r.status,
    r.created_at,
    r.updated_at,
    COALESCE(rco.current_adults, 0) as current_adults,
    COALESCE(rco.current_children, 0) as current_children,
    COALESCE(rco.current_infants, 0) as current_infants,
    COALESCE(rco.current_total_guests, 0) as current_total_guests,
    COALESCE(rco.is_occupied, false) as is_occupied,
    rco.current_booking_id,
    rco.current_guest_id
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN room_current_occupancy rco ON r.id = rco.room_id
WHERE r.is_active = true
ORDER BY r.room_number
"#;

/// Get rooms with occupancy - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOMS_WITH_OCCUPANCY: &str = r#"
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    CAST(COALESCE(r.custom_price, rt.base_price) AS TEXT) as price_per_night,
    CASE WHEN r.status IN ('available', 'cleaning') THEN 1 ELSE 0 END as available,
    rt.description,
    rt.max_occupancy,
    r.status,
    r.created_at,
    r.updated_at,
    COALESCE(rco.current_adults, 0) as current_adults,
    COALESCE(rco.current_children, 0) as current_children,
    COALESCE(rco.current_infants, 0) as current_infants,
    COALESCE(rco.current_total_guests, 0) as current_total_guests,
    COALESCE(rco.is_occupied, 0) as is_occupied,
    rco.current_booking_id,
    rco.current_guest_id
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN room_current_occupancy rco ON r.id = rco.room_id
WHERE r.is_active = 1
ORDER BY r.room_number
"#;

/// Get active booking for room change - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ACTIVE_BOOKING_FOR_ROOM: &str = r#"
SELECT id, guest_id FROM bookings
WHERE room_id = $1
  AND status IN ('confirmed', 'checked_in')
  AND check_in_date <= CURRENT_DATE
  AND check_out_date >= CURRENT_DATE
ORDER BY
    CASE WHEN status = 'checked_in' THEN 0 ELSE 1 END,
    check_in_date
LIMIT 1
"#;

/// Get active booking for room change - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ACTIVE_BOOKING_FOR_ROOM: &str = r#"
SELECT id, guest_id FROM bookings
WHERE room_id = ?1
  AND status IN ('confirmed', 'checked_in')
  AND check_in_date <= date('now')
  AND check_out_date >= date('now')
ORDER BY
    CASE WHEN status = 'checked_in' THEN 0 ELSE 1 END,
    check_in_date
LIMIT 1
"#;

/// Get target room status - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_TARGET_ROOM_STATUS: &str = r#"
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = r.id
            AND status = 'checked_in'
            AND check_out_date >= CURRENT_DATE
        ) THEN 'occupied'
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = r.id
            AND status IN ('confirmed', 'pending')
            AND check_in_date <= CURRENT_DATE
            AND check_out_date >= CURRENT_DATE
        ) THEN 'reserved'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN r.status
        ELSE 'available'
    END as computed_status,
    r.is_active,
    r.id IS NOT NULL as exists
FROM rooms r
WHERE r.id = $1
"#;

/// Get target room status - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_TARGET_ROOM_STATUS: &str = r#"
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = r.id
            AND status = 'checked_in'
            AND check_out_date >= date('now')
        ) THEN 'occupied'
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = r.id
            AND status IN ('confirmed', 'pending')
            AND check_in_date <= date('now')
            AND check_out_date >= date('now')
        ) THEN 'reserved'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN r.status
        ELSE 'available'
    END as computed_status,
    r.is_active,
    r.id IS NOT NULL as exists
FROM rooms r
WHERE r.id = ?1
"#;

/// Get room types active - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_TYPES_ACTIVE: &str = r#"
SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at
FROM room_types
WHERE is_active = true
ORDER BY sort_order, name
"#;

/// Get room types active - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_TYPES_ACTIVE: &str = r#"
SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at
FROM room_types
WHERE is_active = 1
ORDER BY sort_order, name
"#;

/// Get all room types - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ALL_ROOM_TYPES: &str = r#"
SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at
FROM room_types
ORDER BY sort_order, name
"#;

/// Get all room types - SQLite version (same as PostgreSQL for this query)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ALL_ROOM_TYPES: &str = r#"
SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at
FROM room_types
ORDER BY sort_order, name
"#;

/// Get room type by ID - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_TYPE_BY_ID: &str = r#"
SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at
FROM room_types
WHERE id = $1
"#;

/// Get room type by ID - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_TYPE_BY_ID: &str = r#"
SELECT id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at
FROM room_types
WHERE id = ?1
"#;

/// Get room type name and code - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_ROOM_TYPE_NAME_CODE: &str = "SELECT name, code FROM room_types WHERE id = $1";

/// Get room type name and code - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ROOM_TYPE_NAME_CODE: &str = "SELECT name, code FROM room_types WHERE id = ?1";

/// Count rooms by type - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const COUNT_ROOMS_BY_TYPE: &str = "SELECT COUNT(*) FROM rooms WHERE room_type_id = $1";

/// Count rooms by type - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const COUNT_ROOMS_BY_TYPE: &str = "SELECT COUNT(*) FROM rooms WHERE room_type_id = ?1";

/// Delete room type - PostgreSQL version
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const DELETE_ROOM_TYPE: &str = "DELETE FROM room_types WHERE id = $1";

/// Delete room type - SQLite version
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const DELETE_ROOM_TYPE: &str = "DELETE FROM room_types WHERE id = ?1";

/// Get next room status - PostgreSQL version (function call)
#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
pub const GET_NEXT_ROOM_STATUS: &str = "SELECT get_room_next_status($1)";

/// Get next room status - SQLite version (inline logic since no stored function)
#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_NEXT_ROOM_STATUS: &str = r#"
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = ?1
            AND status IN ('confirmed', 'pending')
            AND check_in_date <= date('now')
            AND check_out_date >= date('now')
        ) THEN 'reserved'
        ELSE 'available'
    END
"#;
