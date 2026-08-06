// The Status dropdown must not offer "Paid" as a bare label. update_customer_ledger
// writes the `status` column alone — no customer_ledger_payments row, no
// paid_amount, no payment_date — so the backend refuses a TRANSITION to 'paid'
// while a balance is outstanding (repositories/ledger.rs::update_customer_ledger).
// These pin the frontend mirror of that rule: the option is withheld exactly when
// the backend would reject it, and stays available when it would not.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerLedger, CustomerLedgerUpdateRequest } from '../../../../../types';
import EditLedgerDialog from './EditLedgerDialog';

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

function renderDialog(ledger: CustomerLedger | null) {
  const editFormData: CustomerLedgerUpdateRequest = {
    status: ledger?.status,
    company_name: ledger?.company_name,
  };
  return render(
    <EditLedgerDialog
      open
      onClose={vi.fn()}
      editingLedger={ledger}
      editFormData={editFormData}
      setEditFormData={vi.fn()}
      bookingRoomRate=""
      setBookingRoomRate={vi.fn()}
      loadingBookingRoomRate={false}
      updating={false}
      onUpdate={vi.fn()}
      currencySymbol="RM"
    />,
  );
}

// The dialog's InputLabels are not associated with their Selects (MUI needs an
// explicit id/labelId pair), so the comboboxes have no accessible name to query
// by. Reach the right one through the FormControl that owns the "Status" label
// rather than by position, so adding another Select cannot silently retarget it.
function openStatusMenuAndGetPaidOption(): HTMLElement {
  const statusLabel = screen
    .getAllByText('Status')
    .find(node => node.tagName === 'LABEL');
  if (!statusLabel) throw new Error('Status label not found');
  const statusField = statusLabel.closest('.MuiFormControl-root');
  if (!statusField) throw new Error('Status FormControl not found');

  fireEvent.mouseDown(within(statusField as HTMLElement).getByRole('combobox'));
  return screen.getByRole('option', { name: 'Paid' });
}

afterEach(cleanup);

describe('EditLedgerDialog — Paid requires a recorded payment', () => {
  it('withholds "Paid" and explains why when a balance is still outstanding', () => {
    renderDialog(buildLedger({ status: 'pending', amount: 500, paid_amount: 0, balance_due: 500 }));

    expect(openStatusMenuAndGetPaidOption().getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText(/Paid is unavailable while a balance is outstanding/),
    ).toBeDefined();
  });

  it('withholds "Paid" on a part-paid entry — partial settlement is not settlement', () => {
    renderDialog(buildLedger({ status: 'partial', amount: 500, paid_amount: 200, balance_due: 300 }));

    expect(openStatusMenuAndGetPaidOption().getAttribute('aria-disabled')).toBe('true');
  });

  it('offers "Paid" once payments cover the amount, with the general status note', () => {
    renderDialog(buildLedger({ status: 'paid', amount: 500, paid_amount: 500, balance_due: 0 }));

    expect(openStatusMenuAndGetPaidOption().getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByText(/only relabels the entry/)).toBeDefined();
    expect(screen.queryByText(/Paid is unavailable/)).toBeNull();
  });

  // A row already stored as 'paid' must stay editable even if its balance later
  // re-opened, mirroring the backend's transition-only guard — otherwise the
  // full-form submit (which echoes status back) could never save.
  it('keeps "Paid" available on a row already stored as paid, even with a re-opened balance', () => {
    renderDialog(buildLedger({ status: 'paid', amount: 500, paid_amount: 400, balance_due: 100 }));

    expect(openStatusMenuAndGetPaidOption().getAttribute('aria-disabled')).not.toBe('true');
  });

  // balance_due is meaningless on a voided row; getLedgerBalanceDue zeroes it,
  // so the option must not be blocked on that basis.
  it('does not withhold "Paid" on a voided entry', () => {
    renderDialog(
      buildLedger({ status: 'pending', balance_due: 500, void_at: '2026-07-02T00:00:00Z' }),
    );

    expect(openStatusMenuAndGetPaidOption().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('renders without an entry loaded', () => {
    renderDialog(null);

    expect(openStatusMenuAndGetPaidOption().getAttribute('aria-disabled')).not.toBe('true');
  });
});
