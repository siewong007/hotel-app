import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BulkRateDialog } from './BulkRateDialog';
import type { RatePlan, RoomTypeRef } from '../types';

const plans = [
  {
    id: 7,
    name: 'BAR',
    code: 'BAR',
  },
] as unknown as RatePlan[];

const roomTypes: RoomTypeRef[] = [
  { id: 11, name: 'Deluxe', code: 'DLX', base_price: '100.00' },
  { id: 12, name: 'Suite', code: 'STE', base_price: '200.00' },
];

const renderDialog = (onSubmit = vi.fn()) =>
  render(
    <BulkRateDialog
      open
      plans={plans}
      roomTypes={roomTypes}
      saving={false}
      onClose={() => undefined}
      onSubmit={onSubmit}
    />,
  );

// MUI appends " *" to required-field labels, so match by substring.
const fromInput = () => screen.getByLabelText(/Effective from/);
const toInput = () => screen.getByLabelText(/Effective to/);
const priceInput = () => screen.getByLabelText(/Price/);
const applyButton = () => screen.getByRole('button', { name: 'Apply rates' });

describe('BulkRateDialog', () => {
  it('blocks submission until every field is valid', () => {
    renderDialog();
    expect(applyButton().hasAttribute('disabled')).toBe(true);
  });

  it('submits a well-formed bulk payload', () => {
    const onSubmit = vi.fn();
    renderDialog(onSubmit);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Rate plan/ }));
    fireEvent.click(screen.getByRole('option', { name: 'BAR (BAR)' }));
    fireEvent.click(screen.getByLabelText('Deluxe'));
    fireEvent.change(fromInput(), { target: { value: '2026-11-01' } });
    fireEvent.change(toInput(), { target: { value: '2026-11-10' } });
    fireEvent.change(priceInput(), { target: { value: '180' } });

    expect(applyButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(applyButton());
    expect(onSubmit).toHaveBeenCalledWith({
      rate_plan_id: 7,
      room_type_ids: [11],
      effective_from: '2026-11-01',
      effective_to: '2026-11-10',
      price: 180,
    });
  });

  it('rejects an inverted date range', () => {
    renderDialog();
    fireEvent.change(fromInput(), { target: { value: '2026-11-10' } });
    fireEvent.change(toInput(), { target: { value: '2026-11-01' } });
    expect(
      screen.getByText('Effective from must be on or before effective to'),
    ).toBeTruthy();
    expect(applyButton().hasAttribute('disabled')).toBe(true);
  });
});
