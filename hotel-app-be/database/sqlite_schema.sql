-- ============================================================================
-- HOTEL APP SQLITE SCHEMA
-- ============================================================================
-- Ordered, append-only schema sections. Applied transactionally by core/db.rs.
-- Never renumber an existing section; add a new numbered section for upgrades.
-- Seed and backfill statements belong in sqlite_data.sql.
-- ============================================================================

-- @migration 1 initial_schema
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

-- Migration: 007_booking_cleaning_preference.sql
-- ============================================================================
-- SQLITE MIGRATION 007: BOOKING CLEANING PREFERENCE
-- ============================================================================
-- Description:
--   Add a per-booking daily-cleaning preference captured at the front desk.
--   NULL = not set, 1 = guest wants daily cleaning, 0 = declined.
-- ============================================================================

ALTER TABLE bookings ADD COLUMN cleaning_preference INTEGER;

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


-- @migration 2 night_audit_auto_settings

-- @migration 3 channel_net_revenue
-- Channel net revenue / OTA commission report support.
-- SQLite is projection-only for this report because night audit posting is PostgreSQL-only.

CREATE TABLE IF NOT EXISTS booking_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    channel_type TEXT NOT NULL DEFAULT 'ota'
        CHECK (channel_type IN ('direct', 'ota', 'corporate', 'walk_in', 'phone', 'website', 'channel_manager', 'other')),
    default_commission_type TEXT NOT NULL DEFAULT 'none'
        CHECK (default_commission_type IN ('none', 'percentage', 'fixed_amount')),
    default_commission_value NUMERIC NOT NULL DEFAULT 0 CHECK (default_commission_value >= 0),
    default_commission_scope TEXT NOT NULL DEFAULT 'per_booking'
        CHECK (default_commission_scope IN ('per_booking', 'per_night')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        default_commission_type <> 'percentage'
        OR default_commission_value BETWEEN 0 AND 100
    )
);

ALTER TABLE bookings ADD COLUMN booking_channel_id INTEGER REFERENCES booking_channels(id);

ALTER TABLE bookings ADD COLUMN commission_type_override TEXT;

ALTER TABLE bookings ADD COLUMN commission_value_override NUMERIC;

ALTER TABLE bookings ADD COLUMN commission_scope_override TEXT;

ALTER TABLE bookings ADD COLUMN commission_amount NUMERIC;

ALTER TABLE bookings ADD COLUMN net_revenue NUMERIC;

CREATE INDEX IF NOT EXISTS idx_booking_channels_active ON booking_channels(is_active);

CREATE INDEX IF NOT EXISTS idx_booking_channels_type ON booking_channels(channel_type);

CREATE INDEX IF NOT EXISTS idx_bookings_booking_channel_id ON bookings(booking_channel_id);


-- @migration 4 company_billing_bookings
ALTER TABLE bookings ADD COLUMN company_id INTEGER;

ALTER TABLE bookings ADD COLUMN company_name TEXT;


-- @migration 5 customer_ledgers_schema_sync
-- Drop existing tables
DROP TABLE IF EXISTS customer_ledgers;

-- Recreate customer_ledgers matching postgres schema
CREATE TABLE IF NOT EXISTS customer_ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    company_registration_number TEXT,
    contact_person TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    billing_address_line1 TEXT,
    billing_city TEXT,
    billing_state TEXT,
    billing_postal_code TEXT,
    billing_country TEXT DEFAULT 'Malaysia',
    description TEXT NOT NULL,
    expense_type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'MYR',
    status TEXT NOT NULL DEFAULT 'pending',
    paid_amount REAL DEFAULT 0.00,
    -- SQLite does not support STORED generated columns in the same way, we can omit balance_due or use a view if necessary, but we can just use REAL DEFAULT 0.00 since it is not used in SQLite queries strictly or we can define it
    payment_method TEXT,
    payment_reference TEXT,
    payment_date TEXT,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    guest_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    invoice_number TEXT UNIQUE,
    invoice_date TEXT,
    due_date TEXT,
    notes TEXT,
    internal_notes TEXT,

    folio_number TEXT,
    folio_type TEXT DEFAULT 'city_ledger',
    transaction_type TEXT DEFAULT 'debit',
    post_type TEXT,
    department_code TEXT,
    transaction_code TEXT,
    room_number TEXT,
    posting_date TEXT DEFAULT (date('now')),
    transaction_date TEXT DEFAULT (date('now')),
    reference_number TEXT,
    cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_reversal INTEGER DEFAULT 0,
    original_transaction_id INTEGER REFERENCES customer_ledgers(id) ON DELETE SET NULL,
    reversal_reason TEXT,
    tax_amount REAL DEFAULT 0.00,
    service_charge REAL DEFAULT 0.00,

    void_at TEXT,
    void_by INTEGER REFERENCES users(id),
    void_reason TEXT,
    
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_ledger_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id INTEGER NOT NULL REFERENCES customer_ledgers(id) ON DELETE CASCADE,
    payment_amount REAL NOT NULL CHECK (payment_amount > 0),
    payment_method TEXT NOT NULL,
    payment_reference TEXT,
    payment_date TEXT NOT NULL DEFAULT (datetime('now')),
    receipt_number TEXT,
    receipt_file_url TEXT,
    notes TEXT,
    processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_company ON customer_ledgers(company_name);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_status ON customer_ledgers(status);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_booking ON customer_ledgers(booking_id);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_guest ON customer_ledgers(guest_id);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_due_date ON customer_ledgers(due_date);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_invoice ON customer_ledgers(invoice_number);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_number ON customer_ledgers(folio_number);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_type ON customer_ledgers(folio_type);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_room_number ON customer_ledgers(room_number);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_posting_date ON customer_ledgers(posting_date);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_transaction_code ON customer_ledgers(transaction_code);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_department_code ON customer_ledgers(department_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledgers_booking_room_charge
ON customer_ledgers (booking_id)
WHERE post_type = 'room_charge'
  AND COALESCE(is_reversal, 0) = 0
  AND booking_id IS NOT NULL;


-- @migration 6 guest_filter_fields
-- Keep the SQLite guest list contract aligned with the PostgreSQL guest schema
-- fields used by membership, tourist, missing-info, and credit filters.
ALTER TABLE guests ADD COLUMN deleted_at TEXT;

ALTER TABLE guests ADD COLUMN discount_percentage INTEGER NOT NULL DEFAULT 0;

ALTER TABLE guests ADD COLUMN tourism_type TEXT;

ALTER TABLE guests ADD COLUMN complimentary_nights_credit INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_guests_deleted_at ON guests(deleted_at);

CREATE INDEX IF NOT EXISTS idx_guests_guest_type ON guests(guest_type);

CREATE INDEX IF NOT EXISTS idx_guests_tourism_type ON guests(tourism_type);


-- @migration 7 report_font_size_setting

-- @migration 8 report_font_style_settings

-- @migration 9 loyalty_program_portal
-- Loyalty program portal schema.
-- Keeps the legacy guest-point tables intact under legacy names where they
-- conflict with the append-only portal ledger.

ALTER TABLE loyalty_transactions RENAME TO legacy_loyalty_transactions;

CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    min_points INTEGER NOT NULL DEFAULT 0,
    min_nights INTEGER NOT NULL DEFAULT 0,
    min_spend REAL NOT NULL DEFAULT 0,
    benefits TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    member_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
    enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (guest_id)
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL UNIQUE REFERENCES loyalty_members(id) ON DELETE CASCADE,
    current_tier_id INTEGER NOT NULL REFERENCES loyalty_tiers(id),
    lifetime_points INTEGER NOT NULL DEFAULT 0,
    qualifying_points INTEGER NOT NULL DEFAULT 0,
    qualifying_nights INTEGER NOT NULL DEFAULT 0,
    qualifying_spend REAL NOT NULL DEFAULT 0,
    tier_evaluation_year INTEGER NOT NULL DEFAULT (CAST(strftime('%Y', 'now') AS INTEGER)),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('pending', 'earned', 'redeemed', 'expired', 'adjusted', 'reversed')),
    points_delta INTEGER NOT NULL,
    available_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    source_type TEXT,
    source_id INTEGER,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    related_transaction_id INTEGER REFERENCES loyalty_transactions(id),
    description TEXT,
    metadata TEXT,
    actor_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    points_cost INTEGER NOT NULL CHECK (points_cost > 0),
    minimum_tier_id INTEGER REFERENCES loyalty_tiers(id),
    requires_approval INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    inventory_count INTEGER,
    valid_from TEXT,
    valid_to TEXT,
    terms_conditions TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
    reward_id INTEGER NOT NULL REFERENCES loyalty_rewards(id),
    transaction_id INTEGER REFERENCES loyalty_transactions(id),
    points_spent INTEGER NOT NULL CHECK (points_spent > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled')),
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    rejection_reason TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_program_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    points_per_currency_unit REAL NOT NULL DEFAULT 1,
    tier_qualification_metric TEXT NOT NULL DEFAULT 'points' CHECK (tier_qualification_metric IN ('points', 'nights', 'spend')),
    point_expiry_months INTEGER,
    redemption_approval_required INTEGER NOT NULL DEFAULT 1,
    earning_enabled INTEGER NOT NULL DEFAULT 1,
    min_eligible_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_members_guest ON loyalty_members(guest_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_members_number ON loyalty_members(member_number);

CREATE INDEX IF NOT EXISTS idx_loyalty_members_status ON loyalty_members(status);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_member_created ON loyalty_transactions(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_source ON loyalty_transactions(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_booking ON loyalty_transactions(booking_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_rewards_status ON loyalty_rewards(is_active, category);

CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_status ON loyalty_redemptions(status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_member ON loyalty_redemptions(member_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_earned_source
    ON loyalty_transactions(member_id, source_type, source_id, transaction_type)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND transaction_type = 'earned';

CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_reversal_once
    ON loyalty_transactions(related_transaction_id, transaction_type)
    WHERE related_transaction_id IS NOT NULL AND transaction_type = 'reversed';


-- @migration 10 guest_ekyc_auto_checkin
-- Tie eKYC/self-check-in events to guest profiles and require approved eKYC
-- for scheduled auto check-in by default.

ALTER TABLE self_checkin_events ADD COLUMN guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL;

ALTER TABLE self_checkin_events ADD COLUMN source TEXT;

CREATE INDEX IF NOT EXISTS idx_ekyc_guest_latest
    ON ekyc_verifications(guest_id, submitted_at DESC, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_self_checkin_events_guest ON self_checkin_events(guest_id);

CREATE INDEX IF NOT EXISTS idx_self_checkin_events_source ON self_checkin_events(source);


-- @migration 11 backfill_loyalty_members

-- @migration 12 guest_portal_sessions
-- Guest portal bearer-token sessions.
-- A guest logs in with their email plus a booking number or loyalty member
-- number; on success we store only the SHA-256 hash of the issued token here.
-- Distinct from the pre-check-in path tokens on the bookings table.

CREATE TABLE IF NOT EXISTS guest_portal_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_guest_portal_sessions_guest_id ON guest_portal_sessions(guest_id);

CREATE INDEX IF NOT EXISTS idx_guest_portal_sessions_expires_at ON guest_portal_sessions(expires_at);


-- @migration 13 guests_is_active
-- Guest queries select guests.is_active directly (repositories/guest.rs,
-- repositories/guest_portal.rs) but the column was never in either checked-in
-- schema; fresh databases failed with "no column found for name: is_active".
ALTER TABLE guests ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;


-- @migration 14 bookings_guest_portal_columns
-- Booking queries select these columns explicitly (repositories/guest_portal.rs
-- BOOKING_SELECT, repositories/booking.rs find_by_id) but they were never added
-- to the SQLite bookings table; fresh databases failed the guest-portal
-- pre-check-in flow with "no such column". Types mirror database/schema.sql
-- (DECIMAL -> REAL, BOOLEAN -> INTEGER, TIMESTAMPTZ -> TEXT).
ALTER TABLE bookings ADD COLUMN room_rate REAL NOT NULL DEFAULT 0;

ALTER TABLE bookings ADD COLUMN subtotal REAL NOT NULL DEFAULT 0;

ALTER TABLE bookings ADD COLUMN remarks TEXT;

ALTER TABLE bookings ADD COLUMN discount_percentage REAL DEFAULT 0;

ALTER TABLE bookings ADD COLUMN rate_override_weekday REAL;

ALTER TABLE bookings ADD COLUMN rate_override_weekend REAL;

ALTER TABLE bookings ADD COLUMN pre_checkin_completed INTEGER DEFAULT 0;

ALTER TABLE bookings ADD COLUMN pre_checkin_completed_at TEXT;

ALTER TABLE bookings ADD COLUMN pre_checkin_token TEXT;

ALTER TABLE bookings ADD COLUMN pre_checkin_token_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_pre_checkin_token ON bookings(pre_checkin_token) WHERE pre_checkin_token IS NOT NULL;


-- @migration 15 housekeeping_maintenance
-- Add housekeeping and maintenance tables missing from SQLite mode.
-- Column names mirror database/schema.sql so data-transfer import/export can
-- address both database engines consistently.

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    task_type TEXT NOT NULL DEFAULT 'cleaning',
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'void')),
    assigned_to INTEGER REFERENCES users(id),
    scheduled_date TEXT,
    task_date TEXT DEFAULT (date('now')),
    started_at TEXT,
    completed_at TEXT,
    notes TEXT,
    inspection_notes TEXT,
    items_used TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    ticket_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'on_hold', 'resolved', 'closed')),
    assigned_to INTEGER REFERENCES users(id),
    reported_by INTEGER REFERENCES users(id),
    estimated_cost REAL,
    actual_cost REAL,
    estimated_hours REAL,
    actual_hours REAL,
    scheduled_date TEXT,
    started_at TEXT,
    resolved_at TEXT,
    resolution_notes TEXT,
    images TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_room_id ON housekeeping_tasks(room_id);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_status ON housekeeping_tasks(status);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_assigned_to ON housekeeping_tasks(assigned_to);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_scheduled_date ON housekeeping_tasks(scheduled_date);

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_room_id ON maintenance_tickets(room_id);

CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(status);


-- @migration 16 bookings_ota_reference
-- Store OTA/platform reference numbers for monthly channel statements.

ALTER TABLE bookings ADD COLUMN ota_reference TEXT;


-- @migration 17 room_events
-- Room events log: status changes, scheduled events (mirrors Postgres room_events)
-- Fixes: INSERT_ROOM_EVENT / INSERT_ROOM_EVENT_FULL / GET_ROOM_EVENTS in
-- src/repositories/rooms_queries.rs referenced a table that never had a migration.

CREATE TABLE IF NOT EXISTS room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL DEFAULT 'status_change',
    status TEXT,
    priority TEXT DEFAULT 'normal',
    notes TEXT,
    scheduled_date TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_id);

CREATE INDEX IF NOT EXISTS idx_room_events_created ON room_events(created_at DESC);


-- @migration 18 room_history
-- room_history: guest check-in/check-out status history (mirrors Postgres room_history).
-- Fixes: INSERT_ROOM_HISTORY / INSERT_ROOM_HISTORY_CHANGE / GET_ROOM_HISTORY in
-- src/repositories/rooms_queries.rs target "room_history", which is NOT the same
-- table as the pre-existing room_status_history (different columns). SQLite never
-- had a matching migration, so these queries fail with "no such table: room_history"
-- on every SQLite build.

CREATE TABLE IF NOT EXISTS room_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    notes TEXT,
    start_date TEXT,
    end_date TEXT,
    changed_by INTEGER REFERENCES users(id),
    is_auto_generated INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_room_history_room ON room_history(room_id);

CREATE INDEX IF NOT EXISTS idx_room_history_created ON room_history(created_at DESC);


-- @migration 19 companies_rbac

-- @migration 20 bookings_tourism_extra_bed_columns
-- (See 021_customer_ledgers_balance_due.sql for an unrelated, separately
-- discovered column gap in customer_ledgers.)
--
-- bookings.is_tourist/tourism_tax_amount/extra_bed_count/extra_bed_charge
-- exist on the bookings table in schema.sql (PostgreSQL) but were never
-- added to SQLite (a same-named extra_bed_charge column on a different
-- table in 001_initial_schema.sql masked this on a naive grep). Rust
-- already computes and binds all four on both insert and update paths
-- (repositories/bookings/lifecycle.rs) for both DB flavors -- only the
-- column definitions were missing here, surfaced by payment_record.rs
-- test failures.

ALTER TABLE bookings ADD COLUMN is_tourist INTEGER DEFAULT 0;

ALTER TABLE bookings ADD COLUMN tourism_tax_amount DECIMAL(10,2) DEFAULT 0;

ALTER TABLE bookings ADD COLUMN extra_bed_count INTEGER DEFAULT 0;

ALTER TABLE bookings ADD COLUMN extra_bed_charge DECIMAL(10,2) DEFAULT 0;


-- @migration 21 customer_ledgers_balance_due
-- customer_ledgers.balance_due is a STORED generated column in PostgreSQL
-- (schema.sql: GENERATED ALWAYS AS (amount - paid_amount) STORED), but
-- 005_customer_ledgers_schema_sync.sql left it as an unresolved TODO ("we
-- can omit balance_due... it is not used in SQLite queries strictly") when
-- it recreated this table. That assumption is no longer true:
-- repositories/ledger.rs reads balance_due in every SELECT field list and
-- in the invoice_state/balance_state/ui_status filter predicates that
-- derive a ledger's displayed status (outstanding/paid/overdue/partial/
-- invoiced/ready_to_invoice/draft). No INSERT/UPDATE statement in
-- repositories/ledger.rs writes to balance_due directly (it is correctly
-- omitted from every VALUES list already), matching generated-column
-- semantics on both DB flavors.
--
-- SQLite 3.31+ supports STORED generated columns via ALTER TABLE ADD COLUMN.

ALTER TABLE customer_ledgers
    ADD COLUMN balance_due DECIMAL(10, 2) GENERATED ALWAYS AS (amount - paid_amount) STORED;


-- @migration 22 customer_ledgers_posting_columns
-- customer_ledgers.net_amount/is_posted/posted_at exist in schema.sql
-- (PostgreSQL) but were never added to SQLite by 005's table recreation.
-- All three are read-only in repositories/ledger.rs (SELECT field lists
-- only; grepped for INSERT/UPDATE binds, found none), so plain columns
-- with schema.sql's defaults are sufficient -- no generated-column
-- semantics needed here (unlike balance_due, see migration 021).

ALTER TABLE customer_ledgers ADD COLUMN net_amount DECIMAL(10, 2);

ALTER TABLE customer_ledgers ADD COLUMN is_posted INTEGER DEFAULT 1;

ALTER TABLE customer_ledgers ADD COLUMN posted_at TIMESTAMP;


-- @migration 23 payments_refund_rbac


-- @migration 24 support_workflow
-- Guest-support conversations are separate from maintenance work orders. The
-- tables mirror the PostgreSQL support workflow schema while storing event
-- metadata as JSON text in SQLite.

CREATE TABLE IF NOT EXISTS support_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_number TEXT NOT NULL UNIQUE,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    category TEXT NOT NULL CHECK (
        category IN ('booking', 'stay', 'billing', 'loyalty', 'technical', 'other')
    ),
    status TEXT NOT NULL DEFAULT 'waiting_for_staff' CHECK (
        status IN ('waiting_for_staff', 'waiting_for_guest', 'resolved', 'closed')
    ),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (
        priority IN ('low', 'normal', 'high', 'urgent')
    ),
    assigned_team TEXT NOT NULL DEFAULT 'front_desk',
    assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
    escalated_at TEXT,
    first_response_due_at TEXT,
    resolution_due_at TEXT,
    first_response_at TEXT,
    resolved_at TEXT,
    closed_at TEXT,
    resolution_code TEXT,
    resolution_summary TEXT,
    reopen_count INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK (author_type IN ('guest', 'staff', 'system')),
    author_guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    client_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    actor_guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_action_idempotency_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (conversation_id, actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_conversations_guest_activity
    ON support_conversations (guest_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_queue
    ON support_conversations (status, priority DESC, first_response_due_at, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_support_conversations_assignee
    ON support_conversations (assigned_to_user_id, status, last_activity_at DESC)
    WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_conversations_booking
    ON support_conversations (booking_id)
    WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_created
    ON support_messages (conversation_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_client_id
    ON support_messages (conversation_id, author_type, client_message_id)
    WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_events_conversation_created
    ON support_events (conversation_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS update_support_conversations_updated_at
AFTER UPDATE ON support_conversations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE support_conversations
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
