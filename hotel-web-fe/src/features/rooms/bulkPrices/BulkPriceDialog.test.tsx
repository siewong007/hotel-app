import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  phone: false,
  preview: vi.fn(),
  apply: vi.fn(),
  revert: vi.fn(),
  last: null as unknown,
}));

vi.mock('../../../hooks/useIsPhone', () => ({ useIsPhone: () => mocks.phone }));
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `€${n.toFixed(2)}`, symbol: '€', currency: 'EUR' }),
}));
vi.mock('./hooks', () => ({
  usePreviewBulkPrices: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useApplyBulkPrices: () => ({ mutateAsync: mocks.apply, isPending: false }),
  useRevertBulkPrices: () => ({ mutateAsync: mocks.revert, isPending: false }),
  useLastBulkPriceChange: () => ({ data: mocks.last }),
}));

import { BulkPriceDialog } from './BulkPriceDialog';
import type { RoomType } from '../../../types';
import type { BulkPricePreview } from './types';

const roomTypes = [
  { id: 1, name: 'Standard', code: 'STD', base_price: '100.00' },
  { id: 2, name: 'Deluxe', code: 'DLX', base_price: '200.00' },
] as unknown as RoomType[];

const previewOf = (large: boolean): BulkPricePreview => ({
  rows: [
    {
      room_type_id: 1,
      code: 'STD',
      name: 'Standard',
      changed: true,
      changes: [
        {
          field: 'base_price',
          old_price: '100.00',
          new_price: large ? '140.00' : '110.00',
          delta: large ? '40.00' : '10.00',
          delta_percent: large ? '40.00' : '10.00',
          changed: true,
          large,
        },
      ],
    },
  ],
  changed_room_types: 1,
  changed_fields: 1,
  requires_confirmation: large,
  large_change_percent: 30,
});

const renderDialog = (onDone = vi.fn(), onClose = vi.fn()) =>
  render(<BulkPriceDialog open roomTypes={roomTypes} onClose={onClose} onDone={onDone} />);

const enterValue = (v: string) => fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: v } });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));

describe('BulkPriceDialog', () => {
  beforeEach(() => {
    mocks.phone = false;
    mocks.last = null;
    mocks.preview.mockReset();
    mocks.apply.mockReset();
    mocks.revert.mockReset();
  });
  afterEach(cleanup);

  it('blocks Next until a positive value is entered and rejects non-positive values', () => {
    renderDialog();
    const nextBtn = screen.getByRole('button', { name: 'Next' });
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
    enterValue('-5');
    expect(screen.getByText('Enter a number greater than zero')).toBeTruthy();
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
    enterValue('10');
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses the configured currency symbol, never a hardcoded RM', async () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(screen.getByLabelText('Method'));
    fireEvent.click(await screen.findByRole('option', { name: 'Increase by amount' }));
    expect(screen.getByLabelText(/^Value/).closest('div')?.textContent).toContain('€');
    fireEvent.mouseDown(screen.getByLabelText('Round result'));
    expect(await screen.findByRole('option', { name: 'Nearest €5.00' })).toBeTruthy();
    expect(screen.getByRole('listbox').textContent).not.toContain('RM');
    expect(dialog.textContent).not.toContain('RM ');
  });

  it('sends the signed value, previews, requires a reason, then applies', async () => {
    mocks.preview.mockResolvedValue(previewOf(false));
    mocks.apply.mockResolvedValue({ batch_id: 'b1', preview: previewOf(false) });
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderDialog(onDone, onClose);

    fireEvent.mouseDown(screen.getByLabelText('Method'));
    fireEvent.click(await screen.findByRole('option', { name: 'Decrease by %' }));
    enterValue('10');
    next();

    await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    expect(mocks.preview.mock.calls[0][0]).toMatchObject({
      room_type_ids: [],
      fields: ['base_price', 'weekday_rate', 'weekend_rate'],
      method: 'percent',
      value: -10,
      round_to: null,
    });

    expect(await screen.findByText('€110.00')).toBeTruthy(); // new price in the table
    next();
    const apply = await screen.findByRole('button', { name: 'Apply price changes' });
    expect((apply as HTMLButtonElement).disabled).toBe(true); // reason required
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Low season' } });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);

    await waitFor(() => expect(mocks.apply).toHaveBeenCalled());
    expect(mocks.apply.mock.calls[0][0]).toMatchObject({ reason: 'Low season', confirm_large_change: false });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('needs the large-change checkbox above the guard', async () => {
    mocks.preview.mockResolvedValue(previewOf(true));
    mocks.apply.mockResolvedValue({ batch_id: 'b2', preview: previewOf(true) });
    renderDialog();
    enterValue('40');
    next();
    expect(await screen.findByText(/more than 30%/)).toBeTruthy();
    next();
    fireEvent.change(await screen.findByLabelText(/^Reason/), { target: { value: 'Peak event' } });
    const apply = screen.getByRole('button', { name: 'Apply price changes' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this change/ }));
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    await waitFor(() => expect(mocks.apply.mock.calls[0][0].confirm_large_change).toBe(true));
  });

  it('renders stacked cards on a phone and a table on desktop', async () => {
    mocks.preview.mockResolvedValue(previewOf(false));
    mocks.phone = true;
    renderDialog();
    enterValue('10');
    next();
    expect(await screen.findAllByTestId('bulk-price-card')).toHaveLength(1);
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();

    mocks.phone = false;
    renderDialog();
    enterValue('10');
    next();
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByTestId('bulk-price-card')).toBeNull();
  });

  it('shows the last change and reverts it with a reason', async () => {
    mocks.last = {
      batch_id: 'b0',
      action: 'room_prices_bulk_updated',
      user_id: 1,
      username: 'amy',
      created_at: '2026-10-17T10:00:00Z',
      reason: 'Festival',
      room_types: 2,
      can_revert: true,
    };
    mocks.revert.mockResolvedValue({});
    const onDone = vi.fn();
    renderDialog(onDone);
    expect(screen.getByText(/Last bulk update by amy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revert last update' }));
    const confirm = screen.getAllByRole('button', { name: 'Revert last update' }).at(-1)!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Mistake' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.revert).toHaveBeenCalledWith('Mistake'));
    expect(onDone).toHaveBeenCalled();
  });
});
