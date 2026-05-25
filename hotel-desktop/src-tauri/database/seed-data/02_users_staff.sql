-- ============================================================================
-- SEED 02: USER & STAFF ACCOUNTS
-- ============================================================================
-- Seeded accounts use a non-recoverable placeholder password hash.
-- The desktop app randomizes these after first-time seeding and writes a bootstrap password file.
-- ============================================================================

-- ============================================================================
-- STAFF USERS
-- ============================================================================

-- Manager (2FA enabled)
INSERT INTO users (username, email, password_hash, full_name, phone, user_type, is_active, is_verified, two_factor_enabled, created_at)
VALUES ('manager1', 'manager@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Alice Manager', '+1-555-0101', 'staff', true, true, true, CURRENT_TIMESTAMP - INTERVAL '365 days')
ON CONFLICT (username) DO NOTHING;

-- Receptionists (24/7 shifts)
INSERT INTO users (username, email, password_hash, full_name, phone, user_type, is_active, is_verified, last_login_at, created_at)
VALUES
('receptionist1', 'reception.morning@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Bob Martinez - Morning', '+1-555-0201', 'staff', true, true, CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '180 days'),
('receptionist2', 'reception.evening@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Carol Chen - Evening', '+1-555-0202', 'staff', true, true, CURRENT_TIMESTAMP - INTERVAL '5 hours', CURRENT_TIMESTAMP - INTERVAL '90 days'),
('receptionist3', 'reception.night@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Daniel Night - Night', '+1-555-0203', 'staff', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '120 days')
ON CONFLICT (username) DO NOTHING;

-- General Staff
INSERT INTO users (username, email, password_hash, full_name, phone, user_type, is_active, is_verified, created_at)
VALUES
('staff1', 'staff1@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'David Staff', '+1-555-0301', 'staff', true, true, CURRENT_TIMESTAMP - INTERVAL '60 days'),
('housekeeping1', 'housekeeping@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Emma Housekeeping', '+1-555-0302', 'staff', true, true, CURRENT_TIMESTAMP - INTERVAL '150 days'),
('maintenance1', 'maintenance@hotel.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Frank Maintenance', '+1-555-0303', 'staff', true, true, CURRENT_TIMESTAMP - INTERVAL '200 days')
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- GUEST ACCOUNTS
-- ============================================================================

INSERT INTO users (username, email, password_hash, full_name, phone, user_type, is_active, is_verified, last_login_at, created_at)
VALUES
('guest1', 'john.smith@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'John Smith', '+1-555-1001', 'guest', true, true, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '200 days'),
('guest2', 'sarah.johnson@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Sarah Johnson', '+1-555-1002', 'guest', true, true, CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '150 days'),
('guest3', 'emily.williams@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Emily Williams', '+1-555-1003', 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '400 days'),
('guest4', 'michael.brown@corporate.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Michael Brown', '+1-555-1004', 'guest', true, true, CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '300 days'),
('guest5', 'lisa.davis@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Lisa Davis', '+1-555-1005', 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '2 hours'),
('guest6', 'robert.wilson@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Robert Wilson', '+44-20-1234-5678', 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '100 days'),
('guest7', 'maria.gonzalez@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Maria Gonzalez', '+34-91-123-4567', 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '75 days'),
('guest8', 'david.lee@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'David Lee', NULL, 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '30 days'),
('guest9', 'jennifer.martinez@email.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Jennifer Martinez', '+1-555-1009', 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '7 days'),
('guest10', 'james.anderson@techcorp.com', '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'James Anderson', '+1-555-1010', 'guest', true, true, NULL, CURRENT_TIMESTAMP - INTERVAL '60 days')
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- ASSIGN ROLES
-- ============================================================================

INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'manager1' AND r.name = 'manager' ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username IN ('receptionist1', 'receptionist2', 'receptionist3') AND r.name = 'receptionist' ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username IN ('staff1', 'housekeeping1', 'maintenance1') AND r.name = 'staff' ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username LIKE 'guest%' AND r.name = 'guest' ON CONFLICT DO NOTHING;

UPDATE users
SET password_hash = '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK'
WHERE username IN (
    'manager1',
    'receptionist1',
    'receptionist2',
    'receptionist3',
    'staff1',
    'housekeeping1',
    'maintenance1',
    'guest1',
    'guest2',
    'guest3',
    'guest4',
    'guest5',
    'guest6',
    'guest7',
    'guest8',
    'guest9',
    'guest10'
);

DO $$ BEGIN RAISE NOTICE 'User accounts loaded: 1 manager, 3 receptionists, 3 staff, 10 guests'; END $$;
