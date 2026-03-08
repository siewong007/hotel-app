-- Populate room_status_transitions with all valid transitions
-- The validate_room_status_transition function (called by sync_room_status_with_booking trigger)
-- requires these entries to exist, otherwise all status changes fail.

INSERT INTO room_status_transitions (from_status, to_status, is_allowed) VALUES
-- From available
('available', 'occupied', true),
('available', 'reserved', true),
('available', 'dirty', true),
('available', 'maintenance', true),
('available', 'out_of_order', true),
-- From occupied
('occupied', 'available', true),
('occupied', 'dirty', true),
('occupied', 'maintenance', true),
('occupied', 'reserved', true),
-- From reserved
('reserved', 'occupied', true),
('reserved', 'available', true),
('reserved', 'dirty', true),
('reserved', 'maintenance', true),
-- From dirty
('dirty', 'available', true),
('dirty', 'maintenance', true),
('dirty', 'reserved', true),
('dirty', 'occupied', true),
-- From maintenance
('maintenance', 'available', true),
('maintenance', 'dirty', true),
('maintenance', 'out_of_order', true),
-- From out_of_order
('out_of_order', 'available', true),
('out_of_order', 'maintenance', true),
('out_of_order', 'dirty', true)
ON CONFLICT DO NOTHING;
