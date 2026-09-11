import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('../../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    me: (...args: unknown[]) => mocks.me(...args),
    updateProfile: (...args: unknown[]) => mocks.updateProfile(...args),
  },
}));

import { ProfileSection } from './ProfileSection';

const completeGuest = {
  nick_name: 'Aisyah Rahman',
  first_name: 'Aisyah',
  last_name: 'Rahman',
  email: 'aisyah@example.test',
  phone: '+60123456789',
  ic_number: '900101-14-5566',
  city: 'Kuala Lumpur',
};

describe('ProfileSection', () => {
  beforeEach(() => {
    mocks.me.mockReset();
    mocks.updateProfile.mockReset();
  });

  afterEach(cleanup);

  it('shows the profile the backend holds, including fields the guest cannot edit', async () => {
    mocks.me.mockResolvedValue({ guest: completeGuest, profile_complete: true });

    render(<ProfileSection token="guest-token" />);

    expect(await screen.findByText('Aisyah')).toBeTruthy();
    expect(screen.getByText('Rahman')).toBeTruthy();
    expect(screen.getByText('Kuala Lumpur')).toBeTruthy();
    // Read-only identity fields are displayed but never offered as inputs.
    expect(screen.getByText('aisyah@example.test')).toBeTruthy();
    expect(screen.getByText('900101-14-5566')).toBeTruthy();
    expect(mocks.me).toHaveBeenCalledWith('guest-token');
  });

  it('names the missing fields when the backend says the profile is incomplete', async () => {
    mocks.me.mockResolvedValue({
      guest: { ...completeGuest, last_name: null, phone: null },
      profile_complete: false,
      missing_profile_fields: ['last_name', 'phone'],
    });

    render(<ProfileSection token="guest-token" />);

    const banner = await screen.findByTestId('profile-incomplete');
    expect(banner.textContent).toContain('Last name');
    expect(banner.textContent).toContain('Phone number');
  });

  it('treats an absent completion verdict as complete, so an older backend cannot trap the guest', async () => {
    mocks.me.mockResolvedValue({ guest: completeGuest });

    render(<ProfileSection token="guest-token" />);

    await screen.findByText('Aisyah');
    expect(screen.queryByTestId('profile-incomplete')).toBeNull();
  });

  it('saves edited details and clears the banner from the response, not from what it sent', async () => {
    mocks.me.mockResolvedValue({
      guest: { ...completeGuest, phone: null },
      profile_complete: false,
      missing_profile_fields: ['phone'],
    });
    mocks.updateProfile.mockResolvedValue({
      guest: { ...completeGuest, phone: '+60123456789' },
      profile_complete: true,
      missing_profile_fields: [],
    });

    render(<ProfileSection token="guest-token" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/^Phone number/), {
      target: { value: '+60123456789' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledTimes(1));
    const [payload, token] = mocks.updateProfile.mock.calls[0];
    expect(token).toBe('guest-token');
    expect(payload.phone).toBe('+60123456789');
    expect(payload.first_name).toBe('Aisyah');
    // Empty optional fields are sent as null so the column is cleared rather
    // than filled with an empty string.
    expect(payload.state_province).toBeNull();

    expect(await screen.findByText('Your profile has been saved.')).toBeTruthy();
    expect(screen.queryByTestId('profile-incomplete')).toBeNull();
  });

  it('refuses to submit an invalid phone number and never calls the API', async () => {
    mocks.me.mockResolvedValue({ guest: completeGuest, profile_complete: true });

    render(<ProfileSection token="guest-token" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/^Phone number/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Phone number must be at least 10 digits')).toBeTruthy();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('keeps the form open and shows the reason when the save fails', async () => {
    mocks.me.mockResolvedValue({ guest: completeGuest, profile_complete: true });
    mocks.updateProfile.mockRejectedValue(new Error('Another guest profile already uses this name.'));

    render(<ProfileSection token="guest-token" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Another guest profile already uses this name.')
    ).toBeTruthy();
    // Still editing: the guest needs the field they must change.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });
});
