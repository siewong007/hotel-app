// ---------------------------------------------------------------------------
// Data Transfer dependency model
// ---------------------------------------------------------------------------
// The export/import payload is a set of tables. Moving a child table without
// the parents it references corrupts referential integrity:
//
//   * On IMPORT, a child row whose foreign-key target is absent is rejected
//     by the database (FK violation) → that row is silently lost.
//   * On EXPORT, a child written without its parent produces a file that
//     references rows that aren't in it → re-importing leaks/breaks refs.
//   * On OVERWRITE, deleting a parent cascades to (or orphans) children that
//     are NOT part of the same operation → unselected data is destroyed.
//
// This module encodes the real foreign keys from the PostgreSQL V1 baseline.
// (verified against the CREATE TABLE / ALTER TABLE constraints) and derives:
//   - forward closure  → auto-select the parents a selection depends on
//   - reverse closure  → drop children when their parent is removed
//   - overwrite risks  → flag cascade-deletes / orphans before they happen
//   - safe presets     → curated, forward-closed selection bundles
// ---------------------------------------------------------------------------

export type CategoryId =
  | 'room_types'
  | 'rooms'
  | 'companies'
  | 'guests'
  | 'bookings'
  | 'booking_guests'
  | 'booking_modifications'
  | 'booking_history'
  | 'payments'
  | 'invoices'
  | 'customer_ledgers'
  | 'customer_ledger_payments'
  | 'night_audit_runs'
  | 'night_audit_details'
  | 'room_changes'
  | 'user_guests'
  | 'guest_complimentary_credits'
  // Extended full-backup tables
  | 'system_settings'
  | 'rate_plans'
  | 'room_rates'
  | 'amenities'
  | 'room_type_amenities'
  | 'services'
  | 'booking_services'
  | 'booking_channels'
  | 'room_status_transitions'
  | 'room_history'
  | 'room_status_change_log'
  | 'email_templates'
  | 'loyalty_programs'
  | 'loyalty_tiers'
  | 'loyalty_memberships'
  | 'loyalty_members'
  | 'loyalty_accounts'
  | 'points_transactions'
  | 'loyalty_transactions'
  | 'reward_catalog'
  | 'loyalty_rewards'
  | 'reward_redemptions'
  | 'loyalty_redemptions'
  | 'loyalty_program_rules'
  | 'corporate_accounts'
  | 'corporate_account_contacts'
  | 'housekeeping_tasks'
  | 'maintenance_tickets'
  | 'guest_documents'
  | 'guest_notes'
  | 'guest_preferences'
  | 'guest_reviews'
  | 'self_checkin_events'
  | 'night_audit_posted_nights';

export type CategoryGroup = 'system' | 'operational';

/** What happens to a child row when its referenced parent is deleted. */
export type DeleteAction = 'cascade' | 'set_null' | 'restrict';

export interface ForeignKey {
  /** The parent table this category references. */
  to: CategoryId;
  /** ON DELETE behaviour declared in the schema. */
  onDelete: DeleteAction;
}

export interface CategoryDef {
  id: CategoryId;
  name: string;
  desc: string;
  group: CategoryGroup;
  /** Outgoing foreign keys (this category → the parents it references). */
  fks: ForeignKey[];
}

// Mirrors the PostgreSQL V1 baseline. `restrict` covers NO ACTION columns that block a
// parent delete until the referencing rows are gone.
export const CATEGORY_DEFS: CategoryDef[] = [
  { id: 'room_types', name: 'Room Types', desc: 'Room type definitions, capacities, and base rates.', group: 'system', fks: [] },
  { id: 'rooms', name: 'Rooms', desc: 'Room inventory, floors, and current statuses.', group: 'system', fks: [{ to: 'room_types', onDelete: 'restrict' }] },
  { id: 'companies', name: 'Companies', desc: 'Corporate accounts and city-ledger billing profiles.', group: 'system', fks: [] },

  { id: 'guests', name: 'Guests', desc: 'Guest profiles, contact details, and KYC records.', group: 'operational', fks: [] },
  {
    id: 'bookings',
    name: 'Bookings',
    desc: 'Reservations, stays, room assignments, and statuses.',
    group: 'operational',
    fks: [
      { to: 'companies', onDelete: 'restrict' },
      { to: 'guests', onDelete: 'cascade' },
      { to: 'rooms', onDelete: 'restrict' },
      { to: 'booking_channels', onDelete: 'restrict' },
    ],
  },
  {
    id: 'booking_guests',
    name: 'Booking Guests',
    desc: 'Guests linked to each reservation.',
    group: 'operational',
    fks: [
      { to: 'bookings', onDelete: 'cascade' },
      { to: 'guests', onDelete: 'set_null' },
    ],
  },
  { id: 'booking_modifications', name: 'Booking Modifications', desc: 'Recorded changes applied to bookings.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'cascade' }] },
  { id: 'booking_history', name: 'Booking History', desc: 'Status transitions and lifecycle audit trail.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'cascade' }] },
  { id: 'payments', name: 'Payments', desc: 'Transactions, deposits, refunds, and settlements.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'cascade' }] },
  {
    id: 'invoices',
    name: 'Invoices',
    desc: 'Generated folios and invoice numbers.',
    group: 'operational',
    fks: [
      { to: 'bookings', onDelete: 'cascade' },
      { to: 'guests', onDelete: 'set_null' },
    ],
  },
  { id: 'customer_ledgers', name: 'Customer Ledgers', desc: 'City-ledger charges, credits, and balances.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'set_null' }] },
  { id: 'customer_ledger_payments', name: 'Ledger Payments', desc: 'Payment history posted against ledgers.', group: 'operational', fks: [{ to: 'customer_ledgers', onDelete: 'cascade' }] },
  { id: 'night_audit_runs', name: 'Night Audit Runs', desc: 'Completed night-audit batches.', group: 'operational', fks: [] },
  { id: 'night_audit_details', name: 'Night Audit Details', desc: 'Per-room postings for each audit run.', group: 'operational', fks: [{ to: 'night_audit_runs', onDelete: 'cascade' }] },
  {
    id: 'room_changes',
    name: 'Room Changes',
    desc: 'Room move history during stays.',
    group: 'operational',
    fks: [
      { to: 'bookings', onDelete: 'cascade' },
      { to: 'guests', onDelete: 'set_null' },
      { to: 'rooms', onDelete: 'restrict' },
    ],
  },
  { id: 'user_guests', name: 'User-Guest Links', desc: 'Links between portal users and guest profiles.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }] },
  {
    id: 'guest_complimentary_credits',
    name: 'Guest Credits',
    desc: 'Complimentary-night credits per guest.',
    group: 'operational',
    fks: [
      { to: 'guests', onDelete: 'cascade' },
      { to: 'room_types', onDelete: 'cascade' },
    ],
  },

  // ----- Extended full-backup tables -----

  // System configuration
  { id: 'system_settings', name: 'Hotel Settings', desc: 'Property profile, currency, timezone, and check-in/out times.', group: 'system', fks: [] },
  { id: 'booking_channels', name: 'Booking Channels', desc: 'OTA channels, direct, and walk-in source mapping.', group: 'system', fks: [] },
  { id: 'rate_plans', name: 'Rate Plans', desc: 'Pricing plans, seasonal rates, and rate rules.', group: 'system', fks: [] },
  { id: 'room_rates', name: 'Room Rates', desc: 'Per room-type rates under each rate plan.', group: 'system', fks: [{ to: 'rate_plans', onDelete: 'cascade' }, { to: 'room_types', onDelete: 'cascade' }] },
  { id: 'amenities', name: 'Amenities', desc: 'Amenity catalog available to room types.', group: 'system', fks: [] },
  { id: 'room_type_amenities', name: 'Room Type Amenities', desc: 'Which amenities each room type offers.', group: 'system', fks: [{ to: 'amenities', onDelete: 'cascade' }, { to: 'room_types', onDelete: 'cascade' }] },
  { id: 'services', name: 'Services', desc: 'Add-on services that can be billed to bookings.', group: 'system', fks: [] },
  { id: 'room_status_transitions', name: 'Room Status Transitions', desc: 'Allowed room-status state machine and permissions.', group: 'system', fks: [] },
  { id: 'email_templates', name: 'Email Templates', desc: 'Transactional email/notification templates.', group: 'system', fks: [] },
  { id: 'loyalty_programs', name: 'Loyalty Programs', desc: 'Loyalty program definitions.', group: 'system', fks: [] },
  { id: 'loyalty_program_rules', name: 'Loyalty Rules', desc: 'Point earning, expiry, and redemption policy.', group: 'system', fks: [] },
  { id: 'loyalty_tiers', name: 'Loyalty Tiers', desc: 'Tier thresholds and benefits per program.', group: 'system', fks: [{ to: 'loyalty_programs', onDelete: 'cascade' }] },
  { id: 'reward_catalog', name: 'Reward Catalog', desc: 'Redeemable rewards per loyalty program.', group: 'system', fks: [{ to: 'loyalty_programs', onDelete: 'cascade' }] },
  { id: 'loyalty_rewards', name: 'Loyalty Rewards', desc: 'Portal reward catalog and tier requirements.', group: 'system', fks: [{ to: 'loyalty_tiers', onDelete: 'restrict' }] },
  { id: 'corporate_accounts', name: 'Corporate Accounts', desc: 'Corporate account master records.', group: 'system', fks: [] },
  { id: 'corporate_account_contacts', name: 'Corporate Contacts', desc: 'Contacts attached to corporate accounts.', group: 'system', fks: [{ to: 'corporate_accounts', onDelete: 'cascade' }] },

  // Operational
  { id: 'booking_services', name: 'Booking Services', desc: 'Add-on services posted to bookings.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'cascade' }, { to: 'services', onDelete: 'restrict' }] },
  { id: 'room_history', name: 'Room History', desc: 'Historical room status/occupancy records.', group: 'operational', fks: [{ to: 'rooms', onDelete: 'cascade' }] },
  { id: 'room_status_change_log', name: 'Room Status Log', desc: 'Audit log of room status changes.', group: 'operational', fks: [{ to: 'rooms', onDelete: 'restrict' }] },
  { id: 'loyalty_memberships', name: 'Loyalty Memberships', desc: 'Guest enrollments in loyalty programs.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }, { to: 'loyalty_programs', onDelete: 'cascade' }, { to: 'loyalty_tiers', onDelete: 'restrict' }] },
  { id: 'loyalty_members', name: 'Loyalty Members', desc: 'Portal loyalty member records linked to guests.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }] },
  { id: 'loyalty_accounts', name: 'Loyalty Accounts', desc: 'Portal loyalty balances, qualification metrics, and current tiers.', group: 'operational', fks: [{ to: 'loyalty_members', onDelete: 'cascade' }, { to: 'loyalty_tiers', onDelete: 'restrict' }] },
  { id: 'points_transactions', name: 'Points Transactions', desc: 'Loyalty point earn/redeem ledger.', group: 'operational', fks: [{ to: 'loyalty_memberships', onDelete: 'cascade' }] },
  {
    id: 'loyalty_transactions',
    name: 'Loyalty Transactions',
    desc: 'Portal loyalty transaction ledger.',
    group: 'operational',
    fks: [
      { to: 'loyalty_members', onDelete: 'cascade' },
      { to: 'loyalty_accounts', onDelete: 'cascade' },
      { to: 'bookings', onDelete: 'set_null' },
      { to: 'payments', onDelete: 'set_null' },
      { to: 'invoices', onDelete: 'set_null' },
    ],
  },
  { id: 'reward_redemptions', name: 'Reward Redemptions', desc: 'Rewards redeemed by members.', group: 'operational', fks: [{ to: 'loyalty_memberships', onDelete: 'cascade' }, { to: 'reward_catalog', onDelete: 'restrict' }, { to: 'bookings', onDelete: 'set_null' }] },
  { id: 'loyalty_redemptions', name: 'Loyalty Redemptions', desc: 'Portal reward redemption requests and reviews.', group: 'operational', fks: [{ to: 'loyalty_members', onDelete: 'cascade' }, { to: 'loyalty_rewards', onDelete: 'restrict' }, { to: 'loyalty_transactions', onDelete: 'restrict' }] },
  { id: 'housekeeping_tasks', name: 'Housekeeping Tasks', desc: 'Cleaning and turndown task records.', group: 'operational', fks: [{ to: 'rooms', onDelete: 'cascade' }] },
  { id: 'maintenance_tickets', name: 'Maintenance Tickets', desc: 'Room maintenance and repair tickets.', group: 'operational', fks: [{ to: 'rooms', onDelete: 'set_null' }] },
  { id: 'guest_documents', name: 'Guest Documents', desc: 'Uploaded guest identity documents.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }] },
  { id: 'guest_notes', name: 'Guest Notes', desc: 'Internal notes attached to guests.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }] },
  { id: 'guest_preferences', name: 'Guest Preferences', desc: 'Stored guest stay preferences.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }] },
  { id: 'guest_reviews', name: 'Guest Reviews', desc: 'Guest reviews and ratings.', group: 'operational', fks: [{ to: 'guests', onDelete: 'cascade' }, { to: 'bookings', onDelete: 'set_null' }] },
  { id: 'self_checkin_events', name: 'Self Check-in Events', desc: 'Self/kiosk check-in event log.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'cascade' }] },
  { id: 'night_audit_posted_nights', name: 'Posted Nights', desc: 'Per-night postings produced by night audit.', group: 'operational', fks: [{ to: 'bookings', onDelete: 'cascade' }, { to: 'night_audit_runs', onDelete: 'set_null' }] },
];

export const ALL_CATEGORY_IDS: CategoryId[] = CATEGORY_DEFS.map((c) => c.id);
export const CATEGORY_BY_ID: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORY_DEFS.map((c) => [c.id, c])
) as Record<CategoryId, CategoryDef>;

export const nameOf = (id: CategoryId): string => CATEGORY_BY_ID[id]?.name ?? id;

export type Selection = Record<string, boolean>;

const isId = (id: string): id is CategoryId => id in CATEGORY_BY_ID;

/** Direct parents this category references. */
export const directDependencies = (id: CategoryId): CategoryId[] =>
  CATEGORY_BY_ID[id].fks.map((f) => f.to);

/** Direct children that reference this category. */
export const directDependents = (id: CategoryId): CategoryId[] =>
  CATEGORY_DEFS.filter((c) => c.fks.some((f) => f.to === id)).map((c) => c.id);

const closure = (seeds: CategoryId[], next: (id: CategoryId) => CategoryId[]): Set<CategoryId> => {
  const out = new Set<CategoryId>();
  const stack = [...seeds];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of next(cur)) {
      if (!out.has(n)) {
        out.add(n);
        stack.push(n);
      }
    }
  }
  return out;
};

/** All transitive parents of the given categories (excludes the seeds). */
export const collectDependencies = (ids: CategoryId[]): CategoryId[] => {
  const deps = closure(ids, directDependencies);
  ids.forEach((id) => deps.delete(id));
  return ALL_CATEGORY_IDS.filter((id) => deps.has(id));
};

/** All transitive children of the given categories (excludes the seeds). */
export const collectDependents = (ids: CategoryId[]): CategoryId[] => {
  const deps = closure(ids, directDependents);
  ids.forEach((id) => deps.delete(id));
  return ALL_CATEGORY_IDS.filter((id) => deps.has(id));
};

export const selectedIdsOf = (selection: Selection): CategoryId[] =>
  ALL_CATEGORY_IDS.filter((id) => selection[id]);

export interface SelectionChange {
  selection: Selection;
  /** Categories whose state flipped as a side effect of the toggle. */
  affected: CategoryId[];
}

/**
 * Turn a category ON, pulling in every parent it (transitively) depends on so
 * the resulting selection is referentially complete.
 */
export const selectWithDependencies = (selection: Selection, id: CategoryId): SelectionChange => {
  const toAdd = [id, ...collectDependencies([id])].filter((c) => !selection[c]);
  const nextSelection: Selection = { ...selection };
  toAdd.forEach((c) => (nextSelection[c] = true));
  // the toggled category itself isn't an "auto" side effect
  return { selection: nextSelection, affected: toAdd.filter((c) => c !== id) };
};

/**
 * Turn a category OFF, removing every child that (transitively) depends on it,
 * since those rows would otherwise reference a parent no longer in the set.
 */
export const deselectWithDependents = (selection: Selection, id: CategoryId): SelectionChange => {
  const toRemove = [id, ...collectDependents([id])].filter((c) => selection[c]);
  const nextSelection: Selection = { ...selection };
  toRemove.forEach((c) => (nextSelection[c] = false));
  return { selection: nextSelection, affected: toRemove.filter((c) => c !== id) };
};

/** Convenience toggle that applies the safe forward/reverse closure. */
export const toggleCategory = (selection: Selection, id: CategoryId): SelectionChange =>
  selection[id] ? deselectWithDependents(selection, id) : selectWithDependencies(selection, id);

export interface MissingDependency {
  id: CategoryId;
  missing: CategoryId[];
}

/**
 * Forward-integrity check: selected categories whose parents are NOT selected.
 * An empty result means the selection is self-contained (safe to export/import).
 */
export const getMissingDependencies = (selectedIds: CategoryId[]): MissingDependency[] => {
  const set = new Set(selectedIds);
  const out: MissingDependency[] = [];
  for (const id of selectedIds) {
    const missing = directDependencies(id).filter((dep) => !set.has(dep));
    if (missing.length) out.push({ id, missing });
  }
  return out;
};

export interface OverwriteRisk {
  /** The selected parent being overwritten. */
  id: CategoryId;
  /** Unselected children that a delete would CASCADE-remove (data loss). */
  cascade: CategoryId[];
  /** Unselected children whose reference would be nulled (orphaned/leakage). */
  orphan: CategoryId[];
  /** Unselected children that would block the overwrite until selected too. */
  blocked: CategoryId[];
}

/**
 * Overwrite-mode risk scan. Overwriting a parent deletes its existing rows;
 * unselected children that depend on it are cascade-deleted or orphaned.
 */
export const getOverwriteRisks = (selectedIds: CategoryId[]): OverwriteRisk[] => {
  const set = new Set(selectedIds);
  const out: OverwriteRisk[] = [];
  for (const id of selectedIds) {
    const cascade: CategoryId[] = [];
    const orphan: CategoryId[] = [];
    const blocked: CategoryId[] = [];
    for (const child of CATEGORY_DEFS) {
      if (set.has(child.id)) continue;
      for (const fk of child.fks) {
        if (fk.to !== id) continue;
        if (fk.onDelete === 'cascade') cascade.push(child.id);
        else if (fk.onDelete === 'set_null') orphan.push(child.id);
        else blocked.push(child.id);
      }
    }
    if (cascade.length || orphan.length || blocked.length) out.push({ id, cascade, orphan, blocked });
  }
  return out;
};

export interface Preset {
  id: string;
  label: string;
  description: string;
  /** Author-supplied seeds; the exported `categories` is the forward closure. */
  seeds: CategoryId[];
  /** Forward-closed, referentially-complete category set. */
  categories: CategoryId[];
}

const preset = (id: string, label: string, description: string, seeds: CategoryId[]): Preset => ({
  id,
  label,
  description,
  seeds,
  categories: ALL_CATEGORY_IDS.filter((c) => seeds.includes(c) || collectDependencies(seeds).includes(c)),
});

/**
 * Curated bundles. Each is defined by intent (seeds) and closed automatically,
 * so every preset is guaranteed referentially complete (no data loss on import).
 */
export const SAFE_PRESETS: Preset[] = [
  preset('full', 'Full backup', 'Everything — a complete, restorable snapshot.', [...ALL_CATEGORY_IDS]),
  preset('config', 'Property setup', 'All configuration: settings, rooms, rates, amenities, services, channels, loyalty & corporate setup.', [
    'system_settings',
    'room_types',
    'rooms',
    'companies',
    'rate_plans',
    'room_rates',
    'amenities',
    'room_type_amenities',
    'services',
    'booking_channels',
    'room_status_transitions',
    'email_templates',
    'loyalty_programs',
    'loyalty_program_rules',
    'loyalty_tiers',
    'loyalty_rewards',
    'reward_catalog',
    'corporate_accounts',
    'corporate_account_contacts',
  ]),
  preset('guests', 'Guest book', 'Guest profiles plus their notes, documents, preferences, reviews, and credits.', [
    'guests',
    'user_guests',
    'guest_complimentary_credits',
    'guest_documents',
    'guest_notes',
    'guest_preferences',
    'guest_reviews',
  ]),
  preset('reservations', 'Reservations', 'Bookings and their related records, plus required config.', [
    'bookings',
    'booking_guests',
    'booking_modifications',
    'booking_history',
    'booking_services',
    'room_changes',
    'self_checkin_events',
  ]),
  preset('financials', 'Financials', 'Payments, invoices, and ledgers with their booking context.', [
    'payments',
    'invoices',
    'customer_ledgers',
    'customer_ledger_payments',
  ]),
  preset('loyalty', 'Loyalty & rewards', 'Programs, tiers, memberships, points, and reward redemptions.', [
    'loyalty_programs',
    'loyalty_tiers',
    'loyalty_memberships',
    'loyalty_members',
    'loyalty_accounts',
    'points_transactions',
    'loyalty_transactions',
    'reward_catalog',
    'loyalty_rewards',
    'reward_redemptions',
    'loyalty_redemptions',
    'loyalty_program_rules',
  ]),
  preset('housekeeping', 'Housekeeping & maintenance', 'Cleaning tasks and maintenance tickets with their rooms.', [
    'housekeeping_tasks',
    'maintenance_tickets',
  ]),
  preset('night_audit', 'Night audit', 'Night-audit runs, detail postings, and posted nights.', [
    'night_audit_runs',
    'night_audit_details',
    'night_audit_posted_nights',
  ]),
];

export const buildSelection = (ids: CategoryId[]): Selection => {
  const sel: Selection = {};
  ALL_CATEGORY_IDS.forEach((id) => (sel[id] = false));
  ids.forEach((id) => {
    if (isId(id)) sel[id] = true;
  });
  return sel;
};
