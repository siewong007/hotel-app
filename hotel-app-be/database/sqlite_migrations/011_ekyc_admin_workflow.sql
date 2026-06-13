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
