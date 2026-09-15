import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DepositResolution } from '../hooks/useDepositResolution';
import type { DepositResolutionSectionProps } from './DepositSection';

const mocks = vi.hoisted(() => ({
  onRefund: vi.fn(),
  onForfeit: vi.fn(),
  onCancel: vi.fn(),
  onRevertRefund: vi.fn(),
  onRestore: vi.fn(),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (amount: number) => `RM${Number(amount).toFixed(2)}`,
    symbol: 'RM',
    currency: 'MYR',
  }),
}));

import DepositSection from './DepositSection';

const baseResolution: DepositResolution = {
  collected: 50,
  refunded: 0,
  forfeited: 0,
  remaining: 50,
  method: 'Cash',
  collectedAt: '2026-09-12T06:32:00.000Z',
  refundMethod: null,
  refundedAt: null,
  refundReference: null,
  forfeitReason: null,
  status: 'pending',
  voidedDepositCount: 0,
  completedDepositCount: 1,
  mirrorDue: 0,
};

interface RenderOptions
  extends Partial<Omit<DepositResolutionSectionProps, 'resolution'>> {
  resolution?: Partial<DepositResolution>;
}

function renderSection({ resolution, ...props }: RenderOptions = {}) {
  return render(
    <DepositSection
      resolution={{ ...baseResolution, ...resolution }}
      busy={{
        refunding: false,
        forfeiting: false,
        cancelling: false,
        reverting: false,
        restoring: false,
        ...props.busy,
      }}
      can={{
        refund: true,
        forfeit: true,
        cancel: true,
        revertRefund: true,
        restore: true,
        ...props.can,
      }}
      readOnly={props.readOnly ?? false}
      noDepositLabel={props.noDepositLabel}
      hotelSettings={props.hotelSettings ?? { payment_methods: ['Cash', 'Bank Transfer', 'E-Wallet', 'Other'] }}
      onRefund={props.onRefund ?? mocks.onRefund}
      onForfeit={props.onForfeit ?? mocks.onForfeit}
      onCancel={props.onCancel ?? mocks.onCancel}
      onRevertRefund={props.onRevertRefund ?? mocks.onRevertRefund}
      onRestore={props.onRestore ?? mocks.onRestore}
    />,
  );
}

async function selectMethod(combobox: HTMLElement, optionName: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('DepositSection — guided deposit resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the header, held amount, status chip and collection summary for a pending deposit', () => {
    renderSection();

    expect(screen.getByText('Security deposit')).toBeDefined();
    expect(screen.getByText('Pending resolution')).toBeDefined();
    // Held amount (header, tabular-nums) + remaining summary both render RM50.00.
    expect(screen.getAllByText('RM50.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Collected RM50\.00 via Cash/)).toBeDefined();
    // Zero legs are dropped from the breakdown — a fresh pending deposit
    // shows only the still-held remainder.
    expect(screen.getByText('Remaining RM50.00')).toBeDefined();
    expect(screen.queryByText(/Refunded RM0\.00/)).toBeNull();
    expect(screen.queryByText(/Forfeited RM0\.00/)).toBeNull();
  });

  it('keeps the Remaining leg alongside the non-zero legs of a resolved deposit', () => {
    renderSection({
      resolution: { status: 'refunded', refunded: 50, remaining: 0 },
    });

    expect(screen.getByText('Refunded RM50.00 · Remaining RM0.00')).toBeDefined();
    expect(screen.queryByText(/Forfeited RM0\.00/)).toBeNull();
  });

  it('moves the roving tabindex with arrow keys, selects with Enter/Space, and keeps a disabled option focusable but not selectable', () => {
    renderSection({ can: { refund: false, forfeit: true, cancel: true, revertRefund: true, restore: true } });

    const group = screen.getByRole('radiogroup');
    const [refundOpt, forfeitOpt, cancelOpt] =
      within(group).getAllByRole('radio') as HTMLButtonElement[];

    // Nothing selected → the first option holds the group's single tab stop.
    expect(refundOpt.tabIndex).toBe(0);
    expect(forfeitOpt.tabIndex).toBe(-1);
    expect(cancelOpt.tabIndex).toBe(-1);

    // ArrowDown from the first option moves focus AND selects — the tab
    // stop roves with the selection.
    fireEvent.keyDown(refundOpt, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(forfeitOpt);
    expect(forfeitOpt.getAttribute('aria-checked')).toBe('true');
    expect(forfeitOpt.tabIndex).toBe(0);
    expect(refundOpt.tabIndex).toBe(-1);

    // ArrowUp back onto the permission-disabled option: focus lands but the
    // selection does not — a disabled option is focusable, not selectable.
    fireEvent.keyDown(forfeitOpt, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(refundOpt);
    expect(refundOpt.getAttribute('aria-checked')).toBe('false');
    expect(forfeitOpt.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(refundOpt, { key: 'Enter' });
    fireEvent.keyDown(refundOpt, { key: ' ' });
    expect(refundOpt.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: /Refund RM50\.00/ })).toBeNull();

    // Enter/Space select a focused enabled option.
    cancelOpt.focus();
    fireEvent.keyDown(cancelOpt, { key: 'Enter' });
    expect(cancelOpt.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel deposit record' })).toBeDefined();

    forfeitOpt.focus();
    fireEvent.keyDown(forfeitOpt, { key: ' ' });
    expect(forfeitOpt.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Review forfeiture' })).toBeDefined();
  });

  it('offers three radio options and mounts only the selected option form', () => {
    renderSection();

    const group = screen.getByRole('radiogroup');
    const options = within(group).getAllByRole('radio');
    expect(options).toHaveLength(3);

    // Nothing selected yet → no option is checked and no form is mounted.
    options.forEach((option) => expect(option.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByRole('button', { name: /Refund RM50\.00/ })).toBeNull();

    fireEvent.click(within(group).getByRole('radio', { name: /Forfeit deposit/ }));
    expect(within(group).getByRole('radio', { name: /Forfeit deposit/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Review forfeiture' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Refund RM50\.00/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel deposit record' })).toBeNull();

    fireEvent.click(within(group).getByRole('radio', { name: /Refund deposit/ }));
    expect(within(group).getByRole('radio', { name: /Refund deposit/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Refund RM50.00' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Review forfeiture' })).toBeNull();
  });

  it('runs the refund with the chosen method plus optional reference and note', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Refund deposit/ }));

    const refundButton = screen.getByRole('button', { name: 'Refund RM50.00' });
    expect(refundButton).toBeDefined();

    await selectMethod(screen.getByRole('combobox', { name: /refund method/i }), 'Bank Transfer');
    fireEvent.change(screen.getByLabelText(/Reference/i), { target: { value: 'RF-9001' } });
    fireEvent.change(screen.getByLabelText(/^Note/i), { target: { value: 'handed to guest at desk' } });
    fireEvent.click(refundButton);

    expect(mocks.onRefund).toHaveBeenCalledWith({
      method: 'Bank Transfer',
      reference: 'RF-9001',
      note: 'handed to guest at desk',
    });
  });

  it('omits blank reference/note from the refund input and defaults to the first configured method', () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Refund deposit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Refund RM50.00' }));

    expect(mocks.onRefund).toHaveBeenCalledWith({ method: 'Cash', reference: undefined, note: undefined });
  });

  it('walks the forfeit flow: reason required, review split, then destructive submit', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Forfeit deposit/ }));

    const reviewButton = screen.getByRole('button', { name: 'Review forfeiture' }) as HTMLButtonElement;
    expect(reviewButton.disabled).toBe(true);

    await selectMethod(screen.getByRole('combobox', { name: /forfeit reason/i }), 'Room damage');
    expect((screen.getByRole('button', { name: 'Review forfeiture' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Forfeit amount'), { target: { value: '20' } });
    expect(screen.getByText('Remaining to refund after: RM30.00')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Review forfeiture' }));
    expect(
      screen.getByText('You are retaining RM20.00 of the deposit — RM30.00 will remain to refund.'),
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Forfeit RM20.00' }));
    expect(mocks.onForfeit).toHaveBeenCalledWith({ amount: 20, reason: 'Room damage', notes: undefined });
  });

  it('returns to the forfeit form via Back without submitting', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Forfeit deposit/ }));
    await selectMethod(screen.getByRole('combobox', { name: /forfeit reason/i }), 'Missing item or key');
    fireEvent.click(screen.getByRole('button', { name: 'Review forfeiture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mocks.onForfeit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review forfeiture' })).toBeDefined();
  });

  it('requires staff notes when the forfeit reason is Other', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Forfeit deposit/ }));
    await selectMethod(screen.getByRole('combobox', { name: /forfeit reason/i }), 'Other');

    expect((screen.getByRole('button', { name: 'Review forfeiture' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/staff notes/i), { target: { value: 'Pool towel missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review forfeiture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forfeit RM50.00' }));

    expect(mocks.onForfeit).toHaveBeenCalledWith({ amount: 50, reason: 'Other', notes: 'Pool towel missing' });
  });

  it('blocks an over-ceiling forfeit amount before review', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Forfeit deposit/ }));
    await selectMethod(screen.getByRole('combobox', { name: /forfeit reason/i }), 'Room damage');

    fireEvent.change(screen.getByLabelText('Forfeit amount'), { target: { value: '60' } });

    expect(screen.getByText(/Cannot exceed RM50\.00/)).toBeDefined();
    expect((screen.getByRole('button', { name: 'Review forfeiture' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.onForfeit).not.toHaveBeenCalled();
  });

  it('cancels an uncollected deposit with a required reason and the no-refund warning', () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: /Cancel uncollected deposit/ }));

    expect(screen.getByText(/no money was actually received/i)).toBeDefined();
    expect(screen.getByText('This does not issue a refund.')).toBeDefined();

    const cancelButton = screen.getByRole('button', { name: 'Cancel deposit record' }) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Recorded in error' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deposit record' }));

    expect(mocks.onCancel).toHaveBeenCalledWith('Recorded in error');
  });

  it('disables an option without its permission and captions the missing permission', () => {
    renderSection({ can: { refund: false, forfeit: false, cancel: false, revertRefund: true, restore: true } });

    const group = screen.getByRole('radiogroup');
    const refundOption = within(group).getByRole('radio', { name: /Refund deposit/ });
    expect(refundOption.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Requires the payments:refund permission').length).toBeGreaterThan(0);
    // Completed deposit rows exist → cancel routes to per-row void, so the
    // caption names payments:delete rather than the ambiguous either/or.
    expect(screen.getByText('Requires the payments:delete permission')).toBeDefined();

    fireEvent.click(refundOption);
    expect(screen.queryByRole('button', { name: /Refund RM50\.00/ })).toBeNull();
  });

  it('captions the cancel option with bookings:update when no completed deposit rows exist (waive route)', () => {
    renderSection({
      resolution: { collected: 0, remaining: 0, method: null, collectedAt: null, mirrorDue: 50, completedDepositCount: 0 },
      can: { refund: true, forfeit: true, cancel: false, revertRefund: true, restore: true },
    });

    expect(screen.getByText('Requires the bookings:update permission')).toBeDefined();
    expect(screen.queryByText('Requires the payments:delete permission')).toBeNull();
  });

  it('locks option switching while a resolution action is busy', () => {
    renderSection({ busy: { refunding: true, forfeiting: false, cancelling: false, reverting: false, restoring: false } });

    const group = screen.getByRole('radiogroup');
    const options = within(group).getAllByRole('radio');
    options.forEach((option) => expect(option.getAttribute('aria-disabled')).toBe('true'));

    // Clicking an enabled-in-permission option while busy mounts no form.
    fireEvent.click(within(group).getByRole('radio', { name: /Forfeit deposit/ }));
    expect(within(group).getByRole('radio', { name: /Forfeit deposit/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Review forfeiture' })).toBeNull();
  });

  it('keeps refund enabled but disables forfeit when nothing was collected (flag-only legacy deposit)', () => {
    renderSection({ resolution: { collected: 0, remaining: 0, method: null, collectedAt: null, mirrorDue: 50, completedDepositCount: 0 } });

    expect(screen.getByText('Pending resolution')).toBeDefined();
    expect(screen.getByText(/Recorded on the booking/)).toBeDefined();

    fireEvent.click(screen.getByRole('radio', { name: /Refund deposit/ }));
    expect(screen.getByRole('button', { name: 'Refund RM50.00' })).toBeDefined();

    const forfeitOption = screen.getByRole('radio', { name: /Forfeit deposit/ });
    expect(forfeitOption.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No collected deposit to forfeit')).toBeDefined();
  });

  it('shows the refunded strip with method, time, reference and a Revert refund action', () => {
    renderSection({
      resolution: {
        status: 'refunded',
        refunded: 50,
        remaining: 0,
        refundMethod: 'Bank Transfer',
        refundedAt: '2026-09-14T03:01:00.000Z',
        refundReference: 'RF-9001',
      },
    });

    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('Deposit refunded')).toBeDefined();
    expect(screen.getByText(/RM50\.00 via Bank Transfer/)).toBeDefined();
    expect(screen.getByText(/RF-9001/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Revert refund' }));
    expect(mocks.onRevertRefund).toHaveBeenCalledTimes(1);
  });

  it('hides Revert refund without the manage permission', () => {
    renderSection({
      resolution: { status: 'refunded', refunded: 50, remaining: 0 },
      can: { refund: true, forfeit: true, cancel: true, revertRefund: false, restore: true },
    });

    expect(screen.getByText('Deposit refunded')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Revert refund' })).toBeNull();
  });

  it('shows the forfeited strip with the kept amount, reason and remainder refunded', () => {
    renderSection({
      resolution: {
        status: 'partially_forfeited',
        refunded: 30,
        forfeited: 20,
        remaining: 0,
        forfeitReason: 'Room damage — broken lamp',
      },
    });

    expect(screen.getByText('Partially forfeited')).toBeDefined();
    expect(screen.getByText(/Kept RM20\.00 — Room damage — broken lamp/)).toBeDefined();
    expect(screen.getByText(/Remainder refunded RM30\.00/)).toBeDefined();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows the cancelled strip and Restore deposit when a voided row exists', () => {
    renderSection({
      resolution: { status: 'cancelled', collected: 0, remaining: 0, method: null, collectedAt: null, voidedDepositCount: 1, completedDepositCount: 0 },
    });

    expect(screen.getByText('Cancelled — not collected')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Restore deposit' }));
    expect(mocks.onRestore).toHaveBeenCalledTimes(1);
  });

  it('hides Restore deposit without the delete permission', () => {
    renderSection({
      resolution: { status: 'cancelled', collected: 0, remaining: 0, method: null, collectedAt: null, voidedDepositCount: 1, completedDepositCount: 0 },
      can: { refund: true, forfeit: true, cancel: true, revertRefund: true, restore: false },
    });

    expect(screen.getByText('Cancelled — not collected')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Restore deposit' })).toBeNull();
  });

  it('renders no resolution controls in readOnly', () => {
    renderSection({ readOnly: true });

    expect(screen.getByText('Pending resolution')).toBeDefined();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refund RM50\.00/ })).toBeNull();
  });

  it('renders a neutral no-deposit state when nothing is recorded', () => {
    renderSection({
      resolution: { status: 'none', collected: 0, remaining: 0, method: null, collectedAt: null, mirrorDue: 0, completedDepositCount: 0 },
    });

    expect(screen.getByText('No deposit')).toBeDefined();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('uses the noDepositLabel override for the none chip', () => {
    renderSection({
      resolution: { status: 'none', collected: 0, remaining: 0, method: null, collectedAt: null, mirrorDue: 0, completedDepositCount: 0 },
      noDepositLabel: 'City Ledger - N/A',
    });

    expect(screen.getByText('City Ledger - N/A')).toBeDefined();
    expect(screen.queryByText('No deposit')).toBeNull();
  });
});
