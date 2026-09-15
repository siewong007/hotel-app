/**
 * Axe coverage for the two real surfaces DashboardRouter dispatches to.
 * DashboardRouter.test.tsx stubs these children to test role dispatch, so it
 * cannot carry the accessibility scan — this file renders them for real.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { renderPage } from '../../../test/renderPage';
import { toHotelDateString } from '../../../utils/date';
import { addLocalDays } from '../../../utils/date';
import type { ReportsModel } from './reports/reportsModel';

vi.mock('../../../api', () => ({
  RoomsService: { getAllRooms: vi.fn() },
  BookingsService: {
    getAllBookings: vi.fn(),
    getCurrentAndUpcomingBookings: vi.fn(async () => []),
    getBookingById: vi.fn(),
    updateBooking: vi.fn(),
    checkInGuest: vi.fn(),
  },
  GuestsService: { getGuest: vi.fn() },
}));

const kpi = { value: 0, prev: null, unit: 'int' as const, spark: [] };

const REPORTS_MODEL: ReportsModel = {
  periodRooms: 12,
  periodDays: 30,
  todayLabel: 'Today',
  daily: [],
  roomRev: 0,
  otherRev: 0,
  kpis: {
    occupancy: kpi,
    adr: { ...kpi, unit: 'RM' },
    revpar: { ...kpi, unit: 'RM' },
    roomRev: { ...kpi, unit: 'RM' },
    totalRev: { ...kpi, unit: 'RM' },
    outstanding: { ...kpi, unit: 'RM' },
  },
  live: { updated: '', arrivals: 0, departures: 0, inHouse: 0, occNow: 0, toClean: 0, ready: 0, unassigned: 0 },
  sources: [],
  roomTypes: [],
  ageing: [],
  guestBalances: [],
  companyBalances: [],
  roomStatus: [],
  revenueStates: [],
  arrivals: [],
  departures: [],
};

vi.mock('./reports/reportsModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reports/reportsModel')>();
  return {
    ...actual,
    useReportsModel: () => ({ model: REPORTS_MODEL, loading: false, liveLoading: false, error: null, refetch: vi.fn() }),
  };
});

import { BookingsService, RoomsService } from '../../../api';
import ReceptionistDashboard from './ReceptionistDashboard';
import ReportsAnalytics from './reports/ReportsAnalytics';

const today = toHotelDateString(new Date());
const tomorrow = toHotelDateString(addLocalDays(new Date(), 1));

describe('ReceptionistDashboard (dashboard surface)', () => {
  afterEach(cleanup);

  it('has no axe violations on the populated front desk', async () => {
    vi.mocked(RoomsService.getAllRooms).mockResolvedValue([
      {
        id: 'room-1',
        room_number: '101',
        room_type: 'Deluxe King',
        price_per_night: 120,
        available: true,
        max_occupancy: 2,
      },
    ] as never);
    vi.mocked(BookingsService.getAllBookings).mockResolvedValue([
      {
        id: 11,
        room_id: 'room-1',
        guest_name: 'Aisha Rahman',
        status: 'checked_in',
        check_in_date: today,
        check_out_date: tomorrow,
      },
    ] as never);

    const { container } = renderPage(<ReceptionistDashboard />, {
      auth: { roles: ['receptionist'] },
    });

    expect(await screen.findByRole('heading', { name: 'Front Desk' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

describe('ReportsAnalytics (dashboard surface)', () => {
  afterEach(cleanup);

  it('has no axe violations on the populated analytics dashboard', async () => {
    const { container } = renderPage(<ReportsAnalytics />, {
      auth: { roles: ['manager'] },
    });

    expect(await screen.findByRole('heading', { name: /Reports & Analytics/i })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
