import { describe, expect, it } from 'vitest';
import {
  ALL_CATEGORY_IDS,
  CATEGORY_DEFS,
  buildSelection,
  collectDependencies,
  collectDependents,
  deselectWithDependents,
  directDependencies,
  directDependents,
  getMissingDependencies,
  getOverwriteRisks,
  SAFE_PRESETS,
  selectWithDependencies,
  selectedIdsOf,
  toggleCategory,
  type CategoryId,
} from './dataTransferDependencies';

describe('foreign-key graph integrity', () => {
  it('every FK target is a known category and no category references itself', () => {
    const known = new Set<CategoryId>(ALL_CATEGORY_IDS);
    for (const def of CATEGORY_DEFS) {
      for (const fk of def.fks) {
        expect(known.has(fk.to)).toBe(true);
        expect(fk.to).not.toBe(def.id);
      }
    }
  });

  it('contains no dependency cycles (the graph is a DAG)', () => {
    // collectDependencies relies on termination; a cycle would mean a node is
    // its own transitive dependency.
    for (const id of ALL_CATEGORY_IDS) {
      expect(collectDependencies([id])).not.toContain(id);
    }
  });

  it('exposes the schema relationships that drive data loss', () => {
    expect(directDependencies('bookings').sort()).toEqual(['booking_channels', 'companies', 'guests', 'rooms']);
    expect(directDependencies('rooms')).toEqual(['room_types']);
    expect(directDependencies('customer_ledger_payments')).toEqual(['customer_ledgers']);
    expect(directDependencies('guests')).toEqual([]);
    expect(directDependents('guests')).toContain('bookings');
    expect(directDependents('bookings')).toContain('payments');
  });
});

describe('forward closure (auto-select related data)', () => {
  it('pulls in the full ancestor chain for a deep child', () => {
    // ledger payments → ledgers → bookings → {companies, guests, rooms} → room_types
    expect(collectDependencies(['customer_ledger_payments']).sort()).toEqual(
      ['booking_channels', 'bookings', 'companies', 'customer_ledgers', 'guests', 'room_types', 'rooms'].sort()
    );
  });

  it('selecting a category auto-selects every table it depends on', () => {
    const empty = buildSelection([]);
    const { selection, affected } = selectWithDependencies(empty, 'bookings');
    expect(selectedIdsOf(selection).sort()).toEqual(['booking_channels', 'bookings', 'companies', 'guests', 'room_types', 'rooms'].sort());
    // the toggled category is not reported as an auto side effect
    expect(affected).not.toContain('bookings');
    expect(affected.sort()).toEqual(['booking_channels', 'companies', 'guests', 'room_types', 'rooms'].sort());
  });

  it('does not re-add already-selected dependencies to the affected list', () => {
    const withGuests = buildSelection(['guests', 'room_types']);
    const { affected } = selectWithDependencies(withGuests, 'bookings');
    expect(affected).not.toContain('guests');
    expect(affected).not.toContain('room_types');
    expect(affected.sort()).toEqual(['booking_channels', 'companies', 'rooms']);
  });

  it('a category with no dependencies selects only itself', () => {
    const { selection, affected } = selectWithDependencies(buildSelection([]), 'guests');
    expect(selectedIdsOf(selection)).toEqual(['guests']);
    expect(affected).toEqual([]);
  });
});

describe('reverse closure (removing a parent removes dependents)', () => {
  it('deselecting a parent removes every child that transitively depends on it', () => {
    const full = buildSelection([...ALL_CATEGORY_IDS]);
    const { selection, affected } = deselectWithDependents(full, 'guests');
    const remaining = selectedIdsOf(selection);
    expect(remaining).not.toContain('guests');
    expect(remaining).not.toContain('bookings'); // bookings → guests
    expect(remaining).not.toContain('payments'); // payments → bookings → guests
    expect(remaining).not.toContain('user_guests');
    expect(affected).toContain('bookings');
    expect(affected).toContain('payments');
    // unrelated config survives
    expect(remaining).toContain('room_types');
    expect(remaining).toContain('companies');
  });

  it('deselecting a leaf only removes the leaf', () => {
    const full = buildSelection([...ALL_CATEGORY_IDS]);
    const { selection, affected } = deselectWithDependents(full, 'payments');
    expect(selection.payments).toBe(false);
    expect(affected).toEqual([]);
    expect(selection.bookings).toBe(true);
  });
});

describe('toggleCategory applies the correct closure for each direction', () => {
  it('toggling on adds dependencies; toggling the same category off removes dependents', () => {
    const start = buildSelection([]);
    const on = toggleCategory(start, 'bookings');
    expect(selectedIdsOf(on.selection).sort()).toEqual(['booking_channels', 'bookings', 'companies', 'guests', 'room_types', 'rooms'].sort());

    const off = toggleCategory(on.selection, 'guests');
    // turning guests back off must also drop bookings (which needs guests)
    expect(off.selection.guests).toBe(false);
    expect(off.selection.bookings).toBe(false);
  });
});

describe('getMissingDependencies (forward integrity)', () => {
  it('flags a child selected without its parent', () => {
    const result = getMissingDependencies(['bookings']);
    expect(result).toEqual([{ id: 'bookings', missing: ['companies', 'guests', 'rooms', 'booking_channels'] }]);
  });

  it('returns nothing for a self-contained selection', () => {
    const ids = selectedIdsOf(selectWithDependencies(buildSelection([]), 'bookings').selection);
    expect(getMissingDependencies(ids)).toEqual([]);
  });
});

describe('getOverwriteRisks (data leakage on overwrite)', () => {
  it('flags cascade deletes and orphaned references for unselected children', () => {
    // overwrite only `bookings` → many children would be cascade-deleted / orphaned
    const risks = getOverwriteRisks(['bookings']);
    const bookingRisk = risks.find((r) => r.id === 'bookings');
    expect(bookingRisk).toBeDefined();
    expect(bookingRisk!.cascade).toEqual(
      expect.arrayContaining(['payments', 'invoices', 'booking_guests', 'booking_history', 'booking_modifications', 'room_changes'])
    );
    expect(bookingRisk!.orphan).toContain('customer_ledgers'); // booking_id ON DELETE SET NULL
  });

  it('reports no risk when every dependent child is also selected', () => {
    const risks = getOverwriteRisks([...ALL_CATEGORY_IDS]);
    expect(risks).toEqual([]);
  });

  it('classifies set-null children as orphans, not cascade deletes', () => {
    // guests is referenced by invoices (SET NULL) and bookings (CASCADE) etc.
    const risk = getOverwriteRisks(['guests']).find((r) => r.id === 'guests')!;
    expect(risk.cascade).toContain('bookings'); // bookings.guest_id CASCADE
    expect(risk.orphan).toContain('invoices'); // invoices.guest_id SET NULL
    expect(risk.cascade).not.toContain('invoices');
  });
});

describe('safe presets', () => {
  it('every preset is forward-closed (no missing dependencies → no data loss)', () => {
    for (const p of SAFE_PRESETS) {
      expect(getMissingDependencies(p.categories), `preset "${p.id}" must be self-contained`).toEqual([]);
    }
  });

  it('preset categories always include their declared seeds', () => {
    for (const p of SAFE_PRESETS) {
      for (const seed of p.seeds) {
        expect(p.categories).toContain(seed);
      }
    }
  });

  it('the full preset covers every category', () => {
    const full = SAFE_PRESETS.find((p) => p.id === 'full')!;
    expect(full.categories.sort()).toEqual([...ALL_CATEGORY_IDS].sort());
  });

  it('the financials preset closes over the booking chain', () => {
    const fin = SAFE_PRESETS.find((p) => p.id === 'financials')!;
    expect(fin.categories).toEqual(
      expect.arrayContaining(['payments', 'invoices', 'customer_ledgers', 'customer_ledger_payments', 'bookings', 'guests', 'rooms', 'room_types', 'companies'])
    );
  });
});

describe('extended full-backup tables', () => {
  it('includes the complete table set', () => {
    expect(ALL_CATEGORY_IDS).toHaveLength(45);
    expect(ALL_CATEGORY_IDS).toEqual(expect.arrayContaining(['system_settings', 'rate_plans', 'loyalty_memberships', 'housekeeping_tasks']));
  });

  it('closes a deep loyalty/reward chain over its full ancestry', () => {
    // reward_redemptions → memberships → {guests, programs, tiers}; → reward_catalog → programs;
    // → bookings → {companies, guests, rooms→room_types, booking_channels}
    const deps = collectDependencies(['reward_redemptions']);
    expect(deps).toEqual(
      expect.arrayContaining([
        'loyalty_memberships',
        'loyalty_programs',
        'loyalty_tiers',
        'reward_catalog',
        'bookings',
        'guests',
        'rooms',
        'room_types',
        'companies',
        'booking_channels',
      ])
    );
  });

  it('keeps composite-keyed config tables in the graph', () => {
    expect(directDependencies('room_type_amenities').sort()).toEqual(['amenities', 'room_types']);
    expect(ALL_CATEGORY_IDS).toContain('room_status_transitions');
  });
});

describe('collectDependents', () => {
  it('lists the full descendant chain of a config table', () => {
    expect(collectDependents(['room_types'])).toContain('rooms');
    expect(collectDependents(['room_types'])).toContain('bookings'); // via rooms
    expect(collectDependents(['room_types'])).not.toContain('room_types');
  });
});
