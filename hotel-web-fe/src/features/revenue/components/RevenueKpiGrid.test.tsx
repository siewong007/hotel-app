import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RevenueKpiGrid from './RevenueKpiGrid';
import type { RevenueDeltas, RevenueKpis } from '../types';

const kpis: RevenueKpis = {
  room_revenue: '12340.00',
  room_nights_sold: 96,
  occupancy_rate: '68.6',
  adr: '128.54',
  revpar: '88.20',
  alos_nights: '2.7',
  bookings_created: 34,
  void_rate: '5.9',
  no_show_rate: '2.1',
  direct_share: '61.8',
};

const deltas: RevenueDeltas = {
  room_revenue: 12.4,
  room_nights_sold: -2,
  occupancy_rate: -3.1,
  adr: 4.5,
  revpar: 9.9,
  alos_nights: null,
  bookings_created: 8,
  void_rate: -1.2,
  no_show_rate: 0.4,
  direct_share: null,
};

describe('RevenueKpiGrid', () => {
  it('renders every KPI with formatted values', () => {
    render(<RevenueKpiGrid kpis={kpis} deltas={deltas} currency="USD" />);
    expect(screen.getByText('Room Revenue')).toBeTruthy();
    expect(screen.getByText('$12,340.00')).toBeTruthy();
    expect(screen.getByText('68.6%')).toBeTruthy();
    expect(screen.getByText('ADR')).toBeTruthy();
    expect(screen.getByText('RevPAR')).toBeTruthy();
    expect(screen.getByText('2.7 nights')).toBeTruthy();
    expect(screen.getByText('61.8%')).toBeTruthy();
  });

  it('marks missing baselines instead of inventing a delta', () => {
    render(<RevenueKpiGrid kpis={kpis} deltas={deltas} currency="USD" />);
    // alos_nights and direct_share have null deltas.
    expect(screen.getAllByText('· no prior').length).toBe(2);
  });

  it('renders zero-value KPIs without crashing', () => {
    const empty: RevenueKpis = {
      room_revenue: '0',
      room_nights_sold: 0,
      occupancy_rate: '0',
      adr: '0',
      revpar: '0',
      alos_nights: '0',
      bookings_created: 0,
      void_rate: '0',
      no_show_rate: '0',
      direct_share: '0',
    };
    render(<RevenueKpiGrid kpis={empty} deltas={deltas} currency="USD" />);
    // room_revenue, ADR, and RevPAR all render $0.00.
    expect(screen.getAllByText('$0.00').length).toBe(3);
  });
});
