// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnlineInventoryAllocation } from '../types';
import { dateRange, cellKey } from '../utils';
import { formatLocalDate } from '../../../utils/date';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
import OnlineInventoryPage from './OnlineInventoryPage';

vi.mock('../api', () => ({
  getOnlineInventoryRange: vi.fn(),
  bulkUpdateOnlineInventory: vi.fn(),
}));

import { bulkUpdateOnlineInventory, getOnlineInventoryRange } from '../api';

const rangeMock = vi.mocked(getOnlineInventoryRange);
const bulkMock = vi.mocked(bulkUpdateOnlineInventory);

const TODAY = formatLocalDate();

const rows = (): OnlineInventoryAllocation[] =>
  dateRange(TODAY, 14).flatMap((stay_date) => [
    {
      room_type_id: 1,
      room_type_code: 'DLXK',
      room_type_name: 'Deluxe King',
      stay_date,
      physical_available_rooms: 5,
      walk_in_reserved_rooms: 1,
      online_booking_enabled: true,
      custom_price: null,
      standard_price: '280.00',
      is_override: false,
      online_available_rooms: 4,
    },
    {
      room_type_id: 2,
      room_type_code: 'STDQ',
      room_type_name: 'Standard Queen',
      stay_date,
      physical_available_rooms: 3,
      walk_in_reserved_rooms: 0,
      online_booking_enabled: true,
      custom_price: '150.00',
      standard_price: '180.00',
      is_override: true,
      online_available_rooms: 3,
    },
  ]);

const renderPage = () =>
  render(
    <ConfirmProvider>
      <OnlineInventoryPage />
    </ConfirmProvider>,
  );

describe('OnlineInventoryPage', () => {
  beforeEach(() => {
    rangeMock.mockResolvedValue(rows());
    bulkMock.mockImplementation(async (cells) => rows().slice(0, cells.length));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the 14-day matrix with one row per room type', async () => {
    renderPage();
    expect(await screen.findByRole('rowheader', { name: /Deluxe King/ })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: /Standard Queen/ })).toBeTruthy();
    const grid = screen.getByRole('grid', { name: /online inventory/i });
    expect(grid.getAttribute('aria-colcount')).toBe('15');
    expect(rangeMock).toHaveBeenCalledWith(TODAY, dateRange(TODAY, 14)[13]);
  });

  /** First Deluxe cell = room type 1 on the window's first date (today). */
  const firstDeluxeCell = async () =>
    (await screen.findAllByRole('gridcell', { name: /^Deluxe King,/ }))[0];

  /** Open today's Deluxe cell in the editor and raise the hold to 2. */
  const stageDeluxeHold = async () => {
    fireEvent.keyDown(await firstDeluxeCell(), { key: 'Enter' });
    fireEvent.change(await screen.findByRole('spinbutton', { name: /walk-in hold/i }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  };

  it('stages a cell through the editor and shows the pending-changes bar', async () => {
    renderPage();
    await stageDeluxeHold();
    expect(await screen.findByText(/1 cell changed/)).toBeTruthy();
  });

  it('saves through the review dialog with one bulk call', async () => {
    renderPage();
    await stageDeluxeHold();
    fireEvent.click(await screen.findByRole('button', { name: /review & apply/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    expect(bulkMock.mock.calls[0][0]).toEqual([
      {
        room_type_id: 1,
        stay_date: TODAY,
        walk_in_reserved_rooms: 2,
        online_booking_enabled: true,
        custom_price: null,
      },
    ]);
  });
});
