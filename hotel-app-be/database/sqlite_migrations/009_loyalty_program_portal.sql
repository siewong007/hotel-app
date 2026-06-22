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

INSERT INTO loyalty_tiers (code, name, sort_order, min_points, min_nights, min_spend, benefits)
VALUES
    ('silver', 'Silver', 1, 0, 0, 0, '["Member rates","Points on eligible stays"]'),
    ('gold', 'Gold', 2, 5000, 10, 2500, '["Priority support","Late checkout when available","Bonus earning"]'),
    ('platinum', 'Platinum', 3, 15000, 30, 7500, '["Room upgrade priority","Welcome amenity","Highest earning rate"]')
ON CONFLICT(code) DO UPDATE SET
    name = excluded.name,
    sort_order = excluded.sort_order,
    min_points = excluded.min_points,
    min_nights = excluded.min_nights,
    min_spend = excluded.min_spend,
    benefits = excluded.benefits,
    is_active = 1,
    updated_at = datetime('now');

INSERT INTO loyalty_program_rules (id, points_per_currency_unit, tier_qualification_metric, point_expiry_months, redemption_approval_required, earning_enabled, min_eligible_amount)
VALUES (1, 1, 'points', 24, 1, 1, 0)
ON CONFLICT(id) DO NOTHING;

INSERT INTO loyalty_rewards (name, description, category, points_cost, minimum_tier_id, requires_approval, is_active, terms_conditions)
SELECT 'Late checkout', 'Request a late checkout on an eligible stay.', 'service', 750, id, 1, 1, 'Subject to availability.'
FROM loyalty_tiers WHERE code = 'silver'
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_rewards (name, description, category, points_cost, minimum_tier_id, requires_approval, is_active, terms_conditions)
SELECT 'Room upgrade request', 'Request a one-category room upgrade when available.', 'room_upgrade', 2000, id, 1, 1, 'Subject to availability and room type.'
FROM loyalty_tiers WHERE code = 'gold'
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_rewards (name, description, category, points_cost, minimum_tier_id, requires_approval, is_active, terms_conditions)
SELECT 'Dining credit', 'Apply a dining credit during a future stay.', 'dining', 1500, id, 0, 1, 'Valid for one eligible stay.'
FROM loyalty_tiers WHERE code = 'silver'
ON CONFLICT DO NOTHING;

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('navigation_loyalty:read', 'navigation:loyalty', 'read', 'Show Loyalty navigation', 1),
    ('navigation_my_rewards:read', 'navigation:my-rewards', 'read', 'Show My Rewards navigation', 1)
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
  AND p.name IN ('navigation_loyalty:read', 'loyalty:read', 'loyalty:manage');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'guest'
  AND p.name IN ('navigation_my_rewards:read', 'rewards:read');

UPDATE route_access_policies
SET nav_label = 'Loyalty',
    nav_group = 'admin',
    nav_permissions = '["navigation_loyalty:read","loyalty:read","loyalty:manage"]',
    is_navigation = 1,
    updated_at = datetime('now')
WHERE route_id = 'loyalty';

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation
)
VALUES (
    'my-rewards', '/my-rewards', 'My Rewards', 'main', '["rewards:read"]', '[]',
    '["super_admin","admin","manager","receptionist","staff"]',
    '["navigation_my_rewards:read","rewards:read"]', '[]',
    '["super_admin","admin","manager","receptionist","staff"]', 1
)
ON CONFLICT(route_id) DO UPDATE SET
    nav_label = excluded.nav_label,
    nav_group = excluded.nav_group,
    required_permissions = excluded.required_permissions,
    excluded_roles = excluded.excluded_roles,
    nav_permissions = excluded.nav_permissions,
    nav_excluded_roles = excluded.nav_excluded_roles,
    is_navigation = excluded.is_navigation,
    updated_at = datetime('now');
