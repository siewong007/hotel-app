import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookingChannel } from '../types';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  navigate: vi.fn(),
  channels: {
    data: [
      {
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
      },
    ] as BookingChannel[],
    isLoading: false,
    error: null as unknown,
  },
  matrix: {
    data: {
      date: '2026-09-20',
      rate_plan_id: null,
      currency: 'MYR',
      cells: [
        {
          channel_id: 5,
          channel_name: 'Booking.com',
          channel_type: 'ota',
          room_type_id: 1,
          source_rate: '300.00',
          selling_price: '330.00',
          net_rate: null,
          rule_id: 9,
          rule_label: '+10%',
          commission_amount: '49.50',
          net_revenue: '280.50',
        },
      ],
    },
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  roomTypes: { data: [{ id: 1, name: 'Deluxe King' }] },
  ratePlans: { data: [] as unknown[] },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../rates/hooks/useRatePlans', () => ({
  useRatePlans: () => mocks.ratePlans,
  useRateRoomTypes: () => mocks.roomTypes,
}));

vi.mock('../hooks/useChannels', () => ({
  useChannels: () => mocks.channels,
  useChannelMatrix: () => mocks.matrix,
  useChannelMutations: () => ({
    create: { mutate: vi.fn(), isPending: false },
    update: { mutate: vi.fn(), isPending: false },
    deactivate: { mutate: vi.fn(), isPending: false },
  }),
}));

import ChannelsPage from './ChannelsPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('ChannelsPage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(cleanup);

  it('renders the channel list with commission summary', () => {
    render(<ChannelsPage />);

    expect(screen.getByText(/Booking\.com/)).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<ChannelsPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
