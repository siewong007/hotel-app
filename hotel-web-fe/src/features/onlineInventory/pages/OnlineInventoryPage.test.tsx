// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phone branch: pin useIsPhone (jsdom has no matchMedia).
const mocks = vi.hoisted(() => ({
  isPhone: false,
  canEdit: true,
  blocker: null as null | {
    shouldBlockFn: () => boolean | Promise<boolean>;
    disabled?: boolean;
  },
}));
vi.mock('../../../hooks/useIsPhone', () => ({ useIsPhone: () => mocks.isPhone }));
// Viewing is route-gated elsewhere; the page itself only asks for the write
// permission, which the tests flip to cover the read-only mode.
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      permission === 'online_inventory:manage' ? mocks.canEdit : true,
  }),
}));
// The page renders outside a router here; capture the blocker options so the
// leave-guard can be driven directly.
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (opts: typeof mocks.blocker) => {
    mocks.blocker = opts;
  },
}));

import type { OnlineInventoryAllocation } from '../types';
import { dateRange, cellKey } from '../utils';
import { formatLocalDate } from '../../../utils/date';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
import OnlineInventoryPage from './OnlineInventoryPage';
import { expectNoAxeViolations } from '../../../test/axe';
import { buildKyHttpError } from '../../../api/testSupport/httpError';

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
      updated_at: null,
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
      updated_at: `${stay_date}T01:02:03.456789Z`,
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
  mocks.canEdit = true;
  mocks.blocker = null;
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
        // No stored row when the window loaded: another admin creating
        // one meanwhile is a conflict too.
        expected_updated_at: null,
      },
    ]);
  });

  it('refreshes the window after a successful save', async () => {
    renderPage();
    await stageDeluxeHold();
    fireEvent.click(await screen.findByRole('button', { name: /review & apply/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rangeMock).toHaveBeenCalledTimes(2));
  });

  it('shows the conflict message with a Reload action on a stale save', async () => {
    bulkMock.mockRejectedValueOnce(
      buildKyHttpError(409, {
        error: 'Someone else changed these days since you loaded them. Reload to see the latest.',
        code: 'stale_write',
        conflicts: [{ room_type_id: 1, stay_date: TODAY }],
      }),
    );
    renderPage();
    await stageDeluxeHold();
    fireEvent.click(await screen.findByRole('button', { name: /review & apply/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));

    const banner = await screen.findByText(
      'Someone else changed these days since you loaded them. Reload to see the latest.',
    );
    expect(screen.getByText('Your changes were not saved')).toBeTruthy();
    expect(banner.closest('[role="alert"]')?.textContent).toMatch(/Deluxe King ·/);
    // Nothing was applied, so the edit is still staged until Reload.
    expect(screen.getByText(/1 cell changed/)).toBeTruthy();

    // The review dialog closes so the banner and its Reload are reachable.
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(rangeMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('Your changes were not saved')).toBeNull(),
    );
    // The conflicting day's staged edit is dropped in favour of the latest.
    expect(screen.queryByText(/1 cell changed/)).toBeNull();
  });

  it("shows the server's message when a save is refused", async () => {
    bulkMock.mockRejectedValueOnce(
      buildKyHttpError(400, {
        error: 'Custom online price can have at most two decimal places',
        code: 'bad_request',
      }),
    );
    renderPage();
    await stageDeluxeHold();
    fireEvent.click(await screen.findByRole('button', { name: /review & apply/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(dialog.textContent).toMatch(/at most two decimal places/),
    );
    expect(screen.queryByText('Unable to save the inventory changes.')).toBeNull();
  });

  it('blocks a price with more than 2 decimals inline', async () => {
    renderPage();
    fireEvent.keyDown(await firstDeluxeCell(), { key: 'Enter' });
    fireEvent.change(await screen.findByRole('spinbutton', { name: /custom online price/i }), {
      target: { value: '199.999' },
    });
    expect(screen.getByText(/Use at most 2 decimal places/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByRole('spinbutton', { name: /custom online price/i }), {
      target: { value: '199.99' },
    });
    expect(screen.queryByText(/Use at most 2 decimal places/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false);
  });

  it('sends a reset when an edit brings a cell back to the defaults', async () => {
    renderPage();
    // Standard Queen carries only a custom price; clearing it = defaults.
    const cell = (await screen.findAllByRole('gridcell', { name: /^Standard Queen,/ }))[0];
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.change(await screen.findByRole('spinbutton', { name: /custom online price/i }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(await screen.findByRole('button', { name: /review & apply/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 change' }));
    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    expect(bulkMock.mock.calls[0][0]).toEqual([
      {
        room_type_id: 2,
        stay_date: TODAY,
        reset: true,
        expected_updated_at: `${TODAY}T01:02:03.456789Z`,
      },
    ]);
  });

  it('asks before leaving with unsaved changes, in-app and on tab close', async () => {
    renderPage();
    await firstDeluxeCell();
    // Nothing staged: no in-app blocker and no browser prompt.
    expect(mocks.blocker?.disabled).toBe(true);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await stageDeluxeHold();
    await screen.findByText(/1 cell changed/);
    expect(mocks.blocker?.disabled).toBe(false);

    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    // Staying: the confirm is cancelled, so navigation stays blocked.
    const stay = Promise.resolve(mocks.blocker!.shouldBlockFn());
    expect(
      await screen.findByText('Leave this page and discard your unsaved inventory changes?'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await stay).toBe(true);

    // Leaving: confirming the discard lets navigation through.
    const leave = Promise.resolve(mocks.blocker!.shouldBlockFn());
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(await leave).toBe(false);
  });

  it('shows the load error instead of an empty grid', async () => {
    rangeMock.mockRejectedValueOnce(
      buildKyHttpError(400, { error: "Invalid 'from' date", code: 'bad_request' }),
    );
    renderPage();
    expect(await screen.findByText("Couldn't load online availability")).toBeTruthy();
    expect(screen.getByText("Invalid 'from' date")).toBeTruthy();
    expect(screen.queryByText('No room types to configure')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('rowheader', { name: /Deluxe King/ })).toBeTruthy();
  });

  describe('without online_inventory:manage', () => {
    beforeEach(() => {
      mocks.canEdit = false;
    });

    it('shows the grid read-only with a note and no editing controls', async () => {
      renderPage();
      const cell = await firstDeluxeCell();
      expect(screen.getByText(/View only/)).toBeTruthy();

      // Neither Enter nor double-click opens the editor.
      fireEvent.keyDown(cell, { key: 'Enter' });
      fireEvent.doubleClick(cell);
      expect(screen.queryByRole('spinbutton', { name: /walk-in hold/i })).toBeNull();

      // Selecting still works for the summary, but no bulk panel appears.
      fireEvent.click(cell);
      expect(screen.queryByRole('region', { name: /bulk edit/i })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Unsaved inventory changes' })).toBeNull();
      expect(mocks.blocker?.disabled).toBe(true);
    });
  });
  it('has no axe violations on the populated inventory grid', async () => {
    const { container } = renderPage();

    expect(await screen.findByRole('rowheader', { name: /Deluxe King/ })).toBeTruthy();
    await expectNoAxeViolations(container);
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
    // The ±GRID_DAYS window jumps are reachable on phones too.
    expect(screen.getByRole('button', { name: 'Back 14 days' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forward 14 days' })).toBeTruthy();
  });

  it('keeps Select out of the date stepper row so it cannot be pushed off-screen', async () => {
    renderPage();
    await screen.findByText('Deluxe King');
    const stepper = screen.getByRole('group', { name: 'Date window' });
    expect(stepper.contains(screen.getByLabelText('Start date'))).toBe(true);
    expect(stepper.contains(screen.getByRole('button', { name: 'Select' }))).toBe(false);
  });

  it('pins the pending-changes bar to the viewport in place (no portal)', async () => {
    const { container } = renderPage();
    await screen.findByText('Deluxe King');

    fireEvent.click(firstDeluxeDay());
    fireEvent.change(await screen.findByRole('spinbutton', { name: /walk-in hold/i }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const bar = await screen.findByRole('region', { name: 'Unsaved inventory changes' });
    // Rendered inside the page: the shell no longer traps `position: fixed`.
    expect(container.contains(bar)).toBe(true);
    expect(getComputedStyle(bar).position).toBe('fixed');
    expect(bar.textContent).toMatch(/1 cell changed/);
    fireEvent.click(screen.getByRole('button', { name: /review & apply/i }));
    expect(await screen.findByRole('button', { name: 'Apply 1 change' })).toBeTruthy();
  });

  it('shows the tap/select hint that matches the current mode', async () => {
    renderPage();
    await screen.findByText('Deluxe King');
    expect(screen.getByText(/Tap a day to edit it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByText(/Tap days to select them/)).toBeTruthy();
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

  it('hides Select and the editor sheet for view-only users', async () => {
    mocks.canEdit = false;
    renderPage();
    await screen.findByText('Deluxe King');
    expect(screen.getByText(/View only — you can see/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(screen.getByText(/View only · swipe sideways/)).toBeTruthy();
    fireEvent.click(firstDeluxeDay());
    expect(screen.queryByText(/Deluxe King ·/)).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: /walk-in hold/i })).toBeNull();
  });
});
