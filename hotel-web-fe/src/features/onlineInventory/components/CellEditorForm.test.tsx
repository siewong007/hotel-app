// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditableCell, GridCellView } from '../types';
import { CellEditorForm } from './CellEditorForm';

const view = (overrides: Partial<GridCellView> = {}): GridCellView => ({
  key: '1:2026-09-12',
  room_type_id: 1,
  room_type_code: 'DLXK',
  room_type_name: 'Deluxe King',
  stay_date: '2026-09-12',
  physical: 5,
  saved: { walk_in_reserved_rooms: 2, online_booking_enabled: true, custom_price: null },
  current: { walk_in_reserved_rooms: 2, online_booking_enabled: true, custom_price: null },
  standard_price: '280.00',
  effective_price: '280.00',
  online_available: 3,
  changed: false,
  is_reset: false,
  is_override: false,
  ...overrides,
});

const draft = (overrides: Partial<EditableCell> = {}): EditableCell => ({
  walk_in_reserved_rooms: 2,
  online_booking_enabled: true,
  custom_price: null,
  ...overrides,
});

const renderForm = (overrides: Partial<Parameters<typeof CellEditorForm>[0]> = {}) => {
  const props = {
    view: view(),
    draft: draft(),
    onDraftChange: vi.fn(),
    priceInvalid: false,
    overHeld: false,
    formatPrice: (v: string) => `RM ${v}`,
    ...overrides,
  };
  render(<CellEditorForm {...props} />);
  return props;
};

describe('CellEditorForm', () => {
  afterEach(cleanup);

  it('shows the standard-rate context and physical availability', () => {
    renderForm();
    expect(screen.getByText(/Standard rate.*RM 280\.00/)).toBeTruthy();
    expect(screen.getByText(/of 5 free/)).toBeTruthy();
  });

  it('emits a draft patch when the online switch toggles', () => {
    const props = renderForm();
    fireEvent.click(screen.getByRole('switch', { name: /bookable online/i }));
    expect(props.onDraftChange).toHaveBeenCalledWith({ online_booking_enabled: false });
  });

  it('clamps the walk-in hold at zero', () => {
    const props = renderForm({ draft: draft({ walk_in_reserved_rooms: 0 }) });
    expect(
      screen.getByRole('button', { name: /decrease walk-in hold/i }),
    ).toHaveProperty('disabled', true);
    const hold = screen.getByRole('spinbutton', { name: /walk-in hold/i });
    fireEvent.change(hold, { target: { value: '-3' } });
    expect(props.onDraftChange).toHaveBeenCalledWith({ walk_in_reserved_rooms: 0 });
  });

  it('surfaces the invalid-price helper when priceInvalid is set', () => {
    renderForm({ draft: draft({ custom_price: '0' }), priceInvalid: true });
    expect(screen.getByText(/greater than zero/i)).toBeTruthy();
  });

  it('warns softly when overHeld is set', () => {
    renderForm({ draft: draft({ walk_in_reserved_rooms: 9 }), overHeld: true });
    expect(screen.getByText(/higher than the physical availability/i)).toBeTruthy();
  });
});
