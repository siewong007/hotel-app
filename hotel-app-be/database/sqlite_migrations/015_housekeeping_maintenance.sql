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

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('housekeeping:read', 'housekeeping', 'read', 'View housekeeping tasks and board', 1),
('housekeeping:create', 'housekeeping', 'create', 'Create housekeeping tasks', 1),
('housekeeping:update', 'housekeeping', 'update', 'Update housekeeping task status and assignments', 1),
('housekeeping:manage', 'housekeeping', 'manage', 'Full housekeeping management', 1),
('maintenance:read', 'maintenance', 'read', 'View maintenance tickets', 1),
('maintenance:write', 'maintenance', 'write', 'Create and update maintenance tickets', 1),
('maintenance:manage', 'maintenance', 'manage', 'Full maintenance management', 1),
('navigation_housekeeping:read', 'navigation:housekeeping', 'read', 'Show Housekeeping navigation', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'manager')
  AND p.name IN (
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write', 'maintenance:manage',
    'navigation_housekeeping:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
  AND p.name IN (
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update',
    'navigation_housekeeping:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'housekeeping'
  AND p.name IN (
    'rooms:read', 'rooms:update',
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write',
    'navigation_housekeeping:read', 'navigation_room_management:read'
  );

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation
)
VALUES (
    'housekeeping', '/housekeeping', 'Housekeeping', 'operations',
    '["housekeeping:read"]', '[]', '[]',
    '["navigation_housekeeping:read","housekeeping:read"]', '[]', '["guest"]', 1
)
ON CONFLICT(route_id) DO UPDATE SET
    path = excluded.path,
    nav_label = excluded.nav_label,
    nav_group = excluded.nav_group,
    required_permissions = excluded.required_permissions,
    nav_permissions = excluded.nav_permissions,
    nav_excluded_roles = excluded.nav_excluded_roles,
    is_navigation = excluded.is_navigation,
    updated_at = datetime('now');
