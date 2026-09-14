import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getComplimentaryBookings: vi.fn(),
  getGuestsWithCredits: vi.fn(),
  getComplimentarySummary: vi.fn(),
  getAllGuests: vi.fn(),
  getRoomTypes: vi.fn(),
}));

vi.mock('../../../api', () => ({
  BookingsService: {
    getComplimentaryBookings: mocks.getComplimentaryBookings,
    getGuestsWithCredits: mocks.getGuestsWithCredits,
    getComplimentarySummary: mocks.getComplimentarySummary,
  },
  GuestsService: { getAllGuests: mocks.getAllGuests },
  RoomsService: { getRoomTypes: mocks.getRoomTypes },
}));

import ComplimentaryManagementPage from './ComplimentaryManagementPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ComplimentaryManagementPage />
    </QueryClientProvider>,
  );

describe('ComplimentaryManagementPage', () => {
  beforeEach(() => {
    mocks.getComplimentaryBookings.mockResolvedValue([]);
    mocks.getGuestsWithCredits.mockResolvedValue({ credits: [] });
    mocks.getComplimentarySummary.mockResolvedValue(null);
    mocks.getAllGuests.mockResolvedValue([]);
    mocks.getRoomTypes.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it('renders the complimentary workspace once data resolves', async () => {
    renderPage();
    await waitFor(() => expect(mocks.getComplimentaryBookings).toHaveBeenCalled());
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(mocks.getComplimentaryBookings).toHaveBeenCalled());
    await expectNoCriticalAxeViolations(container);
  });
});
