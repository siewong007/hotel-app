import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestInteraction } from '../../../../types';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  createInteraction: vi.fn(),
  deleteInteraction: vi.fn(),
  getInteractions: vi.fn(),
  hasPermission: vi.fn(),
  updateInteraction: vi.fn(),
}));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: { id: 3 } }),
}));

vi.mock('../../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => mocks.confirm,
}));

// The hook layer stays real (it owns invalidation + the infinite-feed paging);
// only the HTTP boundary is mocked.
vi.mock('../../../../api/guestRelations.service', () => ({
  GuestRelationsService: {
    getInteractions: (...args: unknown[]) => mocks.getInteractions(...args),
    createInteraction: (...args: unknown[]) => mocks.createInteraction(...args),
    updateInteraction: (...args: unknown[]) => mocks.updateInteraction(...args),
    deleteInteraction: (...args: unknown[]) => mocks.deleteInteraction(...args),
  },
}));

vi.mock('../../../support/hooks/useSupportQueries', () => ({
  useSupportAgents: () => ({ data: [], isPending: false, isError: false }),
}));

import { followUpDateToISO } from '../InteractionForm';
import InteractionsTab from './InteractionsTab';

function buildInteraction(overrides: Partial<GuestInteraction> = {}): GuestInteraction {
  return {
    id: 11,
    guest_id: 7,
    interaction_type: 'note',
    note_type: 'general',
    subject: null,
    content: 'Called to confirm arrival',
    booking_id: null,
    is_alert: false,
    is_private: false,
    follow_up_at: null,
    follow_up_completed_at: null,
    assigned_to: null,
    assigned_to_name: null,
    created_by: 3,
    created_by_name: 'Front Desk',
    created_at: '2026-09-13T04:00:00Z',
    updated_at: '2026-09-13T04:00:00Z',
    ...overrides,
  };
}

function renderTab(overrides: Partial<React.ComponentProps<typeof InteractionsTab>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const props: React.ComponentProps<typeof InteractionsTab> = {
    guestId: 7,
    reservations: [],
    addNoteRequested: false,
    onAddNoteHandled: vi.fn(),
    ...overrides,
  };
  return render(<InteractionsTab {...props} />, { wrapper });
}

describe('InteractionsTab', () => {
  beforeEach(() => {
    mocks.confirm.mockReset().mockResolvedValue(true);
    mocks.createInteraction.mockReset().mockResolvedValue(buildInteraction());
    mocks.deleteInteraction.mockReset().mockResolvedValue({ success: true });
    mocks.getInteractions.mockReset().mockResolvedValue({ data: [], total: 0, page: 1, page_size: 20 });
    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.updateInteraction.mockReset().mockResolvedValue(buildInteraction());
  });

  afterEach(() => cleanup());

  it('renders the timeline from the paged feed', async () => {
    mocks.getInteractions.mockResolvedValue({
      data: [buildInteraction({ content: 'Guest asked for a late checkout' })],
      total: 1,
      page: 1,
      page_size: 20,
    });
    renderTab();
    expect(await screen.findByText('Guest asked for a late checkout')).toBeTruthy();
    expect(mocks.getInteractions).toHaveBeenCalledWith(7, {
      page: 1,
      page_size: 20,
      include_completed_followups: false,
    });
  });

  it('creates an interaction through the service with the follow-up instant anchored to hotel noon', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText(/Note content/), {
      target: { value: 'Guest asked for a late checkout' },
    });
    fireEvent.change(screen.getByLabelText(/Follow-up date/), {
      target: { value: '2026-09-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => {
      expect(mocks.createInteraction).toHaveBeenCalledWith(7, {
        interaction_type: 'note',
        subject: undefined,
        content: 'Guest asked for a late checkout',
        booking_id: undefined,
        is_alert: false,
        is_private: false,
        follow_up_at: followUpDateToISO('2026-09-20'),
        assigned_to: undefined,
      });
    });
    // The stored instant must read back as the picked hotel date.
    const sentIso = mocks.createInteraction.mock.calls[0][1].follow_up_at as string;
    const { toHotelDateString } = await import('../../../../utils/date');
    expect(toHotelDateString(sentIso)).toBe('2026-09-20');
  });

  it('hides the add form without guests:update', async () => {
    mocks.hasPermission.mockImplementation((perm: string) => perm !== 'guests:update');
    renderTab();
    expect(screen.queryByLabelText(/Note content/)).toBeNull();
    expect(await screen.findByText('No interactions recorded yet.')).toBeTruthy();
  });

  it('marks an open follow-up complete via the update payload', async () => {
    mocks.getInteractions.mockResolvedValue({
      data: [buildInteraction({ follow_up_at: '2026-09-20T04:00:00.000Z' })],
      total: 1,
      page: 1,
      page_size: 20,
    });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark follow-up complete' }));
    await waitFor(() => {
      expect(mocks.updateInteraction).toHaveBeenCalledWith(7, 11, { follow_up_completed: true });
    });
  });
});
