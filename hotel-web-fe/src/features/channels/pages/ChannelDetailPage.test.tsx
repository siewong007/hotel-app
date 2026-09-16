import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  rules: {
    data: [
      {
        id: 9,
        channel_id: 5,
        room_type_id: null,
        rate_plan_id: null,
        rule_type: 'markup_percent',
        value: '10.00',
        effective_from: '2026-01-01',
        effective_to: null,
        min_price: null,
        max_price: null,
        priority: 0,
        is_active: true,
        reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    isLoading: false,
    error: null as unknown,
  },
  commission: { data: [], isLoading: false, error: null as unknown },
  mappings: { data: { room_types: [], rate_plans: [] }, isLoading: false, error: null as unknown },
  roomTypes: { data: [] as unknown[] },
  ratePlans: { data: [] as unknown[] },
  preview: { mutate: vi.fn(), data: undefined, isPending: false, isError: false, reset: vi.fn() },
}));

const stubMutations = () => ({
  createRule: { mutate: vi.fn(), isPending: false },
  updateRule: { mutate: vi.fn(), isPending: false },
  deleteRule: { mutate: vi.fn(), isPending: false },
  createCommission: { mutate: vi.fn(), isPending: false },
  updateCommission: { mutate: vi.fn(), isPending: false },
  deleteCommission: { mutate: vi.fn(), isPending: false },
  upsertRoomMapping: { mutate: vi.fn(), isPending: false },
  upsertPlanMapping: { mutate: vi.fn(), isPending: false },
  deleteRoomMapping: { mutate: vi.fn(), isPending: false },
  deletePlanMapping: { mutate: vi.fn(), isPending: false },
});

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(async () => true),
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
  useChannelDetail: () => ({
    rules: mocks.rules,
    commission: mocks.commission,
    mappings: mocks.mappings,
  }),
  useChannelDetailMutations: () => stubMutations(),
  useChannelPreview: () => mocks.preview,
}));

import ChannelDetailPage from './ChannelDetailPage';

describe('ChannelDetailPage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(cleanup);

  it('renders the channel header and pricing rules', () => {
    render(<ChannelDetailPage channelId="5" />);

    expect(screen.getByText('Booking.com')).toBeTruthy();
    expect(screen.getByText(/10/)).toBeTruthy();
  });

  it('switches to the commission tab showing the channel default', () => {
    render(<ChannelDetailPage channelId="5" />);

    fireEvent.click(screen.getByRole('tab', { name: /commission/i }));
    expect(screen.getByText(/15\.00/)).toBeTruthy();
  });
});
