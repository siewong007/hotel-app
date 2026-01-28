-- ============================================================================
-- MIGRATION 012: GUEST CASCADE DELETE
-- ============================================================================
-- Description: Update foreign key constraints to allow guest deletion with booking history
-- ============================================================================

-- Drop and recreate bookings.guest_id constraint with CASCADE
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_guest_id_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_guest_id_fkey
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;

-- Drop and recreate booking_guests.guest_id constraint with SET NULL
ALTER TABLE booking_guests DROP CONSTRAINT IF EXISTS booking_guests_guest_id_fkey;
ALTER TABLE booking_guests ADD CONSTRAINT booking_guests_guest_id_fkey
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;

-- Drop and recreate room_changes.guest_id constraint with SET NULL
ALTER TABLE room_changes DROP CONSTRAINT IF EXISTS fk_room_changes_guest;
ALTER TABLE room_changes ADD CONSTRAINT fk_room_changes_guest
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;

-- Drop and recreate invoices.bill_to_guest_id constraint with SET NULL
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_bill_to_guest_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_bill_to_guest_id_fkey
    FOREIGN KEY (bill_to_guest_id) REFERENCES guests(id) ON DELETE SET NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON CONSTRAINT bookings_guest_id_fkey ON bookings IS 'Cascade delete bookings when guest is deleted';
COMMENT ON CONSTRAINT booking_guests_guest_id_fkey ON booking_guests IS 'Set guest_id to NULL when guest is deleted';
COMMENT ON CONSTRAINT fk_room_changes_guest ON room_changes IS 'Set guest_id to NULL when guest is deleted';
COMMENT ON CONSTRAINT invoices_bill_to_guest_id_fkey ON invoices IS 'Set bill_to_guest_id to NULL when guest is deleted';
