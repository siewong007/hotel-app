import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  calendar: {
    window: { from: '2026-09-14', to: '2026-09-28' },
    calendar: undefined as unknown,
    cells: new Map(),
    shiftWindow: vi.fn(),
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  plans: { data: undefined as unknown, isLoading: false, error: null as unknown },
  roomTypes: { data: [] as unknown[] },
  planWithRates: { data: undefined as unknown },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ currency: 'MYR', format: (n: number) => `RM${n}`, symbol: 'RM' }),
}));

vi.mock('../hooks/useRateCalendar', () => ({
  useRateCalendar: () => mocks.calendar,
}));

vi.mock('../hooks/useRatePlans', () => ({
  useRatePlans: () => mocks.plans,
  useRatePlanWithRates: () => mocks.planWithRates,
  useRateRoomTypes: () => mocks.roomTypes,
  useRatePlanMutations: () => ({
    createPlan: { mutate: vi.fn(), isPending: false },
    updatePlan: { mutate: vi.fn(), isPending: false },
    deletePlan: { mutate: vi.fn(), isPending: false },
  }),
  useRoomRateMutations: () => ({
    createRate: { mutate: vi.fn(), isPending: false },
    updateRate: { mutate: vi.fn(), isPending: false },
    deleteRate: { mutate: vi.fn(), isPending: false },
    bulkUpsert: { mutate: vi.fn(), isPending: false },
  }),
}));

import RatesPage from './RatesPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('RatesPage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.calendar.calendar = { room_types: [], cells: [], from: '2026-09-14', to: '2026-09-28' };
    mocks.plans = { data: [], isLoading: false, error: null };
    mocks.roomTypes = { data: [] };
    mocks.planWithRates = { data: undefined };
  });

  afterEach(cleanup);

  it('renders the rates workspace for permitted users', () => {
    render(<RatesPage />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<RatesPage />);
    await expectNoCriticalAxeViolations(container);
  });
});
