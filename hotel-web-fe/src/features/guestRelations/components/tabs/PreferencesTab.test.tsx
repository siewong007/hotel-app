import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestPreference, GuestProfile } from '../../../../types';

const mocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  putPreferences: vi.fn(),
}));

vi.mock('../../../../api/guestRelations.service', () => ({
  GuestRelationsService: {
    getPreferences: (...args: unknown[]) => mocks.getPreferences(...args),
    putPreferences: (...args: unknown[]) => mocks.putPreferences(...args),
  },
}));

import PreferencesTab from './PreferencesTab';

function buildProfile(): GuestProfile {
  return {
    guest: {
      id: 7,
      nick_name: 'Aisha Rahman',
      is_active: true,
      guest_type: 'non_member',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    summary: {
      completed_stays: 0,
      total_nights: 0,
      total_room_revenue: '0.00',
      outstanding_balance: '0.00',
      total_bookings: 0,
    },
    reservations: [],
    duplicate_candidates: [],
  };
}

function renderTab(canEdit = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <PreferencesTab guestId={7} profile={buildProfile()} canEdit={canEdit} />,
    { wrapper },
  );
}

/** The section Paper holding a category heading. Each category has its own
 *  Key/Value inputs, so queries must be scoped per section — and the element
 *  must be captured BEFORE editing, since a dirty section grows an "Unsaved"
 *  chip inside the heading and exact-text queries stop matching. */
function sectionFor(label: string): HTMLElement {
  const heading = screen.getByText(label, { selector: 'h6' });
  const paper = heading.closest('.MuiPaper-root');
  expect(paper, `section "${label}"`).toBeTruthy();
  return paper as HTMLElement;
}

describe('PreferencesTab', () => {
  beforeEach(() => {
    mocks.getPreferences.mockReset().mockResolvedValue([
      {
        id: 1,
        category: 'room',
        preference_key: 'pillow',
        preference_value: 'firm',
        updated_at: '2026-09-13T04:00:00Z',
      } as GuestPreference,
    ]);
    mocks.putPreferences.mockReset().mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('PUTs the section entries with replace_categories scoping the delete-by-absent-key semantics', async () => {
    renderTab();
    await screen.findByDisplayValue('firm');
    const room = within(sectionFor('Room'));

    // Add a second row to the Room section.
    fireEvent.click(room.getByRole('button', { name: /Add row/ }));
    const keyInputs = room.getAllByLabelText('Key');
    const valueInputs = room.getAllByLabelText('Value');
    expect(keyInputs).toHaveLength(2);
    fireEvent.change(keyInputs[1], { target: { value: 'floor' } });
    fireEvent.change(valueInputs[1], { target: { value: 'high, quiet' } });

    fireEvent.click(room.getByRole('button', { name: /Save room preferences/ }));

    await waitFor(() => {
      expect(mocks.putPreferences).toHaveBeenCalledWith(7, {
        entries: [
          { category: 'room', preference_key: 'pillow', preference_value: 'firm' },
          { category: 'room', preference_key: 'floor', preference_value: 'high, quiet' },
        ],
        replace_categories: ['room'],
      });
    });
  });

  it('blocks save while a row is half-filled instead of sending a blank key', async () => {
    renderTab();
    await screen.findByText('No bed preferences recorded.');
    const bed = within(sectionFor('Bed'));

    fireEvent.click(bed.getByRole('button', { name: /Add row/ }));
    fireEvent.change(bed.getByLabelText('Key'), { target: { value: 'king' } });
    fireEvent.click(bed.getByRole('button', { name: /Save bed preferences/ }));

    expect(await bed.findByText(/Every row needs both a key and a value/)).toBeTruthy();
    expect(mocks.putPreferences).not.toHaveBeenCalled();
  });

  it('blocks save on duplicate keys within a category (case-insensitive, trimmed)', async () => {
    renderTab();
    await screen.findByDisplayValue('firm');
    const room = within(sectionFor('Room'));

    fireEvent.click(room.getByRole('button', { name: /Add row/ }));
    const keyInputs = room.getAllByLabelText('Key');
    const valueInputs = room.getAllByLabelText('Value');
    fireEvent.change(keyInputs[1], { target: { value: ' Pillow ' } });
    fireEvent.change(valueInputs[1], { target: { value: 'soft' } });
    fireEvent.click(room.getByRole('button', { name: /Save room preferences/ }));

    expect(await room.findByText(/keys must be unique within a category/)).toBeTruthy();
    expect(mocks.putPreferences).not.toHaveBeenCalled();
  });

  it('renders read-only without guests:update (canEdit=false)', async () => {
    renderTab(false);
    await screen.findByDisplayValue('firm');
    expect(screen.queryByRole('button', { name: /Add row/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save .* preferences/ })).toBeNull();
  });
});
