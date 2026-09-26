// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phone row: pin useIsPhone (jsdom has no matchMedia) — explicitly mocked so
// a future global polyfill can't flip the branch.
const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('../../../hooks/useIsPhone', () => ({ useIsPhone: () => mocks.isPhone }));

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

  it('renders a full-width date stepper including the ±window jumps', () => {
    const props = renderToolbar();
    expect(screen.getByRole('toolbar')).toBeTruthy();
    const stepper = screen.getByRole('group', { name: 'Date window' });
    for (const name of ['Back 14 days', 'Previous day', 'Next day', 'Forward 14 days']) {
      expect(stepper.contains(screen.getByRole('button', { name }))).toBe(true);
    }
    expect(stepper.contains(screen.getByLabelText('Start date'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back 14 days' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, -14));
    fireEvent.click(screen.getByRole('button', { name: 'Forward 14 days' }));
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, 14));
  });

  it('puts the actions on their own wrapping row, outside the stepper', () => {
    renderToolbar({ selectMode: false, onToggleSelectMode: vi.fn() });
    const stepper = screen.getByRole('group', { name: 'Date window' });
    for (const name of ['Select', 'Refresh', 'Today']) {
      expect(stepper.contains(screen.getByRole('button', { name }))).toBe(false);
    }
    expect(stepper.contains(screen.getByRole('button', { name: /overrides only/i }))).toBe(false);
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

  it('only commits a start date inside the allowed range', () => {
    const minStart = shiftDate(START, -10);
    const maxStart = shiftDate(START, 10);
    const props = renderToolbar({ minStart, maxStart });
    const input = screen.getByLabelText('Start date');
    expect(input.getAttribute('min')).toBe(minStart);
    expect(input.getAttribute('max')).toBe(maxStart);

    // A half-typed year never moves the window; the hint names the range.
    fireEvent.change(input, { target: { value: '0002-12-08' } });
    expect(props.onStartChange).not.toHaveBeenCalled();
    expect(screen.getByText(`Pick a date between ${minStart} and ${maxStart}.`)).toBeTruthy();
    fireEvent.change(input, { target: { value: shiftDate(maxStart, 1) } });
    expect(props.onStartChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: shiftDate(START, 3) } });
    expect(props.onStartChange).toHaveBeenLastCalledWith(shiftDate(START, 3));

    // Leaving the field snaps an out-of-range draft back to the start.
    fireEvent.change(input, { target: { value: '0002-12-08' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe(START);
  });

  it('disables the steps that lead past the range edge', () => {
    renderToolbar({ minStart: START, maxStart: shiftDate(START, 30) });
    expect(screen.getByRole('button', { name: 'Previous day' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Back 14 days' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Next day' })).toHaveProperty('disabled', false);
  });
});
