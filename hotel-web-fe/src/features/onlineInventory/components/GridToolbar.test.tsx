// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phone row: useMediaQuery reports the viewport (jsdom has no matchMedia) —
// pinned explicitly so a future global polyfill can't flip the branch.
const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});

import { formatLocalDate } from '../../../utils/date';
import { shiftDate } from '../utils';
import { GridToolbar } from './GridToolbar';

// Always safely in the past so the "Today" shortcut is rendered — hardcoding a
// calendar date made the suite timezone-fragile (CI runs in UTC).
const START = shiftDate(formatLocalDate(), -30);

const renderToolbar = (overrides: Partial<Parameters<typeof GridToolbar>[0]> = {}) => {
  const props = {
    start: START,
    onStartChange: vi.fn(),
    onRefresh: vi.fn(),
    refreshing: false,
    overridesOnly: false,
    onToggleOverrides: vi.fn(),
    selectedCount: 0,
    ...overrides,
  };
  render(<GridToolbar {...props} />);
  return props;
};

beforeEach(() => {
  mocks.isPhone = false;
});
afterEach(cleanup);

describe('GridToolbar', () => {
  it('navigates by one day and by the whole window', () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, -1));
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, 1));
    fireEvent.click(screen.getByRole('button', { name: 'Back 14 days' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, -14));
    fireEvent.click(screen.getByRole('button', { name: 'Forward 14 days' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, 14));
  });

  it('changes the start date through the date field', () => {
    const props = renderToolbar();
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-10-01' },
    });
    expect(props.onStartChange).toHaveBeenCalledWith('2026-10-01');
  });

  it('shows Today only when the window does not already start today', () => {
    renderToolbar({ start: formatLocalDate() });
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('jumps back to today', () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(props.onStartChange).toHaveBeenCalledWith(formatLocalDate());
  });

  it('toggles the overrides-only filter', () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /overrides only/i }));
    expect(props.onToggleOverrides).toHaveBeenCalled();
  });

  it('refreshes and reports the selection size', () => {
    const props = renderToolbar({ selectedCount: 6 });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(props.onRefresh).toHaveBeenCalled();
    expect(screen.getByText(/6 selected/)).toBeTruthy();
  });

  it('uses shiftDate so window jumps land on real calendar dates', () => {
    // sanity: the helper the toolbar relies on
    expect(shiftDate('2026-09-12', 14)).toBe('2026-09-26');
  });
});

describe('GridToolbar on a phone', () => {
  beforeEach(() => {
    mocks.isPhone = true;
  });

  it('renders one compact row and drops the ±window jumps', () => {
    renderToolbar();
    expect(screen.getByRole('toolbar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back 14 days' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forward 14 days' })).toBeNull();
    // ±1-day nav and the date field survive.
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeTruthy();
    expect(screen.getByLabelText('Start date')).toBeTruthy();
  });

  it('steps a single day and offers Today when away from it', () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, -1));
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, 1));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(formatLocalDate());
  });

  it('shows the Select/Done toggle only when the props are provided', () => {
    const { unmount } = render(<GridToolbar
      start={START}
      onStartChange={vi.fn()}
      onRefresh={vi.fn()}
      refreshing={false}
      overridesOnly={false}
      onToggleOverrides={vi.fn()}
      selectedCount={0}
    />);
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    unmount();

    const props = renderToolbar({ selectMode: false, onToggleSelectMode: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(props.onToggleSelectMode).toHaveBeenCalled();
  });

  it('reads Done with aria-pressed while select mode is on', () => {
    renderToolbar({ selectMode: true, onToggleSelectMode: vi.fn() });
    expect(screen.getByRole('button', { name: 'Done', pressed: true })).toBeTruthy();
  });
});
