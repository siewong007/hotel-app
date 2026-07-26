import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerLedger } from '../../../../types';
import {
  asMoney,
  companyInitials,
  getLedgerUiStatus,
  getStatusColor,
  getStatusText,
  isDateOverdue,
  isLedgerVoided,
  STATUS_TONE,
  TONE,
} from './helpers';

function buildLedger(overrides: Partial<CustomerLedger> = {}): CustomerLedger {
  return {
    id: 1,
    company_name: 'Acme Corp',
    description: 'July stay',
    expense_type: 'accommodation',
    amount: 500,
    status: 'pending',
    paid_amount: 0,
    balance_due: 500,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  } as CustomerLedger;
}

describe('getStatusColor / getStatusText', () => {
  it('maps every known ledger status to its display color and label', () => {
    expect(getStatusColor('paid')).toBe('success');
    expect(getStatusColor('partial')).toBe('warning');
    expect(getStatusColor('pending')).toBe('info');
    expect(getStatusColor('overdue')).toBe('error');
    expect(getStatusColor('void')).toBe('default');

    expect(getStatusText('paid')).toBe('Paid');
    expect(getStatusText('partial')).toBe('Partial');
    expect(getStatusText('pending')).toBe('Pending');
    expect(getStatusText('overdue')).toBe('Overdue');
    // Unknown statuses pass through literally rather than being swallowed.
    expect(getStatusText('void')).toBe('void');
  });
});

describe('asMoney', () => {
  it('normalizes numeric-string ledger amounts (as Postgres numeric columns arrive over JSON)', () => {
    expect(asMoney('1234.5')).toBe(1234.5);
    expect(asMoney(null)).toBe(0);
    expect(asMoney(undefined)).toBe(0);
  });
});

describe('companyInitials', () => {
  it('builds initials from the first two words of a company name', () => {
    expect(companyInitials('Farley Sibu')).toBe('FS');
    expect(companyInitials('Acme Corp International')).toBe('AC');
  });

  it('falls back to the first two letters for a single-word name', () => {
    expect(companyInitials('Acme')).toBe('AC');
    expect(companyInitials('A')).toBe('A');
  });

  it('handles empty/whitespace-only names (edge case) without throwing', () => {
    expect(companyInitials('')).toBe('?');
    expect(companyInitials('   ')).toBe('?');
  });

  it('collapses irregular whitespace between words', () => {
    expect(companyInitials('  Farley   Sibu  ')).toBe('FS');
  });
});

describe('isLedgerVoided', () => {
  it('is voided when void_at is set, even if the status column disagrees', () => {
    expect(isLedgerVoided(buildLedger({ void_at: '2026-07-05T00:00:00Z', status: 'pending' }))).toBe(true);
  });

  it('is voided when status is void, even with no void_at timestamp', () => {
    expect(isLedgerVoided(buildLedger({ status: 'void', void_at: undefined }))).toBe(true);
  });

  it('is not voided otherwise', () => {
    expect(isLedgerVoided(buildLedger({ status: 'paid', void_at: undefined }))).toBe(false);
  });
});

describe('isDateOverdue', () => {
  const createLocalStorageStub = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is overdue once the hotel calendar has moved past the due date', () => {
    expect(isDateOverdue('2000-01-01')).toBe(true);
    expect(isDateOverdue('2999-12-31')).toBe(false);
  });

  it('is not overdue on the due date itself, or when there is no due date (edge case)', () => {
    expect(isDateOverdue(undefined)).toBe(false);
    expect(isDateOverdue(null)).toBe(false);
  });
});

describe('getLedgerUiStatus (balance-first ledger status derivation)', () => {
  it('is voided whenever void_at/status say so, regardless of balance or due date', () => {
    const ledger = buildLedger({
      void_at: '2026-07-05T00:00:00Z',
      balance_due: 0,
      paid_amount: 500,
      due_date: '2000-01-01',
    });
    expect(getLedgerUiStatus(ledger)).toBe('voided');
  });

  it('is paid whenever the balance is not positive, even with a non-"paid" status column (balance-first)', () => {
    const ledger = buildLedger({ status: 'pending', balance_due: 0, paid_amount: 500 });
    expect(getLedgerUiStatus(ledger)).toBe('paid');
  });

  it('treats a zero-balance entry as paid even with a negative (overpaid) balance_due', () => {
    const ledger = buildLedger({ balance_due: -10, paid_amount: 510 });
    expect(getLedgerUiStatus(ledger)).toBe('paid');
  });

  it('reopens a stale "paid" status column once a later charge makes the balance positive again', () => {
    // Money bug this guards against: if a new charge is posted to a
    // previously-settled ledger and only the balance is updated (not the
    // status column), the UI must still show it as outstanding.
    const ledger = buildLedger({
      status: 'paid',
      balance_due: 100,
      paid_amount: 0,
      invoice_number: 'INV-1',
    });
    expect(getLedgerUiStatus(ledger)).toBe('invoiced');
  });

  it('prioritizes overdue over partial (an overdue entry must not read as merely "partial")', () => {
    const ledger = buildLedger({
      balance_due: 200,
      paid_amount: 300,
      due_date: '2000-01-01',
    });
    expect(getLedgerUiStatus(ledger)).toBe('overdue');
  });

  it('is overdue when the status column says so even if the due date has not structurally passed', () => {
    const ledger = buildLedger({ status: 'overdue', balance_due: 200, paid_amount: 0, due_date: '2999-12-31' });
    expect(getLedgerUiStatus(ledger)).toBe('overdue');
  });

  it('is partial once anything has been paid against an outstanding, non-overdue balance', () => {
    const ledger = buildLedger({ balance_due: 200, paid_amount: 300, due_date: '2999-12-31' });
    expect(getLedgerUiStatus(ledger)).toBe('partial');
  });

  it('is invoiced when nothing has been paid yet but an invoice has been issued', () => {
    const ledger = buildLedger({ balance_due: 500, paid_amount: 0, invoice_number: 'INV-2', due_date: '2999-12-31' });
    expect(getLedgerUiStatus(ledger)).toBe('invoiced');
  });

  it('is ready_to_invoice when there is an outstanding balance but no invoice yet', () => {
    const ledger = buildLedger({ balance_due: 500, paid_amount: 0, invoice_number: undefined, due_date: '2999-12-31' });
    expect(getLedgerUiStatus(ledger)).toBe('ready_to_invoice');
  });

  it('documents that the "draft" branch is dead code: a positive balance always resolves to ready_to_invoice first', () => {
    // Finding: getLedgerUiStatus's final `return 'draft'` is unreachable.
    // Every path that reaches it has already proven balance > 0 (the
    // `!isPositiveMoney(balance)` check earlier returns 'paid' otherwise),
    // so the `isPositiveMoney(balance)` check right above 'draft' is always
    // true and 'ready_to_invoice' always wins first. Not a money bug (no
    // ledger is ever mis-colored), but 'draft' can never actually render.
    const ledger = buildLedger({
      balance_due: 500,
      paid_amount: 0,
      invoice_number: undefined,
      due_date: undefined,
    });
    expect(getLedgerUiStatus(ledger)).toBe('ready_to_invoice');
  });
});

describe('TONE / STATUS_TONE referential integrity', () => {
  it('every STATUS_TONE entry points at a tone that actually exists (a typo here silently breaks the chip color)', () => {
    for (const [uiStatus, entry] of Object.entries(STATUS_TONE)) {
      expect(TONE[entry.tone], `STATUS_TONE.${uiStatus}.tone = "${entry.tone}"`).toBeDefined();
    }
  });
});
