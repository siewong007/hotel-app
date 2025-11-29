-- Seed data with BIGINT IDs
-- Version: 1.0
-- Last Updated: 2024
-- Note: This script uses ON CONFLICT to allow safe re-running

-- Begin transaction for atomicity
BEGIN;

-- Reset sequences
ALTER SEQUENCE users_id_seq RESTART WITH 1;
ALTER SEQUENCE roles_id_seq RESTART WITH 1;
ALTER SEQUENCE permissions_id_seq RESTART WITH 1;
ALTER SEQUENCE rooms_id_seq RESTART WITH 1;
ALTER SEQUENCE guests_id_seq RESTART WITH 1;

-- Insert default roles
INSERT INTO roles (id, name, description) VALUES
    (1, 'admin', 'Full system access with all permissions'),
    (2, 'manager', 'Can manage bookings, guests, and rooms'),
    (3, 'staff', 'Can view and create bookings and guests'),
    (4, 'viewer', 'Read-only access to all resources')
ON CONFLICT (name) DO NOTHING;

-- Insert permissions
INSERT INTO permissions (id, name, resource, action, description) VALUES
    (1, 'rooms:read', 'rooms', 'read', 'View rooms'),
    (2, 'rooms:write', 'rooms', 'write', 'Create and update rooms'),
    (3, 'rooms:delete', 'rooms', 'delete', 'Delete rooms'),
    (4, 'guests:read', 'guests', 'read', 'View guests'),
    (5, 'guests:write', 'guests', 'write', 'Create and update guests'),
    (6, 'guests:delete', 'guests', 'delete', 'Delete guests'),
    (7, 'bookings:read', 'bookings', 'read', 'View bookings'),
    (8, 'bookings:write', 'bookings', 'write', 'Create and update bookings'),
    (9, 'bookings:delete', 'bookings', 'delete', 'Cancel bookings'),
    (10, 'analytics:read', 'analytics', 'read', 'View analytics and reports'),
    (11, 'users:read', 'users', 'read', 'View users'),
    (12, 'users:write', 'users', 'write', 'Create and update users'),
    (13, 'users:delete', 'users', 'delete', 'Delete users'),
    (14, 'settings:read', 'settings', 'read', 'View settings'),
    (15, 'settings:write', 'settings', 'write', 'Modify settings')
ON CONFLICT (name) DO NOTHING;

-- Assign permissions to roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
WHERE resource IN ('rooms', 'guests', 'bookings', 'analytics', 'settings')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 3, id FROM permissions
WHERE (resource = 'bookings' AND action IN ('read', 'write'))
   OR (resource = 'guests' AND action IN ('read', 'write'))
   OR (resource = 'rooms' AND action = 'read')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 4, id FROM permissions WHERE action = 'read'
ON CONFLICT DO NOTHING;

-- Create default admin user (password: admin123)
-- Valid bcrypt hash for "admin123" with cost 12
INSERT INTO users (id, username, email, password_hash, full_name, is_active) VALUES
    (1, 'admin', 'admin@hotel.com', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'System Administrator', true)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Assign admin role
INSERT INTO user_roles (user_id, role_id) VALUES (1, 1)
ON CONFLICT DO NOTHING;

-- Insert sample rooms
INSERT INTO rooms (id, room_number, room_type, price_per_night, available, description, max_occupancy) VALUES
    (1, '101', 'Standard', 100.00, true, 'Comfortable standard room with basic amenities', 2),
    (2, '102', 'Standard', 100.00, true, 'Comfortable standard room with basic amenities', 2),
    (3, '201', 'Deluxe', 150.00, true, 'Spacious deluxe room with premium amenities', 3),
    (4, '202', 'Deluxe', 150.00, true, 'Spacious deluxe room with premium amenities', 3),
    (5, '301', 'Suite', 250.00, true, 'Luxurious suite with separate living area', 4)
ON CONFLICT (room_number) DO NOTHING;

-- Insert sample guests
INSERT INTO guests (id, name, email, phone) VALUES
    (1, 'Alice Johnson', 'alice@example.com', '+1234567890'),
    (2, 'Bob Smith', 'bob@example.com', '+1234567891')
ON CONFLICT DO NOTHING;

-- Commit transaction
COMMIT;
