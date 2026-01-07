-- ============================================================================
-- MIGRATION 003: SYSTEM SETTINGS & AUDIT
-- ============================================================================
-- Description: Audit logs, system settings, email templates
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS audit_logs_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS system_settings_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS email_templates_id_seq START WITH 1;

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT PRIMARY KEY DEFAULT nextval('audit_logs_id_seq'),
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id BIGINT,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SYSTEM SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
    id BIGINT PRIMARY KEY DEFAULT nextval('system_settings_id_seq'),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    value_type VARCHAR(20) DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
    category VARCHAR(50) DEFAULT 'general',
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    is_encrypted BOOLEAN DEFAULT false,
    validation_pattern VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- EMAIL TEMPLATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_templates (
    id BIGINT PRIMARY KEY DEFAULT nextval('email_templates_id_seq'),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    variables JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
CREATE INDEX IF NOT EXISTS idx_system_settings_public ON system_settings(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_email_templates_code ON email_templates(code);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all system actions';
COMMENT ON TABLE system_settings IS 'Configurable system-wide settings';
COMMENT ON TABLE email_templates IS 'Transactional email templates with variable support';

-- ============================================================================
-- NIGHT AUDIT SYSTEM
-- ============================================================================
-- Night audit posting system for daily data reconciliation

-- Create night_audit_runs table to track audit history
CREATE TABLE IF NOT EXISTS night_audit_runs (
    id BIGSERIAL PRIMARY KEY,
    audit_date DATE NOT NULL UNIQUE,  -- The business date being audited
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_by BIGINT REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'completed',  -- completed, failed, rolled_back

    -- Statistics captured during the audit
    total_bookings_posted INTEGER DEFAULT 0,
    total_checkins INTEGER DEFAULT 0,
    total_checkouts INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    total_rooms_occupied INTEGER DEFAULT 0,
    total_rooms_available INTEGER DEFAULT 0,
    occupancy_rate DECIMAL(5, 2) DEFAULT 0,

    -- Room status snapshot
    rooms_available INTEGER DEFAULT 0,
    rooms_occupied INTEGER DEFAULT 0,
    rooms_reserved INTEGER DEFAULT 0,
    rooms_maintenance INTEGER DEFAULT 0,
    rooms_dirty INTEGER DEFAULT 0,

    -- Breakdown data
    payment_method_breakdown JSONB DEFAULT '{}',
    booking_channel_breakdown JSONB DEFAULT '{}',

    notes TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create night_audit_details table for detailed posting records
CREATE TABLE IF NOT EXISTS night_audit_details (
    id BIGSERIAL PRIMARY KEY,
    audit_run_id BIGINT NOT NULL REFERENCES night_audit_runs(id) ON DELETE CASCADE,
    booking_id BIGINT,
    room_id BIGINT,

    record_type VARCHAR(50) NOT NULL,  -- booking, room_status, revenue, etc.
    action VARCHAR(50) NOT NULL,       -- posted, checked_in, checked_out, etc.

    -- Snapshot of data at time of posting
    data JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for night audit tables
CREATE INDEX IF NOT EXISTS idx_night_audit_runs_audit_date ON night_audit_runs(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_night_audit_details_audit_run_id ON night_audit_details(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_night_audit_details_booking_id ON night_audit_details(booking_id);

-- Create view for night audit summary
CREATE OR REPLACE VIEW night_audit_summary AS
SELECT
    nar.id,
    nar.audit_date,
    nar.run_at,
    u.username as run_by_username,
    nar.status,
    nar.total_bookings_posted,
    nar.total_checkins,
    nar.total_checkouts,
    nar.total_revenue,
    nar.occupancy_rate,
    nar.rooms_available,
    nar.rooms_occupied,
    nar.rooms_reserved,
    nar.rooms_maintenance,
    nar.rooms_dirty,
    nar.notes,
    nar.created_at
FROM night_audit_runs nar
LEFT JOIN users u ON nar.run_by = u.id
ORDER BY nar.audit_date DESC;

COMMENT ON TABLE night_audit_runs IS 'Tracks each night audit run with statistics';
COMMENT ON TABLE night_audit_details IS 'Detailed records of what was posted in each audit';
