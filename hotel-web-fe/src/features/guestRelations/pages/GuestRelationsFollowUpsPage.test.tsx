import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { FollowUpDue, FollowUpQueueItem, FollowUpQueueResponse } from '../../../types';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  navigate: vi.fn(),
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  followUpsCalls: [] as Array<{ due: FollowUpDue; page: number }>,
  followUpsQuery: {
    data: undefined as FollowUpQueueResponse | undefined,
    error: null as unknown,
    isPending: false,
    isError: false,
  },
  completeMutate: vi.fn(),
  completeMutation: {
    mutateAsync: undefined as unknown,
    isPending: false,
    variables: undefined as { guestId: number; noteId: number } | undefined,
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: { id: 3 } }),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
  // The compat Link is an untyped string-`to` wrapper over TanStack Link; a
  // plain anchor keeps the rendered `to` inspectable as href.
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

vi.mock('../hooks/useGuestRelationsQueries', () => ({
  useGuestFollowUps: (due: FollowUpDue, page: number) => {
    mocks.followUpsCalls.push({ due, page });
    return mocks.followUpsQuery;
  },
  useCompleteFollowUp: () => mocks.completeMutation,
}));

import GuestRelationsFollowUpsPage from './GuestRelationsFollowUpsPage';

function buildItem(overrides: Partial<FollowUpQueueItem> = {}): FollowUpQueueItem {
  return {
    note_id: 71,
    guest_id: 7,
    guest_name: 'Aisha Rahman',
    subject: 'Confirm spa booking',
    interaction_type: 'follow_up',
    follow_up_at: '2026-09-14T09:00:00Z',
    assigned_to: 4,
    assigned_to_name: 'Nina',
    created_by_name: 'Nina',
    snippet: 'Call about the spa slot',
    ...overrides,
  };
}

function buildResponse(
  items: FollowUpQueueItem[],
  overrides: Partial<FollowUpQueueResponse> = {},
): FollowUpQueueResponse {
  return {
    data: items,
    total: items.length,
    page: 1,
    page_size: 20,
    ...overrides,
  };
}

describe('GuestRelationsFollowUpsPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }),
    });

    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.navigate.mockReset();
    mocks.setSearchParams.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.followUpsCalls = [];
    mocks.followUpsQuery.data = buildResponse([
      buildItem(),
      buildItem({
        note_id: 72,
        guest_id: 9,
        guest_name: 'Chen Wei',
        subject: null,
        interaction_type: 'phone_call',
        assigned_to: null,
        assigned_to_name: null,
        snippet: null,
      }),
    ]);
    mocks.followUpsQuery.error = null;
    mocks.followUpsQuery.isPending = false;
    mocks.followUpsQuery.isError = false;
    mocks.completeMutate.mockReset().mockResolvedValue(undefined);
    mocks.completeMutation.mutateAsync = mocks.completeMutate;
    mocks.completeMutation.isPending = false;
    mocks.completeMutation.variables = undefined;
  });

  afterEach(() => cleanup());

  it('renders the header and one row per queue item', () => {
    render(<GuestRelationsFollowUpsPage />);
    expect(screen.getByRole('heading', { name: /follow-up/i })).toBeTruthy();

    // Guest, subject, humanized type, assignee and snippet all land in the row.
    expect(screen.getByText('Aisha Rahman')).toBeTruthy();
    expect(screen.getByText('Confirm spa booking')).toBeTruthy();
    expect(screen.getByText('Call about the spa slot')).toBeTruthy();
    expect(screen.getByText('Nina')).toBeTruthy();
    // Null subject/assignee rows degrade instead of rendering blank cells.
    expect(screen.getByText('Chen Wei')).toBeTruthy();
    expect(screen.getByText(/unassigned/i)).toBeTruthy();
  });

  it('links each guest name to the guest 360 page', () => {
    render(<GuestRelationsFollowUpsPage />);
    const link = screen.getByRole('link', { name: 'Aisha Rahman' });
    expect(link.getAttribute('href')).toBe('/guest-relations/guests/7');
  });

  it('queries the queue with the all bucket by default', () => {
    render(<GuestRelationsFollowUpsPage />);
    expect(mocks.followUpsCalls.length).toBeGreaterThan(0);
    const last = mocks.followUpsCalls[mocks.followUpsCalls.length - 1];
    expect(last).toEqual({ due: 'all', page: 1 });
  });

  it('maps each due chip to the matching due param and resets to page 1', () => {
    render(<GuestRelationsFollowUpsPage />);
    const cases: Array<[string, FollowUpDue]> = [
      ['Overdue', 'overdue'],
      ['Today', 'today'],
      ['Upcoming', 'upcoming'],
      ['All', 'all'],
    ];
    for (const [label, due] of cases) {
      mocks.followUpsCalls = [];
      fireEvent.click(screen.getByRole('button', { name: label }));
      const last = mocks.followUpsCalls[mocks.followUpsCalls.length - 1];
      expect(last).toEqual({ due, page: 1 });
    }
  });

  it('seeds the due filter from the ?due= deep link', () => {
    mocks.searchParams = new URLSearchParams('due=upcoming');
    render(<GuestRelationsFollowUpsPage />);
    const last = mocks.followUpsCalls[mocks.followUpsCalls.length - 1];
    expect(last.due).toBe('upcoming');
  });

  it('marks a row done through the complete mutation', () => {
    render(<GuestRelationsFollowUpsPage />);
    const buttons = screen.getAllByRole('button', { name: /mark done/i });
    fireEvent.click(buttons[0]);
    expect(mocks.completeMutate).toHaveBeenCalledWith({ guestId: 7, noteId: 71 });
  });

  it('paginates through the server-side page param', () => {
    mocks.followUpsQuery.data = buildResponse(
      Array.from({ length: 20 }, (_, i) => buildItem({ note_id: 100 + i })),
      { total: 45, page: 1, page_size: 20 },
    );
    render(<GuestRelationsFollowUpsPage />);
    expect(screen.getByText('Showing 1–20 of 45')).toBeTruthy();

    mocks.followUpsCalls = [];
    fireEvent.click(screen.getByRole('button', { name: /go to page 2/i }));
    const last = mocks.followUpsCalls[mocks.followUpsCalls.length - 1];
    expect(last.page).toBe(2);
  });

  it('shows a friendly empty state when the queue is clear', () => {
    mocks.followUpsQuery.data = buildResponse([]);
    render(<GuestRelationsFollowUpsPage />);
    expect(screen.getByText(/no follow-ups/i)).toBeTruthy();
  });

  it('denies access without guests:read', () => {
    mocks.hasPermission.mockReturnValue(false);
    render(<GuestRelationsFollowUpsPage />);
    expect(screen.getByText(/do not have permission/)).toBeTruthy();
  });
});
