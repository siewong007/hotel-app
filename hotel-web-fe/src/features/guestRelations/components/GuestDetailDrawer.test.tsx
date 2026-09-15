import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guest } from '../../../types';

const mocks = vi.hoisted(() => ({
  updateGuestMutation: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock('../../guests/hooks/useGuestQueries', () => ({
  useUpdateGuest: () => mocks.updateGuestMutation,
}));

import GuestDetailDrawer from './GuestDetailDrawer';

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 7,
    nick_name: 'Aisha Rahman',
    first_name: 'Aisha',
    last_name: 'Rahman',
    email: 'aisha@example.com',
    phone: '0123456789',
    nationality: 'Malaysian',
    is_active: true,
    guest_type: 'member',
    tourism_type: 'local',
    bookings_count: 3,
    last_stay_date: '2026-08-01',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Guest;
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof GuestDetailDrawer>> = {}) {
  const props = {
    guest: buildGuest(),
    open: true,
    onClose: vi.fn(),
    onOpenFullProfile: vi.fn(),
    onSaved: vi.fn(),
    canCreateEkyc: true,
    canTransferPortalAccount: true,
    tourismConversionGuestId: null,
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onNewBooking: vi.fn(),
    onStayHistory: vi.fn(),
    onViewCredits: vi.fn(),
    onConvertTourism: vi.fn(),
    onTransferPortalAccount: vi.fn(),
    onCreateEkyc: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<GuestDetailDrawer {...props} />);
  return props;
}

describe('GuestDetailDrawer', () => {
  beforeEach(() => {
    mocks.updateGuestMutation.isPending = false;
    mocks.updateGuestMutation.mutateAsync.mockReset().mockResolvedValue({});
  });

  afterEach(cleanup);

  it('renders identity, chips, contact details and the full-profile jump', () => {
    const { onOpenFullProfile } = renderDrawer();
    expect(screen.getAllByText('Aisha Rahman').length).toBeGreaterThan(0);
    expect(screen.getByText('aisha@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open guest 360' }));
    expect(onOpenFullProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('blocks quick-edit save when the legal names are cleared', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('First name and last name are required')).toBeTruthy();
    expect(mocks.updateGuestMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('saves the full guest payload with only the edited fields changed', async () => {
    const { onSaved } = renderDrawer();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateGuestMutation.mutateAsync).toHaveBeenCalledWith({
      guestId: 7,
      data: expect.objectContaining({
        first_name: 'Aisha',
        last_name: 'Rahman',
        phone: '0999',
        guest_type: 'member',
        tourism_type: 'local',
      }),
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('routes the action rows to the page handlers', () => {
    const props = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
    expect(props.onNewBooking).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete guest' }));
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('hides eKYC and portal-account actions without the permissions', () => {
    renderDrawer({ canCreateEkyc: false, canTransferPortalAccount: false });
    expect(screen.queryByRole('button', { name: 'Create eKYC' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer portal account' })).toBeNull();
  });
});
