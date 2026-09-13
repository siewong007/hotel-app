import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HotelSettings } from '../../../utils/hotelSettings';

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  settingsData: null as HotelSettings | null,
  isPending: false,
  refetch: vi.fn(),
  saveSettings: vi.fn(),
  resetSettings: vi.fn(),
  confirm: vi.fn(),
  onThemeModeChange: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (p: string) => mocks.permissions.has(p) }),
}));

vi.mock('../../../router/ThemeModeContext', () => ({
  useThemeMode: () => ({
    themeMode: 'light',
    onThemeModeChange: mocks.onThemeModeChange,
  }),
}));

// Style-A mocking (HousekeepingPage precedent): replace the query hooks module
// and render bare — no providers needed.
vi.mock('../hooks/useSettingsQueries', () => ({
  useHotelSettingsQuery: () => ({
    data: mocks.settingsData,
    isPending: mocks.isPending,
    refetch: mocks.refetch,
  }),
  useSaveHotelSettingsMutation: () => ({
    mutateAsync: mocks.saveSettings,
    isPending: false,
  }),
  useResetSystemSettingsMutation: () => ({
    mutateAsync: mocks.resetSettings,
    isPending: false,
  }),
}));

// The page asks before resetting a section; tests auto-accept.
vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => mocks.confirm,
}));

import SettingsPage from './SettingsPage';

const baseSettings = (): HotelSettings =>
  ({
    hotel_name: 'Grand Test Hotel',
    hotel_address: '1 Jalan Test',
    hotel_phone: '+603-0000',
    hotel_email: 'frontdesk@example.com',
    check_in_time: '15:00',
    check_out_time: '11:00',
    night_shift_time: '23:00',
    night_audit_auto_enabled: false,
    currency: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    deposit_amount: 50,
    service_tax_rate: 8,
    tourism_tax_rate: 10,
    default_payment_terms_days: 30,
    report_font_size: 14,
    report_font_family: 'Arial, Helvetica, sans-serif',
    report_heading_font_size: 24,
    report_section_heading_font_size: 18,
    report_table_font_size: 14,
    report_caption_font_size: 13,
    report_chip_font_size: 12,
    max_login_attempts: 5,
    totp_issuer_name: '',
    passkey_relying_party_name: '',
    support_enabled: true,
    guest_booking_cancellation_enabled: false,
    support_categories: ['booking', 'stay'],
    support_first_response_low_minutes: 240,
    support_first_response_normal_minutes: 60,
    support_first_response_high_minutes: 15,
    support_first_response_urgent_minutes: 5,
    support_resolution_low_minutes: 1440,
    support_resolution_normal_minutes: 480,
    support_resolution_high_minutes: 120,
    support_resolution_urgent_minutes: 30,
    support_reopen_window_days: 7,
    rate_codes: ['BAR'],
    market_codes: ['OTA'],
    booking_channels: [{ name: 'Booking.com', abbreviation: 'B.C' }],
    payment_methods: ['Cash'],
  }) as unknown as HotelSettings;

describe('SettingsPage', () => {
  beforeEach(() => {
    mocks.permissions = new Set(['settings:update']);
    mocks.settingsData = baseSettings();
    mocks.isPending = false;
    mocks.refetch.mockReset().mockImplementation(async () => ({ data: mocks.settingsData }));
    mocks.saveSettings
      .mockReset()
      .mockImplementation(async (settings: HotelSettings) => ({ settings }));
    mocks.onThemeModeChange.mockReset();
    mocks.resetSettings.mockReset().mockResolvedValue(undefined);
    mocks.confirm.mockReset().mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(cleanup);

  it('renders a spinner while settings are still loading', async () => {
    mocks.isPending = true;

    render(<SettingsPage />);

    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText('Hotel Settings')).toBeNull();
  });

  it('hydrates every card from the fetched settings for an admin', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('Hotel Settings')).toBeTruthy();
    expect((screen.getByLabelText('Hotel Name') as HTMLInputElement).value).toBe(
      'Grand Test Hotel',
    );
    expect((screen.getByLabelText('Hotel Name') as HTMLInputElement).disabled).toBe(false);
    // Booking channels live behind the Code Lists tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Code Lists' }));
    expect(await screen.findByText('Booking.com (B.C)')).toBeTruthy();
  });

  it('saves an edited hotel name through the mutation payload', async () => {
    render(<SettingsPage />);
    await screen.findByText('Hotel Settings');

    fireEvent.change(screen.getByLabelText('Hotel Name'), {
      target: { value: 'Renamed Hotel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Settings/ }));

    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
    const payload = mocks.saveSettings.mock.calls[0][0] as HotelSettings;
    expect(payload.hotel_name).toBe('Renamed Hotel');
    // Untouched fields round-trip unchanged.
    expect(payload.check_in_time).toBe('15:00');
    expect(payload.rate_codes).toEqual(['BAR']);
    expect(await screen.findByText('Settings saved successfully')).toBeTruthy();
  });

  it('surfaces a failed save as an error alert instead of the success banner', async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error('database unreachable'));

    render(<SettingsPage />);
    await screen.findByText('Hotel Settings');

    // An edit is required to arm the save bar — a clean form cannot be saved.
    fireEvent.change(screen.getByLabelText('Hotel Name'), {
      target: { value: 'Edited Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Settings/ }));

    expect(await screen.findByText('database unreachable')).toBeTruthy();
    expect(screen.queryByText('Settings saved successfully')).toBeNull();
  });

  it('disables editable fields and shows the read-only notice for non-admins', async () => {
    mocks.permissions = new Set();

    render(<SettingsPage />);
    await screen.findByText('Hotel Settings');

    expect((screen.getByLabelText('Hotel Name') as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.getByText('Only administrators can modify hotel information'),
    ).toBeTruthy();
    // NOTE: the save bar is not admin-gated client-side (fields are disabled
    // instead); the button intentionally stays clickable and the server
    // enforces permissions.
    expect(screen.getByRole('button', { name: /Save Settings/ })).toBeTruthy();
  });

  it('switches the appearance mode through the theme context', async () => {
    render(<SettingsPage />);
    await screen.findByText('Hotel Settings');

    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    // The toggle button exposes both an aria-label and visible text.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Dark mode' }))[0]);

    expect(mocks.onThemeModeChange).toHaveBeenCalledWith('dark');
  });

  it('reloads settings from the server via Discard changes', async () => {
    render(<SettingsPage />);
    const hotelName = await screen.findByLabelText('Hotel Name');

    fireEvent.change(hotelName, {
      target: { value: 'Discarded Edit' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
    // The refetch response re-applies the stored name over the local edit.
    await waitFor(() =>
      expect((screen.getByLabelText('Hotel Name') as HTMLInputElement).value).toBe(
        'Grand Test Hotel',
      ),
    );
  }, 15_000);
});
