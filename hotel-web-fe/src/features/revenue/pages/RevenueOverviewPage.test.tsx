import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RevenueOverview } from '../types';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RevenueOverviewPage />
    </QueryClientProvider>,
  );

const mocks = vi.hoisted(() => ({
  overview: {
    data: undefined as RevenueOverview | undefined,
    isPending: false,
    error: null as unknown,
  },
}));

vi.mock('../hooks/useRevenueOverview', () => ({
  useRevenueOverview: () => mocks.overview,
}));

vi.mock('../components/RevenueTrendChart', () => ({
  default: () => <div data-testid="trend-chart" />,
}));

import RevenueOverviewPage from './RevenueOverviewPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const kpis = {
  room_revenue: '12000.00',
  room_nights_sold: 80,
  occupancy_rate: '0.72',
  adr: '150.00',
  revpar: '108.00',
  alos_nights: '2.1',
  bookings_created: 40,
  void_rate: '0.02',
  no_show_rate: '0.01',
  direct_share: '0.60',
};

const data: RevenueOverview = {
  range: { from: '2026-09-01', to: '2026-09-14' },
  currency: 'MYR',
  kpis,
  previous_period: { from: '2026-08-18', to: '2026-08-31' },
  previous_kpis: kpis,
  deltas_pct: {
    room_revenue: 5,
    room_nights_sold: 2,
    occupancy_rate: 1,
    adr: 3,
    revpar: 4,
    alos_nights: 0,
    bookings_created: 6,
    void_rate: -1,
    no_show_rate: 0,
    direct_share: 2,
  },
  daily: [{ date: '2026-09-14', room_revenue: '900.00', room_nights_sold: 6, occupancy_rate: '0.75', adr: '150.00' }],
  channels: [{ channel_id: 1, channel_name: 'Direct', channel_type: 'direct', bookings: 30, net_revenue: '9000.00', share_pct: '0.75' }],
};

describe('RevenueOverviewPage', () => {
  beforeEach(() => {
    mocks.overview = { data, isPending: false, error: null };
  });

  afterEach(cleanup);

  it('renders KPIs, trend chart and channel mix', () => {
    renderPage();
    expect(screen.getByTestId('trend-chart')).toBeTruthy();
    expect(screen.getByText('Direct')).toBeTruthy();
    expect(screen.getByText(/Stay dates 2026-09-01/)).toBeTruthy();
  });

  it('shows the empty state when there is no activity', () => {
    mocks.overview.data = { ...data, daily: [], channels: [] };
    renderPage();
    expect(screen.getByText('No stays in this range')).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});
