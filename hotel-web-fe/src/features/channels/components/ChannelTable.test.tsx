import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingChannel } from '../types';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});

import { ChannelTable } from './ChannelTable';

const channel = (over: Partial<BookingChannel>): BookingChannel =>
  ({
    id: 5,
    name: 'Booking.com',
    channel_type: 'ota',
    default_commission_type: 'percentage',
    default_commission_value: '15.00',
    default_commission_scope: 'per_booking',
    is_active: true,
    abbreviation: 'B.C',
    code: 'booking_com',
    integration_mode: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as BookingChannel;

const channels = [channel({}), channel({ id: 6, name: 'Walk-in', abbreviation: null, code: null, is_active: false, default_commission_type: 'none' })];

const handlers = () => ({ onOpen: vi.fn(), onEdit: vi.fn(), onDeactivate: vi.fn() });

describe('ChannelTable', () => {
  beforeEach(() => {
    mocks.isPhone = false;
  });
  afterEach(cleanup);

  it('desktop/tablet: renders the table inside a horizontal scroll host', () => {
    const { container } = render(<ChannelTable channels={channels} canWrite {...handlers()} />);
    const table = container.querySelector('table') as HTMLElement;
    expect(table).toBeTruthy();
    expect(getComputedStyle(table.parentElement as HTMLElement).overflowX).toBe('auto');
    expect(screen.queryByTestId('channel-cards')).toBeNull();
  });

  it('phone: renders one card per channel instead of the table', () => {
    mocks.isPhone = true;
    const { container } = render(<ChannelTable channels={channels} canWrite {...handlers()} />);
    expect(container.querySelector('table')).toBeNull();
    const cards = screen.getByTestId('channel-cards');
    expect(within(cards).getByText('Booking.com (B.C)')).toBeTruthy();
    expect(within(cards).getByText('Walk-in')).toBeTruthy();
    expect(within(cards).getByText(/15%/)).toBeTruthy();
  });

  it('phone: tapping a card opens the channel; footer actions edit and deactivate', () => {
    mocks.isPhone = true;
    const h = handlers();
    render(<ChannelTable channels={channels} canWrite {...h} />);
    fireEvent.click(screen.getByText('Booking.com (B.C)'));
    expect(h.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));

    const edits = screen.getAllByRole('button', { name: /edit/i });
    expect(edits).toHaveLength(2);
    fireEvent.click(edits[1]);
    expect(h.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }));

    // Only the active channel can be deactivated.
    const deactivate = screen.getAllByRole('button', { name: /deactivate/i });
    expect(deactivate).toHaveLength(1);
    fireEvent.click(deactivate[0]);
    expect(h.onDeactivate).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it('phone: read-only users get no edit/deactivate actions', () => {
    mocks.isPhone = true;
    render(<ChannelTable channels={channels} canWrite={false} {...handlers()} />);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull();
  });
});
