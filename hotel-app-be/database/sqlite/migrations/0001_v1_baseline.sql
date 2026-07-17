-- SQLite Generation 1 / V1 immutable baseline.

-- Generated from the canonical final-state dump. Do not edit after release; add a new generation migration instead.

CREATE TABLE roles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system_role INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE permissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  is_system_permission INTEGER DEFAULT 0,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE role_permissions(
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TEXT DEFAULT(datetime('now')),
  granted_by INTEGER,
  PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE users(
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
  password_changed_at TEXT DEFAULT(datetime('now')),
  created_at TEXT DEFAULT(datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT(datetime('now')),
  updated_by INTEGER REFERENCES users(id),
  deleted_at TEXT
);
CREATE TABLE user_roles(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TEXT DEFAULT(datetime('now')),
  assigned_by INTEGER REFERENCES users(id),
  expires_at TEXT,
  PRIMARY KEY(user_id, role_id)
);
CREATE TABLE user_permissions(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  assigned_at TEXT DEFAULT(datetime('now')),
  assigned_by INTEGER REFERENCES users(id),
  PRIMARY KEY(user_id, permission_id)
);
CREATE TABLE refresh_tokens(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_info TEXT,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT(datetime('now')),
  last_used_at TEXT DEFAULT(datetime('now')),
  is_revoked INTEGER DEFAULT 0,
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id)
);
CREATE TABLE user_sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT,
  user_agent TEXT,
  device_info TEXT,
  started_at TEXT DEFAULT(datetime('now')),
  last_activity_at TEXT DEFAULT(datetime('now')),
  expires_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 1
);
CREATE TABLE system_settings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  value_type TEXT DEFAULT 'string',
  category TEXT DEFAULT 'general',
  description TEXT,
  is_sensitive INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT(datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);
CREATE TABLE audit_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_values TEXT,
  new_values TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE guests(
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
  created_at TEXT DEFAULT(datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT(datetime('now')),
  updated_by INTEGER REFERENCES users(id)
  ,
  deleted_at TEXT,
  discount_percentage INTEGER NOT NULL DEFAULT 0,
  tourism_type TEXT,
  complimentary_nights_credit INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE guest_rewards(
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
  created_at TEXT DEFAULT(datetime('now')),
  used_at TEXT
);
CREATE TABLE room_types(
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
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
  ,
  images TEXT,
  features TEXT
);
CREATE TABLE rooms(
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
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
  ,
  notes TEXT
);
CREATE TABLE amenities(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  category TEXT,
  description TEXT,
  icon TEXT,
  is_chargeable INTEGER DEFAULT 0,
  charge_amount REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE room_amenities(
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  notes TEXT,
  PRIMARY KEY(room_id, amenity_id)
);
CREATE TABLE room_type_amenities(
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  is_default INTEGER DEFAULT 1,
  PRIMARY KEY(room_type_id, amenity_id)
);
CREATE TABLE rate_codes(
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
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE market_codes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE seasonal_rates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  rate_multiplier REAL DEFAULT 1.0,
  fixed_rate REAL,
  priority INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE bookings(
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
  created_at TEXT DEFAULT(datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT(datetime('now')),
  updated_by INTEGER REFERENCES users(id)
  ,
  cleaning_preference INTEGER,
  booking_channel_id INTEGER REFERENCES booking_channels(id),
  commission_type_override TEXT,
  commission_value_override NUMERIC,
  commission_scope_override TEXT,
  commission_amount NUMERIC,
  net_revenue NUMERIC,
  company_id INTEGER,
  company_name TEXT,
  room_rate REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  remarks TEXT,
  discount_percentage REAL DEFAULT 0,
  rate_override_weekday REAL,
  rate_override_weekend REAL,
  pre_checkin_completed INTEGER DEFAULT 0,
  pre_checkin_completed_at TEXT,
  pre_checkin_token TEXT,
  pre_checkin_token_expires_at TEXT,
  ota_reference TEXT,
  is_tourist INTEGER DEFAULT 0,
  tourism_tax_amount DECIMAL(10,2) DEFAULT 0,
  extra_bed_count INTEGER DEFAULT 0,
  extra_bed_charge DECIMAL(10,2) DEFAULT 0,
  daily_rates TEXT,
  portal_request_id TEXT,
  currency TEXT NOT NULL DEFAULT 'MYR'
);
CREATE TABLE booking_guests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  is_primary INTEGER DEFAULT 0,
  relationship TEXT,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE booking_modifications(
  id TEXT PRIMARY KEY DEFAULT(lower(hex(randomblob(16)))),
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  modification_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  price_adjustment REAL DEFAULT 0,
  modified_at TEXT DEFAULT(datetime('now')),
  modified_by INTEGER REFERENCES users(id)
);
CREATE TABLE booking_history(
  id TEXT PRIMARY KEY DEFAULT(lower(hex(randomblob(16)))),
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  change_reason TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE INDEX idx_booking_modifications_booking ON booking_modifications(
  booking_id
);
CREATE INDEX idx_booking_modifications_modified_at ON booking_modifications(
  modified_at
);
CREATE INDEX idx_booking_history_booking ON booking_history(booking_id);
CREATE INDEX idx_booking_history_created_at ON booking_history(created_at);
CREATE TABLE payments(
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
  processed_at TEXT DEFAULT(datetime('now')),
  processed_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  void_reason TEXT,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE invoices(
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
  created_at TEXT DEFAULT(datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE invoice_items(
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
CREATE TABLE room_status_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TEXT DEFAULT(datetime('now')),
  changed_by INTEGER REFERENCES users(id),
  reason TEXT,
  booking_id INTEGER REFERENCES bookings(id)
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_uuid ON users(uuid);
CREATE INDEX idx_guests_email ON guests(email);
CREATE INDEX idx_guests_phone ON guests(phone);
CREATE INDEX idx_guests_ic_number ON guests(ic_number);
CREATE INDEX idx_guests_guest_code ON guests(guest_code);
CREATE INDEX idx_rooms_room_number ON rooms(room_number);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_room_type ON rooms(room_type_id);
CREATE INDEX idx_bookings_guest ON bookings(guest_id);
CREATE INDEX idx_bookings_room ON bookings(room_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_check_in ON bookings(check_in_date);
CREATE INDEX idx_bookings_check_out ON bookings(check_out_date);
CREATE INDEX idx_bookings_booking_number ON bookings(booking_number);
CREATE INDEX idx_bookings_folio ON bookings(folio_number);
CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_guest ON payments(guest_id);
CREATE INDEX idx_invoices_booking ON invoices(booking_id);
CREATE INDEX idx_invoices_guest ON invoices(guest_id);
CREATE TABLE route_access_policies(
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
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE invalid_data_quarantine(
  quarantine_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_table TEXT NOT NULL,
  source_key TEXT,
  invalid_reason TEXT NOT NULL,
  original_data TEXT NOT NULL,
  quarantined_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX idx_invalid_data_quarantine_source
ON invalid_data_quarantine(
  source_table,
  quarantined_at DESC
);
CREATE TABLE ekyc_verifications(
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
  submitted_at TEXT DEFAULT(datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE ekyc_decision_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason_code TEXT,
  reason TEXT,
  details TEXT,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE ekyc_notes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'internal',
  body TEXT NOT NULL,
  customer_visible INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE ekyc_sensitive_reveals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE ekyc_access_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE ekyc_idempotency_keys(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT DEFAULT(datetime('now')),
  UNIQUE(application_id, actor_id, idempotency_key)
);
CREATE TABLE ekyc_reason_codes(
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  requires_details INTEGER NOT NULL DEFAULT 0,
  customer_message_template TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE self_checkin_events(
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
  created_at TEXT DEFAULT(datetime('now'))
  ,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  source TEXT
);
CREATE INDEX idx_ekyc_status ON ekyc_verifications(status);
CREATE INDEX idx_ekyc_submitted_at ON ekyc_verifications(submitted_at DESC);
CREATE INDEX idx_ekyc_assigned_reviewer ON ekyc_verifications(
  assigned_reviewer_id
);
CREATE INDEX idx_ekyc_risk ON ekyc_verifications(risk_level, risk_score DESC);
CREATE INDEX idx_ekyc_manual_review ON ekyc_verifications(
  manual_review_required
);
CREATE INDEX idx_ekyc_guest ON ekyc_verifications(guest_id);
CREATE INDEX idx_ekyc_user ON ekyc_verifications(user_id);
CREATE INDEX idx_ekyc_id_number ON ekyc_verifications(id_number);
CREATE INDEX idx_ekyc_email ON ekyc_verifications(email);
CREATE INDEX idx_ekyc_history_application ON ekyc_decision_history(
  application_id,
  created_at DESC
);
CREATE INDEX idx_ekyc_notes_application ON ekyc_notes(
  application_id,
  created_at DESC
);
CREATE INDEX idx_ekyc_access_application ON ekyc_access_events(
  application_id,
  created_at DESC
);
CREATE INDEX idx_ekyc_reveals_application ON ekyc_sensitive_reveals(
  application_id,
  created_at DESC
);
CREATE TABLE guest_complimentary_credits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  nights_available INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now')),
  UNIQUE(guest_id, room_type_id)
);
CREATE INDEX idx_guest_credits_guest_id ON guest_complimentary_credits(
  guest_id
);
CREATE INDEX idx_guest_credits_room_type ON guest_complimentary_credits(
  room_type_id
);
CREATE TABLE user_guests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT 'family',
  can_book_for INTEGER DEFAULT 1,
  can_view_bookings INTEGER DEFAULT 1,
  can_modify INTEGER DEFAULT 0,
  notes TEXT,
  linked_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now')),
  UNIQUE(user_id, guest_id)
);
CREATE INDEX idx_user_guests_user_id ON user_guests(user_id);
CREATE INDEX idx_user_guests_guest_id ON user_guests(guest_id);
CREATE TABLE booking_channels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  channel_type TEXT NOT NULL DEFAULT 'ota'
  CHECK(channel_type IN('direct', 'ota', 'corporate', 'walk_in', 'phone', 'website', 'channel_manager', 'other')),
  default_commission_type TEXT NOT NULL DEFAULT 'none'
  CHECK(default_commission_type IN('none', 'percentage', 'fixed_amount')),
  default_commission_value NUMERIC NOT NULL DEFAULT 0 CHECK(default_commission_value >= 0),
  default_commission_scope TEXT NOT NULL DEFAULT 'per_booking'
  CHECK(default_commission_scope IN('per_booking', 'per_night')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  CHECK(default_commission_type <> 'percentage'
OR default_commission_value BETWEEN 0 AND 100)
);
CREATE INDEX idx_booking_channels_active ON booking_channels(is_active);
CREATE INDEX idx_booking_channels_type ON booking_channels(channel_type);
CREATE INDEX idx_bookings_booking_channel_id ON bookings(booking_channel_id);
CREATE TABLE customer_ledgers(
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
  posting_date TEXT DEFAULT(date('now')),
  transaction_date TEXT DEFAULT(date('now')),
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
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
  ,
  balance_due DECIMAL(10, 2) GENERATED ALWAYS AS(amount - paid_amount) STORED,
  net_amount DECIMAL(10, 2),
  is_posted INTEGER DEFAULT 1,
  posted_at TIMESTAMP
);
CREATE TABLE customer_ledger_payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES customer_ledgers(id) ON DELETE CASCADE,
  payment_amount REAL NOT NULL CHECK(payment_amount > 0),
  payment_method TEXT NOT NULL,
  payment_reference TEXT,
  payment_date TEXT NOT NULL DEFAULT(datetime('now')),
  receipt_number TEXT,
  receipt_file_url TEXT,
  notes TEXT,
  processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX idx_customer_ledgers_company ON customer_ledgers(company_name);
CREATE INDEX idx_customer_ledgers_status ON customer_ledgers(status);
CREATE INDEX idx_customer_ledgers_booking ON customer_ledgers(booking_id);
CREATE INDEX idx_customer_ledgers_guest ON customer_ledgers(guest_id);
CREATE INDEX idx_customer_ledgers_due_date ON customer_ledgers(due_date);
CREATE INDEX idx_customer_ledgers_invoice ON customer_ledgers(invoice_number);
CREATE INDEX idx_customer_ledgers_folio_number ON customer_ledgers(
  folio_number
);
CREATE INDEX idx_customer_ledgers_folio_type ON customer_ledgers(folio_type);
CREATE INDEX idx_customer_ledgers_room_number ON customer_ledgers(room_number);
CREATE INDEX idx_customer_ledgers_posting_date ON customer_ledgers(
  posting_date
);
CREATE INDEX idx_customer_ledgers_transaction_code ON customer_ledgers(
  transaction_code
);
CREATE INDEX idx_customer_ledgers_department_code ON customer_ledgers(
  department_code
);
CREATE UNIQUE INDEX uq_customer_ledgers_booking_room_charge
ON customer_ledgers(
  booking_id
)
WHERE post_type = 'room_charge'

    AND COALESCE(is_reversal, 0) = 0

    AND booking_id IS NOT NULL;
CREATE INDEX idx_guests_deleted_at ON guests(deleted_at);
CREATE INDEX idx_guests_guest_type ON guests(guest_type);
CREATE INDEX idx_guests_tourism_type ON guests(tourism_type);
CREATE TABLE loyalty_tiers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  min_points INTEGER NOT NULL DEFAULT 0,
  min_nights INTEGER NOT NULL DEFAULT 0,
  min_spend REAL NOT NULL DEFAULT 0,
  benefits TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE loyalty_members(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  member_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active', 'suspended', 'closed')),
  enrolled_at TEXT NOT NULL DEFAULT(datetime('now')),
  closed_at TEXT,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now')),
  UNIQUE(guest_id)
);
CREATE TABLE loyalty_accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL UNIQUE REFERENCES loyalty_members(id) ON DELETE CASCADE,
  current_tier_id INTEGER NOT NULL REFERENCES loyalty_tiers(id),
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  qualifying_points INTEGER NOT NULL DEFAULT 0,
  qualifying_nights INTEGER NOT NULL DEFAULT 0,
  qualifying_spend REAL NOT NULL DEFAULT 0,
  tier_evaluation_year INTEGER NOT NULL DEFAULT(CAST(strftime('%Y', 'now') AS INTEGER)),
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE loyalty_transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN('pending', 'earned', 'redeemed', 'expired', 'adjusted', 'reversed')),
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
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE loyalty_rewards(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  points_cost INTEGER NOT NULL CHECK(points_cost > 0),
  minimum_tier_id INTEGER REFERENCES loyalty_tiers(id),
  requires_approval INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  inventory_count INTEGER,
  valid_from TEXT,
  valid_to TEXT,
  terms_conditions TEXT,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE loyalty_redemptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  reward_id INTEGER NOT NULL REFERENCES loyalty_rewards(id),
  transaction_id INTEGER REFERENCES loyalty_transactions(id),
  points_spent INTEGER NOT NULL CHECK(points_spent > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending', 'approved', 'rejected', 'fulfilled')),
  requested_at TEXT NOT NULL DEFAULT(datetime('now')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  rejection_reason TEXT,
  notes TEXT,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE loyalty_program_rules(
  id INTEGER PRIMARY KEY CHECK(id = 1),
  points_per_currency_unit REAL NOT NULL DEFAULT 1,
  tier_qualification_metric TEXT NOT NULL DEFAULT 'points' CHECK(tier_qualification_metric IN('points', 'nights', 'spend')),
  point_expiry_months INTEGER,
  redemption_approval_required INTEGER NOT NULL DEFAULT 1,
  earning_enabled INTEGER NOT NULL DEFAULT 1,
  min_eligible_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE INDEX idx_loyalty_members_guest ON loyalty_members(guest_id);
CREATE INDEX idx_loyalty_members_number ON loyalty_members(member_number);
CREATE INDEX idx_loyalty_members_status ON loyalty_members(status);
CREATE INDEX idx_loyalty_transactions_member_created ON loyalty_transactions(
  member_id,
  created_at DESC
);
CREATE INDEX idx_loyalty_transactions_source ON loyalty_transactions(
  source_type,
  source_id
);
CREATE INDEX idx_loyalty_transactions_booking ON loyalty_transactions(
  booking_id
);
CREATE INDEX idx_loyalty_rewards_status ON loyalty_rewards(
  is_active,
  category
);
CREATE INDEX idx_loyalty_redemptions_status ON loyalty_redemptions(
  status,
  requested_at DESC
);
CREATE INDEX idx_loyalty_redemptions_member ON loyalty_redemptions(
  member_id,
  requested_at DESC
);
CREATE UNIQUE INDEX ux_loyalty_earned_source
ON loyalty_transactions(
  member_id,
  source_type,
  source_id,
  transaction_type
)
WHERE source_type IS NOT NULL 
    AND source_id IS NOT NULL 
    AND transaction_type = 'earned';
CREATE UNIQUE INDEX ux_loyalty_reversal_once
ON loyalty_transactions(
  related_transaction_id,
  transaction_type
)
WHERE related_transaction_id IS NOT NULL 
    AND transaction_type = 'reversed';
CREATE INDEX idx_ekyc_guest_latest
ON ekyc_verifications(
  guest_id,
  submitted_at DESC,
  updated_at DESC,
  id DESC
);
CREATE INDEX idx_self_checkin_events_guest ON self_checkin_events(guest_id);
CREATE INDEX idx_self_checkin_events_source ON self_checkin_events(source);
CREATE TABLE guest_portal_sessions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  last_used_at TEXT
);
CREATE INDEX idx_guest_portal_sessions_guest_id ON guest_portal_sessions(
  guest_id
);
CREATE INDEX idx_guest_portal_sessions_expires_at ON guest_portal_sessions(
  expires_at
);
CREATE INDEX idx_bookings_pre_checkin_token ON bookings(
  pre_checkin_token
) WHERE pre_checkin_token IS NOT NULL;
CREATE TABLE housekeeping_tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL DEFAULT 'cleaning',
  priority TEXT DEFAULT 'normal' CHECK(priority IN('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'pending' CHECK(status IN('pending', 'in_progress', 'completed', 'void')),
  assigned_to INTEGER REFERENCES users(id),
  scheduled_date TEXT,
  task_date TEXT DEFAULT(date('now')),
  started_at TEXT,
  completed_at TEXT,
  notes TEXT,
  inspection_notes TEXT,
  items_used TEXT,
  created_at TEXT DEFAULT(datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE maintenance_tickets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  ticket_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK(priority IN('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'open' CHECK(status IN('open', 'in_progress', 'on_hold', 'resolved', 'closed')),
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
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE INDEX idx_housekeeping_tasks_room_id ON housekeeping_tasks(room_id);
CREATE INDEX idx_housekeeping_tasks_status ON housekeeping_tasks(status);
CREATE INDEX idx_housekeeping_tasks_assigned_to ON housekeeping_tasks(
  assigned_to
);
CREATE INDEX idx_housekeeping_tasks_scheduled_date ON housekeeping_tasks(
  scheduled_date
);
CREATE INDEX idx_maintenance_tickets_room_id ON maintenance_tickets(room_id);
CREATE INDEX idx_maintenance_tickets_status ON maintenance_tickets(status);
CREATE TABLE room_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'status_change',
  status TEXT,
  priority TEXT DEFAULT 'normal',
  notes TEXT,
  scheduled_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT(datetime('now')),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE INDEX idx_room_events_room ON room_events(room_id);
CREATE INDEX idx_room_events_created ON room_events(created_at DESC);
CREATE TABLE room_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  notes TEXT,
  start_date TEXT,
  end_date TEXT,
  changed_by INTEGER REFERENCES users(id),
  is_auto_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT(datetime('now'))
);
CREATE INDEX idx_room_history_room ON room_history(room_id);
CREATE INDEX idx_room_history_created ON room_history(created_at DESC);
CREATE TABLE support_conversations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_number TEXT NOT NULL UNIQUE,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN('booking', 'stay', 'billing', 'loyalty', 'technical', 'other')),
  status TEXT NOT NULL DEFAULT 'waiting_for_staff' CHECK(status IN('waiting_for_staff', 'waiting_for_guest', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('low', 'normal', 'high', 'urgent')),
  assigned_team TEXT NOT NULL DEFAULT 'front_desk',
  assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0 CHECK(escalation_level BETWEEN 0 AND 3),
  escalated_at TEXT,
  first_response_due_at TEXT,
  resolution_due_at TEXT,
  first_response_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  resolution_code TEXT,
  resolution_summary TEXT,
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK(reopen_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  last_activity_at TEXT NOT NULL DEFAULT(datetime('now')),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE support_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK(author_type IN('guest', 'staff', 'system')),
  author_guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  client_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE support_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  actor_guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE support_action_idempotency_keys(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(conversation_id, actor_user_id, idempotency_key)
);
CREATE INDEX idx_support_conversations_guest_activity
ON support_conversations(
  guest_id,
  last_activity_at DESC
);
CREATE INDEX idx_support_conversations_queue
ON support_conversations(
  status,
  priority DESC,
  first_response_due_at,
  last_activity_at
);
CREATE INDEX idx_support_conversations_assignee
ON support_conversations(
  assigned_to_user_id,
  status,
  last_activity_at DESC
)
WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX idx_support_conversations_booking
ON support_conversations(
  booking_id
)
WHERE booking_id IS NOT NULL;
CREATE INDEX idx_support_messages_conversation_created
ON support_messages(
  conversation_id,
  created_at,
  id
);
CREATE UNIQUE INDEX uq_support_messages_client_id
ON support_messages(
  conversation_id,
  author_type,
  client_message_id
)
WHERE client_message_id IS NOT NULL;
CREATE INDEX idx_support_events_conversation_created
ON support_events(
  conversation_id,
  created_at,
  id
);
CREATE TRIGGER update_support_conversations_updated_at
AFTER UPDATE ON support_conversations
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE support_conversations
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
CREATE TABLE support_guest_request_idempotency_keys(
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(guest_id, idempotency_key)
);
CREATE INDEX idx_support_guest_request_idempotency_conversation
ON support_guest_request_idempotency_keys(
  conversation_id
);
CREATE TABLE promotions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft', 'published', 'paused', 'archived')),
  promotion_kind TEXT NOT NULL DEFAULT 'voucher' CHECK(promotion_kind IN('deal', 'voucher')),
  discount_type TEXT NOT NULL CHECK(discount_type IN('percentage', 'fixed_amount')),
  discount_value DECIMAL(12, 2) NOT NULL,
  max_discount_amount DECIMAL(12, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  claim_starts_at TEXT,
  claim_ends_at TEXT,
  stay_starts_on TEXT,
  stay_ends_on TEXT,
  min_nights INTEGER NOT NULL DEFAULT 1,
  max_nights INTEGER,
  min_subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
  claim_limit INTEGER,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  per_guest_limit INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN(0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  is_cancellable INTEGER NOT NULL DEFAULT 1 CHECK(is_cancellable IN(0, 1)),
  CONSTRAINT promotions_slug_not_blank CHECK(length(trim(slug)) > 0),
  CONSTRAINT promotions_name_not_blank CHECK(length(trim(name)) > 0),
  CONSTRAINT promotions_discount_value_valid CHECK(discount_value >= 0
AND(discount_type <> 'percentage' OR discount_value <= 100)),
  CONSTRAINT promotions_max_discount_valid CHECK(max_discount_amount IS NULL OR max_discount_amount >= 0),
  CONSTRAINT promotions_currency_valid CHECK(length(currency) = 3 AND currency = upper(currency)),
  CONSTRAINT promotions_claim_window_valid CHECK(claim_starts_at IS NULL
OR claim_ends_at IS NULL
OR claim_ends_at > claim_starts_at),
  CONSTRAINT promotions_stay_window_valid CHECK(stay_starts_on IS NULL
OR stay_ends_on IS NULL
OR stay_ends_on >= stay_starts_on),
  CONSTRAINT promotions_nights_valid CHECK(min_nights >= 1 AND(max_nights IS NULL OR max_nights >= min_nights)),
  CONSTRAINT promotions_min_subtotal_valid CHECK(min_subtotal >= 0),
  CONSTRAINT promotions_claim_limit_valid CHECK(claim_limit IS NULL OR claim_limit >= 0),
  CONSTRAINT promotions_claimed_count_valid CHECK(claimed_count >= 0 AND(claim_limit IS NULL OR claimed_count <= claim_limit)),
  CONSTRAINT promotions_per_guest_limit_valid CHECK(per_guest_limit >= 1),
  CONSTRAINT promotions_version_valid CHECK(version >= 1)
);
CREATE TABLE promotion_room_types(
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(promotion_id, room_type_id)
);
CREATE TABLE vouchers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN('available', 'redeemed', 'revoked')),
  source TEXT NOT NULL CHECK(source IN('guest_claim', 'admin_issue')),
  expires_at TEXT,
  redeemed_at TEXT,
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason TEXT,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  source_reference TEXT,
  CONSTRAINT vouchers_code_not_blank CHECK(length(trim(code)) > 0)
);
CREATE TABLE voucher_redemptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN('applied', 'reversed')),
  gross_subtotal DECIMAL(12, 2) NOT NULL CHECK(gross_subtotal >= 0),
  discount_type TEXT NOT NULL CHECK(discount_type IN('percentage', 'fixed_amount')),
  discount_value DECIMAL(12, 2) NOT NULL CHECK(discount_value >= 0
AND(discount_type <> 'percentage' OR discount_value <= 100)),
  discount_amount DECIMAL(12, 2) NOT NULL CHECK(discount_amount >= 0 AND discount_amount <= gross_subtotal),
  net_total DECIMAL(12, 2) NOT NULL CHECK(net_total >= 0 AND net_total = gross_subtotal - discount_amount),
  applied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applied_at TEXT NOT NULL DEFAULT(datetime('now')),
  reversed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TEXT,
  reversal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE voucher_redemption_allocations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  redemption_id INTEGER NOT NULL REFERENCES voucher_redemptions(id) ON DELETE CASCADE,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  stay_date TEXT NOT NULL,
  gross_amount DECIMAL(12, 2) NOT NULL CHECK(gross_amount >= 0),
  discount_amount DECIMAL(12, 2) NOT NULL CHECK(discount_amount >= 0 AND discount_amount <= gross_amount),
  net_amount DECIMAL(12, 2) NOT NULL CHECK(net_amount >= 0 AND net_amount = gross_amount - discount_amount),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(redemption_id, stay_date)
);
CREATE INDEX idx_promotions_public_window
ON promotions(
  status,
  is_public,
  claim_starts_at,
  claim_ends_at
);
CREATE INDEX idx_promotion_room_types_room_type
ON promotion_room_types(
  room_type_id,
  promotion_id
);
CREATE INDEX idx_vouchers_guest_status
ON vouchers(
  guest_id,
  status,
  expires_at
);
CREATE INDEX idx_vouchers_promotion_guest
ON vouchers(
  promotion_id,
  guest_id,
  status
);
CREATE UNIQUE INDEX uq_voucher_redemptions_active_voucher
ON voucher_redemptions(
  voucher_id
)
WHERE status = 'applied';
CREATE UNIQUE INDEX uq_voucher_redemptions_active_booking
ON voucher_redemptions(
  booking_id
)
WHERE status = 'applied';
CREATE INDEX idx_voucher_redemptions_guest_applied
ON voucher_redemptions(
  guest_id,
  applied_at DESC
);
CREATE INDEX idx_voucher_redemption_allocations_booking_date
ON voucher_redemption_allocations(
  booking_id,
  stay_date
);
CREATE TRIGGER update_promotions_updated_at
AFTER UPDATE ON promotions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE promotions
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
CREATE TRIGGER update_vouchers_updated_at
AFTER UPDATE ON vouchers
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE vouchers
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
CREATE TRIGGER update_voucher_redemptions_updated_at
AFTER UPDATE ON voucher_redemptions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE voucher_redemptions
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
CREATE UNIQUE INDEX uq_vouchers_promotion_guest
ON vouchers(
  promotion_id,
  guest_id
);
CREATE TABLE email_templates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  variables TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0, 1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE notification_subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN('email')),
  topic TEXT NOT NULL CHECK(topic IN('announcement', 'promotion', 'birthday_voucher')),
  subscribed INTEGER NOT NULL DEFAULT 0 CHECK(subscribed IN(0, 1)),
  source TEXT,
  policy_version TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  CONSTRAINT uq_notification_subscriptions_guest_channel_topic UNIQUE(guest_id, channel, topic)
);
CREATE TABLE notification_consent_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  topic TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN('opt_in', 'opt_out')),
  source TEXT NOT NULL,
  policy_version TEXT,
  actor_type TEXT NOT NULL DEFAULT 'guest' CHECK(actor_type IN('guest', 'staff', 'system')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE email_campaigns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK(campaign_type IN('announcement', 'promotion')),
  topic TEXT NOT NULL CHECK(topic IN('announcement', 'promotion')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft', 'scheduled', 'running', 'completed', 'cancelled', 'failed')),
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  promotion_id INTEGER REFERENCES promotions(id) ON DELETE RESTRICT,
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  CONSTRAINT email_campaigns_subject_not_blank CHECK(length(trim(subject)) > 0),
  CONSTRAINT email_campaigns_promotion_required CHECK(campaign_type <> 'promotion' OR promotion_id IS NOT NULL)
);
CREATE TABLE email_suppressions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK(reason IN('unsubscribe', 'bounce', 'complaint', 'manual')),
  source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  CONSTRAINT email_suppressions_email_lower CHECK(email = lower(email))
);
CREATE INDEX idx_notification_subscriptions_topic
ON notification_subscriptions(
  channel,
  topic,
  subscribed
);
CREATE INDEX idx_notification_consent_events_guest
ON notification_consent_events(
  guest_id,
  created_at
);
CREATE INDEX idx_email_campaigns_status
ON email_campaigns(
  status,
  scheduled_at
);
CREATE UNIQUE INDEX uq_vouchers_source_reference
ON vouchers(
  guest_id,
  source_reference
)
WHERE source_reference IS NOT NULL;
CREATE TRIGGER update_notification_subscriptions_updated_at
AFTER UPDATE ON notification_subscriptions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE notification_subscriptions SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE TRIGGER update_email_templates_updated_at
AFTER UPDATE ON email_templates
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE email_templates SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE TRIGGER update_email_campaigns_updated_at
AFTER UPDATE ON email_campaigns
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE email_campaigns SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE TABLE passkeys(
  id TEXT PRIMARY KEY NOT NULL DEFAULT(lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id BLOB NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  device_name TEXT,
  aaguid TEXT,
  backup_eligible INTEGER NOT NULL DEFAULT 0,
  backup_state INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  last_used_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE passkey_challenges(
  id TEXT PRIMARY KEY NOT NULL DEFAULT(lower(hex(randomblob(16)))),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  challenge BLOB NOT NULL,
  challenge_type TEXT NOT NULL CHECK(challenge_type IN('registration', 'authentication')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  used_at TEXT
);
CREATE INDEX idx_passkeys_user_id
ON passkeys(user_id)
WHERE is_active = 1;
CREATE INDEX idx_passkey_challenges_expires
ON passkey_challenges(expires_at);
CREATE UNIQUE INDEX uq_bookings_guest_portal_request
ON bookings(
  guest_id,
  portal_request_id
)
WHERE portal_request_id IS NOT NULL;
CREATE TABLE "email_deliveries"(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('campaign', 'birthday_voucher', 'booking_confirmation')),
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  topic TEXT NOT NULL CHECK(topic IN('announcement', 'promotion', 'birthday_voucher', 'booking_confirmation')),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  voucher_id INTEGER REFERENCES vouchers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued', 'sending', 'sent', 'failed', 'suppressed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL DEFAULT(datetime('now')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  provider_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  CONSTRAINT email_deliveries_attempts_valid CHECK(attempts >= 0 AND max_attempts >= 1),
  CONSTRAINT email_deliveries_kind_campaign_link CHECK((kind = 'campaign' AND campaign_id IS NOT NULL)
OR(kind IN('birthday_voucher', 'booking_confirmation') AND campaign_id IS NULL)),
  CONSTRAINT uq_email_deliveries_idempotency UNIQUE(idempotency_key)
);
CREATE INDEX idx_email_deliveries_claim
ON email_deliveries(
  status,
  next_attempt_at
);
CREATE INDEX idx_email_deliveries_campaign
ON email_deliveries(campaign_id);
CREATE INDEX idx_email_deliveries_guest
ON email_deliveries(
  guest_id,
  created_at
);
CREATE TRIGGER update_email_deliveries_updated_at
AFTER UPDATE ON email_deliveries
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE email_deliveries SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE TABLE rate_plans(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  plan_type TEXT DEFAULT 'standard' CHECK(plan_type IN('standard', 'seasonal', 'promotional', 'corporate', 'group', 'package')),
  adjustment_type TEXT DEFAULT 'percentage' CHECK(adjustment_type IN('percentage', 'fixed', 'override')),
  adjustment_value REAL,
  valid_from TEXT,
  valid_to TEXT,
  applies_monday INTEGER DEFAULT 1,
  applies_tuesday INTEGER DEFAULT 1,
  applies_wednesday INTEGER DEFAULT 1,
  applies_thursday INTEGER DEFAULT 1,
  applies_friday INTEGER DEFAULT 1,
  applies_saturday INTEGER DEFAULT 1,
  applies_sunday INTEGER DEFAULT 1,
  min_nights INTEGER DEFAULT 1,
  max_nights INTEGER,
  min_advance_booking INTEGER DEFAULT 0,
  max_advance_booking INTEGER,
  blackout_dates TEXT,
  is_active INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at TEXT DEFAULT(datetime('now')),
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT(datetime('now'))
);
CREATE TABLE room_rates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_plan_id INTEGER NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT DEFAULT(datetime('now')),
  UNIQUE(rate_plan_id, room_type_id, effective_from)
);
CREATE INDEX idx_rate_plans_dates
ON rate_plans(valid_from, valid_to);
CREATE INDEX idx_rate_plans_active
ON rate_plans(
  is_active
)
WHERE is_active = 1;
CREATE INDEX idx_rate_plans_type
ON rate_plans(plan_type);
CREATE INDEX idx_room_rates_plan
ON room_rates(rate_plan_id);
CREATE INDEX idx_room_rates_type
ON room_rates(room_type_id);
CREATE INDEX idx_room_rates_dates
ON room_rates(effective_from, effective_to);
CREATE TRIGGER update_rate_plans_updated_at
AFTER UPDATE ON rate_plans
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE rate_plans SET updated_at = datetime('now') WHERE id = NEW.id;
END;
CREATE TABLE online_inventory_allocations(
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  stay_date TEXT NOT NULL,
  walk_in_reserved_rooms INTEGER NOT NULL DEFAULT 0 CHECK(walk_in_reserved_rooms >= 0),
  online_booking_enabled INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(room_type_id, stay_date)
);
CREATE INDEX idx_online_inventory_allocations_date
ON online_inventory_allocations(
  stay_date,
  room_type_id
);
