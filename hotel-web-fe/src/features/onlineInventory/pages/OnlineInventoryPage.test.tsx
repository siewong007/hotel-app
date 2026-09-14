// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phone branch: useMediaQuery reports the viewport (jsdom has no matchMedia).
const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});

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

beforeEach(() => {
  mocks.isPhone = false;
  rangeMock.mockResolvedValue(rows());
  bulkMock.mockImplementation(async (cells) => rows().slice(0, cells.length));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OnlineInventoryPage', () => {
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

describe('OnlineInventoryPage on a phone', () => {
  beforeEach(() => {
    mocks.isPhone = true;
  });

  /** Today's Deluxe King day-cell in the phone strip. */
  const firstDeluxeDay = () =>
    screen.getAllByRole('button', { name: /^Deluxe King,/ })[0];

  it('renders room-type cards instead of the grid', async () => {
    renderPage();
    expect(await screen.findByText('Deluxe King')).toBeTruthy();
    expect(screen.getByText('Standard Queen')).toBeTruthy();
    expect(screen.getByText('DLXK')).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
    // The ±GRID_DAYS window jumps are desktop-only.
    expect(screen.queryByRole('button', { name: 'Back 14 days' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forward 14 days' })).toBeNull();
  });

  it('opens the cell editor sheet on tap and stages the edit', async () => {
    renderPage();
    await screen.findByText('Deluxe King');

    fireEvent.click(firstDeluxeDay());
    expect(await screen.findByText(/Deluxe King ·/)).toBeTruthy();
    fireEvent.change(await screen.findByRole('spinbutton', { name: /walk-in hold/i }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/1 cell changed/)).toBeTruthy();
  });

  it('toggles select mode from the toolbar and clears on Done', async () => {
    renderPage();
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    // The toggle reads Done while the sticky bar counts the selection.
    expect(
      screen.getByRole('button', { name: 'Done', pressed: true }),
    ).toBeTruthy();
    expect(screen.getByText('0 selected')).toBeTruthy();
    // "Edit selected" is disabled until something is selected.
    expect(
      screen.getByRole('button', { name: 'Edit selected' }),
    ).toHaveProperty('disabled', true);

    fireEvent.click(firstDeluxeDay());
    expect(screen.getByText('1 selected')).toBeTruthy();

    // Done exits the mode and clears the selection — the bar goes away.
    fireEvent.click(screen.getByRole('button', { name: 'Done', pressed: true }));
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
  });

  it('opens the bulk sheet from "Edit selected" and stages the cells', async () => {
    renderPage();
    await screen.findByText('Deluxe King');

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(firstDeluxeDay());
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected' }));

    expect(
      await screen.findByRole('group', { name: /limit to weekdays/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close online' }));
    expect(await screen.findByText(/1 cell changed/)).toBeTruthy();
  });
});
