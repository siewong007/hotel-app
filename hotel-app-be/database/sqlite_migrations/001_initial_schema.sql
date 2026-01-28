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
-- SEED DATA: DEFAULT ADMIN USER (password: admin123)
-- ============================================================================

INSERT OR IGNORE INTO users (id, uuid, username, email, password_hash, full_name, user_type, is_active, is_verified, is_super_admin)
VALUES (1, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin', 'admin@hotel.local',
        '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYBmqdQNhuay',
        'System Administrator', 'staff', 1, 1, 1);

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (1, 1);
