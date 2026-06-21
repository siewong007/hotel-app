-- Migration: 001_initial_schema.sql
-- ============================================================================
-- SQLITE MIGRATION 001: INITIAL SCHEMA
-- ============================================================================
-- Consolidated schema for SQLite (converted from PostgreSQL)
-- ============================================================================

-- ============================================================================
-- CORE TABLES: ROLES & PERMISSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    is_system_role INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    is_system_permission INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TEXT DEFAULT (datetime('now')),
    granted_by INTEGER,
    PRIMARY KEY (role_id, permission_id)
);

-- ============================================================================
-- USERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    full_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    user_type TEXT DEFAULT 'staff',
    guest_id INTEGER,
    is_active INTEGER DEFAULT 1,
    is_verified INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    is_super_admin INTEGER DEFAULT 0,
    email_verification_token TEXT,
    email_token_expires_at TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    two_factor_recovery_codes TEXT,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    last_login_ip TEXT,
    password_changed_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id),
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TEXT DEFAULT (datetime('now')),
    assigned_by INTEGER REFERENCES users(id),
    expires_at TEXT,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    assigned_at TEXT DEFAULT (datetime('now')),
    assigned_by INTEGER REFERENCES users(id),
    PRIMARY KEY (user_id, permission_id)
);

-- ============================================================================
-- SESSION MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device_info TEXT,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT DEFAULT (datetime('now')),
    is_revoked INTEGER DEFAULT 0,
    revoked_at TEXT,
    revoked_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    device_info TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    last_activity_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
);

-- ============================================================================
-- SYSTEM SETTINGS & AUDIT
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    value_type TEXT DEFAULT 'string',
    category TEXT DEFAULT 'general',
    description TEXT,
    is_sensitive INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    old_values TEXT,
    new_values TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- GUEST MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_code TEXT UNIQUE,
    title TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    alt_phone TEXT,
    ic_number TEXT,
    passport_number TEXT,
    nationality TEXT,
    date_of_birth TEXT,
    gender TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state_province TEXT,
    postal_code TEXT,
    country TEXT,
    company_name TEXT,
    company_address TEXT,
    guest_type TEXT DEFAULT 'regular',
    membership_tier TEXT DEFAULT 'Bronze',
    loyalty_points INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    total_stays INTEGER DEFAULT 0,
    last_stay_date TEXT,
    preferences TEXT,
    dietary_restrictions TEXT,
    special_notes TEXT,
    is_vip INTEGER DEFAULT 0,
    is_blacklisted INTEGER DEFAULT 0,
    blacklist_reason TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    id_document_type TEXT,
    id_document_number TEXT,
    id_expiry_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
);

-- ============================================================================
-- LOYALTY PROGRAM
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL,
    points INTEGER NOT NULL,
    booking_id INTEGER,
    description TEXT,
    reference_number TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS guest_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    reward_type TEXT NOT NULL,
    description TEXT,
    points_cost INTEGER DEFAULT 0,
    quantity INTEGER DEFAULT 1,
    used_quantity INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    expires_at TEXT,
    booking_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    used_at TEXT
);

-- ============================================================================
-- ROOM MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE NOT NULL,
    description TEXT,
    base_price REAL NOT NULL DEFAULT 0,
    weekday_rate REAL,
    weekend_rate REAL,
    max_occupancy INTEGER DEFAULT 2,
    bed_type TEXT,
    bed_count INTEGER DEFAULT 1,
    allows_extra_bed INTEGER DEFAULT 0,
    max_extra_beds INTEGER DEFAULT 0,
    extra_bed_charge REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT UNIQUE NOT NULL,
    room_type_id INTEGER NOT NULL REFERENCES room_types(id),
    floor INTEGER,
    building TEXT,
    description TEXT,
    custom_price REAL,
    status TEXT DEFAULT 'available',
    status_notes TEXT,
    is_accessible INTEGER DEFAULT 0,
    is_smoking INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    maintenance_start_date TEXT,
    maintenance_end_date TEXT,
    cleaning_start_date TEXT,
    cleaning_end_date TEXT,
    reserved_start_date TEXT,
    reserved_end_date TEXT,
    target_room_id INTEGER REFERENCES rooms(id),
    last_cleaned_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS amenities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE NOT NULL,
    category TEXT,
    description TEXT,
    icon TEXT,
    is_chargeable INTEGER DEFAULT 0,
    charge_amount REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_amenities (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    notes TEXT,
    PRIMARY KEY (room_id, amenity_id)
);

CREATE TABLE IF NOT EXISTS room_type_amenities (
    room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    is_default INTEGER DEFAULT 1,
    PRIMARY KEY (room_type_id, amenity_id)
);

-- ============================================================================
-- RATE & PRICING
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT DEFAULT 'percentage',
    discount_value REAL DEFAULT 0,
    min_nights INTEGER DEFAULT 1,
    max_nights INTEGER,
    valid_from TEXT,
    valid_until TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasonal_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    rate_multiplier REAL DEFAULT 1.0,
    fixed_rate REAL,
    priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- BOOKINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_number TEXT UNIQUE,
    folio_number TEXT UNIQUE,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    room_type_id INTEGER REFERENCES room_types(id),
    check_in_date TEXT NOT NULL,
    check_out_date TEXT NOT NULL,
    actual_check_in TEXT,
    actual_check_out TEXT,
    adults INTEGER DEFAULT 1,
    children INTEGER DEFAULT 0,
    infants INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'direct',
    rate_code TEXT,
    market_code TEXT,
    rate_per_night REAL NOT NULL,
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    room_card_deposit REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    payment_method TEXT,
    special_requests TEXT,
    booking_remarks TEXT,
    internal_notes TEXT,
    arrival_time TEXT,
    departure_time TEXT,
    is_complimentary INTEGER DEFAULT 0,
    complimentary_reason TEXT,
    is_posted INTEGER DEFAULT 0,
    posted_date TEXT,
    post_type TEXT DEFAULT 'normal_stay',
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancellation_reason TEXT,
    no_show_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS booking_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    is_primary INTEGER DEFAULT 0,
    relationship TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booking_modifications (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    modification_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    price_adjustment REAL DEFAULT 0,
    modified_at TEXT DEFAULT (datetime('now')),
    modified_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS booking_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by INTEGER REFERENCES users(id),
    change_reason TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booking_modifications_booking ON booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_modifications_modified_at ON booking_modifications(modified_at);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_history_created_at ON booking_history(created_at);

-- ============================================================================
-- PAYMENTS & INVOICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_number TEXT UNIQUE,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    payment_type TEXT DEFAULT 'room_charge',
    reference_number TEXT,
    description TEXT,
    status TEXT DEFAULT 'completed',
    processed_at TEXT DEFAULT (datetime('now')),
    processed_by INTEGER REFERENCES users(id),
    voided_at TEXT,
    voided_by INTEGER REFERENCES users(id),
    void_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    invoice_type TEXT DEFAULT 'checkout',
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    due_date TEXT,
    issued_at TEXT,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    reference_id INTEGER,
    reference_date TEXT,
    sort_order INTEGER DEFAULT 0
);

-- ============================================================================
-- CUSTOMER LEDGERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_number TEXT UNIQUE NOT NULL,
    guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    description TEXT NOT NULL,
    debit_amount REAL DEFAULT 0,
    credit_amount REAL DEFAULT 0,
    balance REAL NOT NULL,
    reference_type TEXT,
    reference_id INTEGER,
    payment_method TEXT,
    is_posted INTEGER DEFAULT 0,
    posted_date TEXT,
    post_type TEXT,
    voided_at TEXT,
    voided_by INTEGER REFERENCES users(id),
    void_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id)
);

-- ============================================================================
-- ROOM STATUS HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_at TEXT DEFAULT (datetime('now')),
    changed_by INTEGER REFERENCES users(id),
    reason TEXT,
    booking_id INTEGER REFERENCES bookings(id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone);
CREATE INDEX IF NOT EXISTS idx_guests_ic_number ON guests(ic_number);
CREATE INDEX IF NOT EXISTS idx_guests_guest_code ON guests(guest_code);
CREATE INDEX IF NOT EXISTS idx_rooms_room_number ON rooms(room_number);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_check_in ON bookings(check_in_date);
CREATE INDEX IF NOT EXISTS idx_bookings_check_out ON bookings(check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_number ON bookings(booking_number);
CREATE INDEX IF NOT EXISTS idx_bookings_folio ON bookings(folio_number);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_guest ON payments(guest_id);
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_guest ON invoices(guest_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_guest ON customer_ledgers(guest_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_booking ON customer_ledgers(booking_id);

-- ============================================================================
-- SEED DATA: ROLES
-- ============================================================================

INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system_role, priority) VALUES
(1, 'admin', 'Administrator', 'Full system access', 1, 100),
(2, 'manager', 'Manager', 'Hotel management access', 1, 80),
(3, 'receptionist', 'Receptionist', 'Front desk operations', 1, 60),
(4, 'housekeeping', 'Housekeeping', 'Room cleaning and maintenance', 1, 40),
(5, 'accountant', 'Accountant', 'Financial operations', 1, 50),
(6, 'guest', 'Guest', 'Guest self-service access', 1, 10);

-- ============================================================================
-- SEED DATA: PERMISSIONS
-- ============================================================================

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('rooms:read', 'rooms', 'read', 'View rooms', 1),
('rooms:create', 'rooms', 'create', 'Create rooms', 1),
('rooms:update', 'rooms', 'update', 'Update rooms', 1),
('rooms:delete', 'rooms', 'delete', 'Delete rooms', 1),
('rooms:manage', 'rooms', 'manage', 'Full room management', 1),
('bookings:read', 'bookings', 'read', 'View bookings', 1),
('bookings:create', 'bookings', 'create', 'Create bookings', 1),
('bookings:update', 'bookings', 'update', 'Update bookings', 1),
('bookings:delete', 'bookings', 'delete', 'Cancel bookings', 1),
('bookings:manage', 'bookings', 'manage', 'Full booking management', 1),
('guests:read', 'guests', 'read', 'View guests', 1),
('guests:create', 'guests', 'create', 'Create guests', 1),
('guests:update', 'guests', 'update', 'Update guests', 1),
('guests:delete', 'guests', 'delete', 'Delete guests', 1),
('guests:manage', 'guests', 'manage', 'Full guest management', 1),
('payments:read', 'payments', 'read', 'View payments', 1),
('payments:create', 'payments', 'create', 'Process payments', 1),
('payments:manage', 'payments', 'manage', 'Full payment management', 1),
('reports:read', 'reports', 'read', 'View reports', 1),
('reports:manage', 'reports', 'manage', 'Full report access', 1),
('users:read', 'users', 'read', 'View users', 1),
('users:create', 'users', 'create', 'Create users', 1),
('users:update', 'users', 'update', 'Update users', 1),
('users:delete', 'users', 'delete', 'Delete users', 1),
('users:manage', 'users', 'manage', 'Full user management', 1),
('settings:read', 'settings', 'read', 'View settings', 1),
('settings:update', 'settings', 'update', 'Update settings', 1),
('settings:manage', 'settings', 'manage', 'Full settings management', 1);

-- ============================================================================
-- SEED DATA: ROLE PERMISSIONS
-- ============================================================================

-- Admin: all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- Manager: most permissions except user management
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE resource NOT IN ('users', 'settings') OR action = 'read';

-- Receptionist: bookings, guests, rooms read/create/update
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 3, id FROM permissions WHERE
    (resource IN ('bookings', 'guests') AND action IN ('read', 'create', 'update')) OR
    (resource = 'rooms' AND action IN ('read', 'update')) OR
    (resource = 'payments' AND action IN ('read', 'create'));

-- ============================================================================
-- SEED DATA: ROOM TYPES
-- ============================================================================

INSERT OR IGNORE INTO room_types (id, name, code, description, base_price, max_occupancy, bed_type, bed_count) VALUES
(1, 'Standard Room', 'STD', 'Comfortable standard room', 150.00, 2, 'Queen', 1),
(2, 'Deluxe Room', 'DLX', 'Spacious deluxe room with city view', 250.00, 2, 'King', 1),
(3, 'Suite', 'STE', 'Luxury suite with separate living area', 450.00, 4, 'King', 1),
(4, 'Family Room', 'FAM', 'Large room suitable for families', 350.00, 4, 'Queen', 2);

-- ============================================================================
-- SEED DATA: MARKET CODES
-- ============================================================================

INSERT OR IGNORE INTO market_codes (code, name, description, category) VALUES
('WKII', 'Walk-In', 'Walk-in guest', 'Direct'),
('ONLI', 'Online', 'Online booking', 'OTA'),
('CORP', 'Corporate', 'Corporate booking', 'Business'),
('GOVT', 'Government', 'Government booking', 'Business'),
('COMP', 'Complimentary', 'Complimentary stay', 'Special');

-- ============================================================================
-- SEED DATA: RATE CODES
-- ============================================================================

INSERT OR IGNORE INTO rate_codes (code, name, description, discount_type, discount_value) VALUES
('RACK', 'Rack Rate', 'Standard published rate', 'percentage', 0),
('CORP', 'Corporate Rate', 'Corporate discount rate', 'percentage', 15),
('PROMO', 'Promotional', 'Promotional discount', 'percentage', 20),
('MEMB', 'Member Rate', 'Loyalty member rate', 'percentage', 10);

-- ============================================================================
-- SEED DATA: DEFAULT ADMIN USER
-- Uses a non-recoverable placeholder password hash. Reset explicitly before login.
-- ============================================================================

INSERT OR IGNORE INTO users (id, uuid, username, email, password_hash, full_name, user_type, is_active, is_verified, is_super_admin)
VALUES (1, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin', 'admin@hotel.local',
        '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
        'System Administrator', 'staff', 1, 1, 1);

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (1, 1);


-- Migration: 002_ledger_permissions.sql
-- ============================================================================
-- Migration: Add customer-ledger RBAC permissions
-- Description: Gate customer ledger reads, mutations, voids, and management.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('ledgers:read', 'ledgers', 'read', 'View customer ledger entries and payments', 1),
    ('ledgers:create', 'ledgers', 'create', 'Create customer ledger entries and record ledger payments', 1),
    ('ledgers:update', 'ledgers', 'update', 'Update customer ledger entries and payment dates', 1),
    ('ledgers:void', 'ledgers', 'void', 'Void customer ledger entries and create reversals', 1),
    ('ledgers:manage', 'ledgers', 'manage', 'Full customer ledger management', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin', 'manager', 'accountant')
AND p.name IN (
    'ledgers:read',
    'ledgers:create',
    'ledgers:update',
    'ledgers:void',
    'ledgers:manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create');


-- Migration: 003_business_runtime_settings.sql
-- ============================================================================
-- SQLITE MIGRATION 003: BUSINESS RUNTIME SETTINGS
-- ============================================================================
-- Description: Add hotel-facing settings that replace hardcoded defaults.
-- ============================================================================

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'default_payment_terms_days',
        '30',
        'number',
        'ledger',
        'Default ledger due-date offset in days when a company has no payment terms',
        0
    ),
    (
        'totp_issuer_name',
        'Hotel Management System',
        'string',
        'security',
        'Issuer name shown in authenticator apps during TOTP setup',
        0
    ),
    (
        'passkey_relying_party_name',
        'Hotel Management System',
        'string',
        'security',
        'Display name shown by passkey authenticators during registration',
        0
    );


-- Migration: 004_ledger_role_grants.sql
-- ============================================================================
-- Migration: Ensure core staff roles have customer-ledger permissions
-- Description: Explicitly grant ledger access to Super Administrator,
-- Administrator, Manager, and Receptionist roles.
-- ============================================================================

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
AND p.name IN (
    'ledgers:read',
    'ledgers:create',
    'ledgers:update',
    'ledgers:void',
    'ledgers:manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create');


-- Migration: 005_frontdesk_runtime_settings.sql
-- ============================================================================
-- SQLITE MIGRATION 005: FRONT DESK RUNTIME SETTINGS
-- ============================================================================
-- Description: Persist client-facing settings that were previously local only.
-- ============================================================================

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'night_shift_time',
        '23:00',
        'string',
        'operations',
        'Scheduled night audit posting time',
        0
    ),
    (
        'deposit_amount',
        '50',
        'number',
        'payments',
        'Default room card or check-in deposit amount',
        0
    ),
    (
        'tourism_tax_rate',
        '10',
        'number',
        'tax',
        'Tourism tax amount charged per night for foreign guests',
        0
    ),
    (
        'booking_channels',
        '[{"name":"Booking.com","abbreviation":"B.C"},{"name":"Agoda","abbreviation":"A.C"},{"name":"Traveloka","abbreviation":"T.C"},{"name":"Expedia","abbreviation":"E.C"},{"name":"Hotels.com","abbreviation":"H.C"},{"name":"Airbnb","abbreviation":"AB"},{"name":"Trip.com","abbreviation":"TR"},{"name":"Direct Website","abbreviation":"DW"},{"name":"Other OTA","abbreviation":"OT"}]',
        'json',
        'sales',
        'Online and direct booking channels available to front desk workflows',
        0
    ),
    (
        'payment_methods',
        '["Cash","Visa Card","Master Card","Debit Card","Sarawak Pay","American Express","Bank Transfer","E-Wallet","Other"]',
        'json',
        'payments',
        'Payment methods available to walk-in and payment workflows',
        0
    ),
    (
        'report_font_size',
        '14',
        'number',
        'reports',
        'Base font size in pixels for generated report previews and print output',
        0
    );


-- Migration: 006_analytics_role_grants.sql
-- ============================================================================
-- SQLITE MIGRATION 006: ANALYTICS ROLE GRANTS
-- ============================================================================
-- Description: Ensure every operational user role except guest/staff can read analytics.
-- ============================================================================

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission)
VALUES ('analytics:read', 'analytics', 'read', 'Access to analytics and reports', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.name = 'analytics:read'
  AND r.name NOT IN ('guest', 'staff');


-- Migration: 007_booking_cleaning_preference.sql
-- ============================================================================
-- SQLITE MIGRATION 007: BOOKING CLEANING PREFERENCE
-- ============================================================================
-- Description:
--   Add a per-booking daily-cleaning preference captured at the front desk.
--   NULL = not set, 1 = guest wants daily cleaning, 0 = declined.
-- ============================================================================

ALTER TABLE bookings ADD COLUMN cleaning_preference INTEGER;


-- Migration: 008_dynamic_rbac_permissions.sql
-- ============================================================================
-- SQLITE MIGRATION 008: DYNAMIC RBAC PERMISSIONS
-- ============================================================================
-- Description: Seed first-class access-control permissions used by RBAC routes.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('users:create', 'users', 'create', 'Create users', 1),
    ('users:read', 'users', 'read', 'View users', 1),
    ('users:update', 'users', 'update', 'Update users', 1),
    ('users:delete', 'users', 'delete', 'Delete users', 1),
    ('users:manage', 'users', 'manage', 'Full user management', 1),
    ('roles:create', 'roles', 'create', 'Create roles', 1),
    ('roles:read', 'roles', 'read', 'View roles', 1),
    ('roles:update', 'roles', 'update', 'Update roles', 1),
    ('roles:delete', 'roles', 'delete', 'Delete roles', 1),
    ('roles:manage', 'roles', 'manage', 'Full role management', 1),
    ('permissions:create', 'permissions', 'create', 'Create permissions', 1),
    ('permissions:read', 'permissions', 'read', 'View permissions', 1),
    ('permissions:update', 'permissions', 'update', 'Update permissions', 1),
    ('permissions:delete', 'permissions', 'delete', 'Delete permissions', 1),
    ('permissions:manage', 'permissions', 'manage', 'Full permission management', 1),
    ('loyalty:read', 'loyalty', 'read', 'View loyalty program data', 1),
    ('loyalty:manage', 'loyalty', 'manage', 'Manage loyalty program rewards and points', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
AND p.name IN (
    'users:create',
    'users:read',
    'users:update',
    'users:delete',
    'users:manage',
    'roles:create',
    'roles:read',
    'roles:update',
    'roles:delete',
    'roles:manage',
    'permissions:create',
    'permissions:read',
    'permissions:update',
    'permissions:delete',
    'permissions:manage',
    'loyalty:read',
    'loyalty:manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('manager', 'receptionist')
AND p.name IN (
    'loyalty:read'
);


-- Migration: 009_dynamic_route_access_policies.sql
-- ============================================================================
-- SQLITE MIGRATION 009: DYNAMIC ROUTE ACCESS POLICIES
-- ============================================================================
-- Description: Store frontend route/navigation RBAC policy in the database so
--              clients consume policy from the backend instead of hardcoding it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_access_policies (
    route_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    nav_label TEXT,
    nav_group TEXT,
    required_permissions TEXT NOT NULL DEFAULT '[]',
    required_roles TEXT NOT NULL DEFAULT '[]',
    excluded_roles TEXT NOT NULL DEFAULT '[]',
    nav_permissions TEXT NOT NULL DEFAULT '[]',
    nav_roles TEXT NOT NULL DEFAULT '[]',
    nav_excluded_roles TEXT NOT NULL DEFAULT '[]',
    is_navigation INTEGER NOT NULL DEFAULT 0,
    is_system_policy INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('rooms:write', 'rooms', 'write', 'Create and modify rooms and room types', 1),
    ('ekyc:manage', 'ekyc', 'manage', 'Manage eKYC verifications', 1),
    ('ekyc:verify', 'ekyc', 'verify', 'Approve or reject eKYC verifications', 1),
    ('rewards:read', 'rewards', 'read', 'View reward information', 1),
    ('navigation_timeline:read', 'navigation:timeline', 'read', 'Show Reservation Timeline navigation', 1),
    ('navigation_guest_config:read', 'navigation:guest-config', 'read', 'Show Guest Management navigation', 1),
    ('navigation_bookings:read', 'navigation:bookings', 'read', 'Show Bookings navigation', 1),
    ('navigation_my_bookings:read', 'navigation:my-bookings', 'read', 'Show My Bookings navigation', 1),
    ('navigation_room_management:read', 'navigation:room-management', 'read', 'Show Room Management navigation', 1),
    ('navigation_reports:read', 'navigation:reports', 'read', 'Show Reports navigation', 1),
    ('navigation_ekyc_admin:read', 'navigation:ekyc-admin', 'read', 'Show eKYC Admin navigation', 1),
    ('navigation_room_config:read', 'navigation:room-config', 'read', 'Show Room Configuration navigation', 1),
    ('navigation_settings:read', 'navigation:settings', 'read', 'Show Settings navigation', 1),
    ('navigation_rbac:read', 'navigation:rbac', 'read', 'Show Access Control navigation', 1),
    ('navigation_company_ledger:read', 'navigation:company-ledger', 'read', 'Show Company Ledger navigation', 1),
    ('navigation_night_audit:read', 'navigation:night-audit', 'read', 'Show Night Audit navigation', 1),
    ('navigation_audit_log:read', 'navigation:audit-log', 'read', 'Show Audit Log navigation', 1),
    ('navigation_complimentary:read', 'navigation:complimentary', 'read', 'Show Complimentary Nights navigation', 1),
    ('navigation_data_transfer:read', 'navigation:data-transfer', 'read', 'Show Data Transfer navigation', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
AND p.name IN (
    'rooms:write',
    'ekyc:manage',
    'ekyc:verify',
    'rewards:read',
    'navigation_timeline:read',
    'navigation_guest_config:read',
    'navigation_bookings:read',
    'navigation_room_management:read',
    'navigation_reports:read',
    'navigation_ekyc_admin:read',
    'navigation_room_config:read',
    'navigation_settings:read',
    'navigation_rbac:read',
    'navigation_company_ledger:read',
    'navigation_night_audit:read',
    'navigation_audit_log:read',
    'navigation_complimentary:read',
    'navigation_data_transfer:read'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'guest'
AND p.name IN ('rewards:read', 'navigation_my_bookings:read');

INSERT INTO route_access_policies (
    route_id,
    path,
    nav_label,
    nav_group,
    required_permissions,
    required_roles,
    excluded_roles,
    nav_permissions,
    nav_roles,
    nav_excluded_roles,
    is_navigation
)
VALUES
    ('dashboard', '/', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('timeline', '/timeline', 'Timeline', 'main', '["rooms:read"]', '[]', '[]', '["navigation_timeline:read","bookings:read"]', '[]', '["guest"]', 1),
    ('guest-config', '/guest-config', 'Guests', 'main', '["guests:read","guests:manage"]', '[]', '[]', '["navigation_guest_config:read","guests:read","guests:manage"]', '[]', '[]', 1),
    ('bookings', '/bookings', 'Bookings', 'main', '["bookings:read","bookings:manage"]', '[]', '[]', '["navigation_bookings:read","bookings:read","bookings:manage"]', '[]', '["guest"]', 1),
    ('my-bookings', '/my-bookings', 'My Bookings', 'main', '["bookings:read"]', '[]', '["super_admin","admin","manager","receptionist","staff"]', '["navigation_my_bookings:read","bookings:read"]', '[]', '["super_admin","admin","manager","receptionist","staff"]', 1),
    ('room-management', '/room-management', 'Rooms', 'main', '["rooms:read","rooms:manage"]', '[]', '[]', '["navigation_room_management:read","rooms:read","rooms:manage"]', '[]', '["guest"]', 1),
    ('reports', '/reports', 'Reports', 'operations', '["analytics:read","reports:execute"]', '[]', '[]', '["navigation_reports:read","analytics:read","reports:execute"]', '[]', '[]', 1),
    ('loyalty', '/loyalty', NULL, NULL, '["loyalty:read","loyalty:manage","analytics:read"]', '[]', '[]', '[]', '[]', '[]', 0),
    ('profile', '/profile', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('help', '/help', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('ekyc', '/ekyc', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('ekyc-admin', '/ekyc-admin', 'eKYC Admin', 'admin', '["ekyc:manage"]', '[]', '[]', '["navigation_ekyc_admin:read","ekyc:manage"]', '[]', '[]', 1),
    ('room-config', '/room-config', 'Room Configuration', 'config', '["rooms:update","rooms:write","rooms:manage"]', '[]', '[]', '["navigation_room_config:read","rooms:update","rooms:write","rooms:manage"]', '[]', '[]', 1),
    ('settings', '/settings', 'Settings', 'config', '["settings:read"]', '[]', '[]', '["navigation_settings:read","settings:read","settings:manage"]', '[]', '[]', 1),
    ('rbac', '/rbac', 'Access Control', 'config', '["roles:read","roles:manage","permissions:read","permissions:manage","users:read","users:manage"]', '[]', '[]', '["navigation_rbac:read","roles:read","roles:manage","permissions:read","permissions:manage","users:read","users:manage"]', '[]', '[]', 1),
    ('company-ledger', '/company-ledger', 'Ledger', 'operations', '["ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]', '[]', '[]', '["navigation_company_ledger:read","ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]', '[]', '[]', 1),
    ('night-audit', '/night-audit', 'Night Audit', 'admin', '["night_audit:read","night_audit:execute"]', '[]', '[]', '["navigation_night_audit:read","night_audit:read","night_audit:execute"]', '[]', '[]', 1),
    ('audit-log', '/audit-log', 'Audit Log', 'admin', '["audit:read"]', '[]', '[]', '["navigation_audit_log:read","audit:read"]', '[]', '[]', 1),
    ('complimentary', '/complimentary', 'Complimentary Nights', 'admin', '["bookings:read","bookings:update"]', '[]', '[]', '["navigation_complimentary:read","bookings:read","bookings:update"]', '[]', '["guest"]', 1),
    ('data-transfer', '/data-transfer', 'Data Transfer', 'admin', '["settings:manage"]', '[]', '[]', '["navigation_data_transfer:read","settings:manage"]', '[]', '[]', 1)
ON CONFLICT(route_id) DO NOTHING;


-- Migration: 010_bootstrap_quarantine.sql
-- ============================================================================
-- SQLITE MIGRATION 010: BOOTSTRAP QUARANTINE
-- ============================================================================
-- Description: SQLite-compatible quarantine table aligned with PostgreSQL
--              bootstrap validation metadata.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invalid_data_quarantine (
    quarantine_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_table TEXT NOT NULL,
    source_key TEXT,
    invalid_reason TEXT NOT NULL,
    original_data TEXT NOT NULL,
    quarantined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invalid_data_quarantine_source
    ON invalid_data_quarantine (source_table, quarantined_at DESC);


-- Migration: 011_ekyc_admin_workflow.sql
-- ============================================================================
-- SQLITE MIGRATION 011: eKYC ADMIN WORKFLOW, AUDIT, AND RBAC
-- ============================================================================

INSERT OR IGNORE INTO roles (name, display_name, description, is_system_role, priority) VALUES
('compliance_admin', 'Compliance Administrator', 'Compliance administration and eKYC oversight', 1, 90),
('ekyc_reviewer', 'eKYC Reviewer', 'Reviews and actions assigned eKYC applications', 1, 70),
('senior_reviewer', 'Senior Reviewer', 'Second-level eKYC review and high-risk approvals', 1, 75),
('auditor', 'Auditor', 'Read-only audit and compliance access', 1, 65),
('support_readonly', 'Read-only Support', 'Read-only operational support access', 1, 30);

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('ekyc:read', 'ekyc', 'read', 'View masked eKYC applications', 1),
('ekyc:review', 'ekyc', 'review', 'Review eKYC application details and notes', 1),
('ekyc:view_sensitive', 'ekyc', 'read', 'View sensitive eKYC data when explicitly returned', 1),
('ekyc:reveal_sensitive', 'ekyc', 'reveal', 'Reveal masked eKYC identity fields with audit', 1),
('ekyc:download_documents', 'ekyc', 'download', 'Download private eKYC documents', 1),
('ekyc:assign', 'ekyc', 'assign', 'Claim, assign, or reassign eKYC cases', 1),
('ekyc:approve', 'ekyc', 'approve', 'Approve eKYC applications', 1),
('ekyc:reject', 'ekyc', 'reject', 'Reject eKYC applications', 1),
('ekyc:escalate', 'ekyc', 'escalate', 'Escalate eKYC applications', 1),
('ekyc:request_resubmission', 'ekyc', 'request_resubmission', 'Request additional eKYC information', 1),
('ekyc:override', 'ekyc', 'override', 'Perform controlled eKYC manual overrides', 1),
('ekyc:export', 'ekyc', 'export', 'Export masked eKYC records', 1),
('ekyc:manage_reason_codes', 'ekyc', 'manage_reason_codes', 'Manage eKYC reason codes', 1),
('ekyc:manage_risk_rules', 'ekyc', 'manage_risk_rules', 'Manage eKYC risk rules', 1),
('ekyc:view_provider_raw', 'ekyc', 'view_provider_raw', 'View raw eKYC provider responses', 1),
('ekyc:manage', 'ekyc', 'manage', 'Full eKYC administration', 1),
('ekyc:verify', 'ekyc', 'verify', 'Legacy eKYC approve or reject permission', 1),
('navigation_ekyc_admin:read', 'navigation:ekyc-admin', 'read', 'Show eKYC Admin navigation', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.resource = 'ekyc';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'compliance_admin'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:reveal_sensitive',
      'ekyc:download_documents', 'ekyc:assign', 'ekyc:approve', 'ekyc:reject',
      'ekyc:escalate', 'ekyc:request_resubmission', 'ekyc:override',
      'ekyc:export', 'ekyc:manage_reason_codes', 'ekyc:manage_risk_rules',
      'ekyc:view_provider_raw', 'navigation_ekyc_admin:read', 'audit:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'ekyc_reviewer'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:download_documents', 'ekyc:assign',
      'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
      'ekyc:request_resubmission', 'navigation_ekyc_admin:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'senior_reviewer'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:download_documents',
      'ekyc:assign', 'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
      'ekyc:request_resubmission', 'ekyc:override', 'navigation_ekyc_admin:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'auditor'
  AND p.name IN ('ekyc:read', 'ekyc:export', 'navigation_ekyc_admin:read', 'audit:read');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'support_readonly'
  AND p.name IN ('ekyc:read', 'navigation_ekyc_admin:read');

CREATE TABLE IF NOT EXISTS ekyc_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    assigned_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewer_claimed_at TEXT,
    full_name TEXT,
    date_of_birth TEXT,
    nationality TEXT,
    phone TEXT,
    email TEXT,
    current_address TEXT,
    id_type TEXT,
    id_number TEXT,
    id_issuing_country TEXT,
    id_issue_date TEXT,
    id_expiry_date TEXT,
    id_front_image_path TEXT,
    id_back_image_path TEXT,
    selfie_image_path TEXT,
    proof_of_address_path TEXT,
    provider_name TEXT,
    provider_verification_result TEXT,
    provider_raw_response TEXT,
    ocr_data TEXT,
    user_entered_data TEXT,
    document_authenticity_result TEXT,
    face_match_score REAL,
    face_match_passed INTEGER DEFAULT 0,
    liveness_score REAL,
    liveness_passed INTEGER DEFAULT 0,
    duplicate_check_result TEXT,
    watchlist_result TEXT,
    ip_address TEXT,
    device_fingerprint TEXT,
    geolocation TEXT,
    submission_metadata TEXT,
    auto_verified INTEGER DEFAULT 0,
    auto_verification_details TEXT,
    manual_review_required INTEGER DEFAULT 1,
    risk_level TEXT DEFAULT 'medium',
    risk_score INTEGER DEFAULT 0,
    risk_flags TEXT NOT NULL DEFAULT '[]',
    recommended_action TEXT,
    potential_duplicate INTEGER DEFAULT 0,
    fraud_suspected INTEGER DEFAULT 0,
    verification_notes TEXT,
    customer_message TEXT,
    decision_reason_code TEXT,
    decision_reason TEXT,
    verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_at TEXT,
    self_checkin_enabled INTEGER DEFAULT 0,
    self_checkin_activated_at TEXT,
    submitted_at TEXT DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ekyc_decision_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    reason_code TEXT,
    reason TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ekyc_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    note_type TEXT NOT NULL DEFAULT 'internal',
    body TEXT NOT NULL,
    customer_visible INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ekyc_sensitive_reveals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    field_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ekyc_access_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ekyc_idempotency_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (application_id, actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ekyc_reason_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    requires_details INTEGER NOT NULL DEFAULT 0,
    customer_message_template TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS self_checkin_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    ekyc_verification_id INTEGER REFERENCES ekyc_verifications(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    checked_in_at TEXT,
    room_key_issued INTEGER DEFAULT 0,
    digital_key_sent INTEGER DEFAULT 0,
    device_type TEXT,
    checkin_location TEXT,
    event_type TEXT,
    event_data TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO ekyc_reason_codes (code, label, category, requires_details, customer_message_template, is_active) VALUES
('document_blurry', 'Blurry document', 'resubmission', 0, 'Please upload a clearer image of your identity document.', 1),
('missing_document', 'Missing document', 'resubmission', 0, 'Please upload the missing identity document.', 1),
('expired_document', 'Expired document', 'resubmission', 0, 'Please upload a valid, unexpired identity document.', 1),
('selfie_mismatch', 'Selfie mismatch', 'resubmission', 1, 'Please submit a new selfie that clearly matches your identity document.', 1),
('incomplete_profile', 'Incomplete profile', 'resubmission', 0, 'Please complete the missing profile details.', 1),
('unsupported_document', 'Unsupported document', 'rejection', 1, NULL, 1),
('data_mismatch', 'Data mismatch', 'review', 1, 'Please review and correct the submitted identity information.', 1),
('duplicate_identity', 'Potential duplicate identity', 'escalation', 1, NULL, 1),
('watchlist_match', 'Watchlist, sanctions, or PEP match', 'escalation', 1, NULL, 1),
('provider_error', 'Verification provider error', 'manual_override', 1, NULL, 1),
('manual_override', 'Manual override', 'manual_override', 1, NULL, 1),
('other', 'Other', 'general', 1, NULL, 1);

CREATE INDEX IF NOT EXISTS idx_ekyc_status ON ekyc_verifications(status);
CREATE INDEX IF NOT EXISTS idx_ekyc_submitted_at ON ekyc_verifications(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_assigned_reviewer ON ekyc_verifications(assigned_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_risk ON ekyc_verifications(risk_level, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_manual_review ON ekyc_verifications(manual_review_required);
CREATE INDEX IF NOT EXISTS idx_ekyc_guest ON ekyc_verifications(guest_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_user ON ekyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_id_number ON ekyc_verifications(id_number);
CREATE INDEX IF NOT EXISTS idx_ekyc_email ON ekyc_verifications(email);
CREATE INDEX IF NOT EXISTS idx_ekyc_history_application ON ekyc_decision_history(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_notes_application ON ekyc_notes(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_access_application ON ekyc_access_events(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_reveals_application ON ekyc_sensitive_reveals(application_id, created_at DESC);

UPDATE route_access_policies
SET required_permissions = '["ekyc:read"]',
    nav_permissions = '["navigation_ekyc_admin:read","ekyc:read"]',
    updated_at = datetime('now')
WHERE route_id = 'ekyc-admin';


-- Migration: 012_rooms_notes.sql
-- Align SQLite rooms schema with the shared room query surface.

ALTER TABLE rooms ADD COLUMN notes TEXT;


-- Migration: 013_customer_ledger_unique_room_charge.sql
-- Prevent duplicate company room-charge postings per booking.
--
-- A booking's auto-posted city-ledger receivable (`post_type = 'room_charge'`)
-- must be unique. Previously this was only enforced by an application-level
-- EXISTS check, which is racy: two concurrent checkout requests could both
-- observe "no row" and both insert. This partial unique index makes the
-- duplicate structurally impossible so the second writer fails with a
-- constraint violation (which the app treats as an idempotent no-op).
--
-- NOTE: the SQLite `customer_ledgers` table predates the city-ledger feature
-- and does not carry the `is_reversal` column that the PostgreSQL schema uses,
-- so this predicate omits it. The PostgreSQL index (in `schema.sql`) also
-- excludes reversal rows. SQLite is a dev/offline target; production and the
-- desktop app run PostgreSQL.

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledgers_booking_room_charge
ON customer_ledgers (booking_id)
WHERE post_type = 'room_charge'
  AND booking_id IS NOT NULL;


-- Migration: 014_guest_complimentary_credits.sql
-- Align SQLite with PostgreSQL for room-type-specific complimentary credits.

CREATE TABLE IF NOT EXISTS guest_complimentary_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    nights_available INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(guest_id, room_type_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_credits_guest_id ON guest_complimentary_credits(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_credits_room_type ON guest_complimentary_credits(room_type_id);


-- Migration: 015_user_guests.sql
-- Migration: Add user-to-guest links for SQLite parity with PostgreSQL.

CREATE TABLE IF NOT EXISTS user_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    relationship_type TEXT DEFAULT 'family',
    can_book_for INTEGER DEFAULT 1,
    can_view_bookings INTEGER DEFAULT 1,
    can_modify INTEGER DEFAULT 0,
    notes TEXT,
    linked_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_guests_user_id ON user_guests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_guests_guest_id ON user_guests(guest_id);


-- Migration: 016_void_status_names.sql
-- Normalize legacy "cancelled" status values to "void".

UPDATE bookings
SET status = 'comp_void'
WHERE status = 'comp_cancelled';

UPDATE bookings
SET status = 'voided'
WHERE status = 'cancelled';

UPDATE bookings
SET payment_status = 'void'
WHERE payment_status = 'cancelled';

UPDATE payments
SET status = 'void'
WHERE status = 'cancelled';

UPDATE invoices
SET status = 'void'
WHERE status = 'cancelled';

UPDATE ekyc_verifications
SET status = 'void'
WHERE status = 'cancelled';

