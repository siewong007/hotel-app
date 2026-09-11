import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  deletePasskey: vi.fn(),
  updatePasskey: vi.fn(),
  getTwoFactorStatus: vi.fn(),
  setupTwoFactor: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  registerPasskey: vi.fn(),
  confirm: vi.fn(),
}));

// The section reaches the network only through AuthService; mocking it keeps
// the real query/mutation hooks (useTwoFactorQueries, useProfileQueries) in
// the test rather than stubbing the layer under test.
vi.mock('../../../../api/auth.service', () => ({
  AuthService: {
    listPasskeys: (...args: unknown[]) => mocks.listPasskeys(...args),
    deletePasskey: (...args: unknown[]) => mocks.deletePasskey(...args),
    updatePasskey: (...args: unknown[]) => mocks.updatePasskey(...args),
    getTwoFactorStatus: (...args: unknown[]) => mocks.getTwoFactorStatus(...args),
    setupTwoFactor: (...args: unknown[]) => mocks.setupTwoFactor(...args),
    enableTwoFactor: (...args: unknown[]) => mocks.enableTwoFactor(...args),
    disableTwoFactor: (...args: unknown[]) => mocks.disableTwoFactor(...args),
    regenerateBackupCodes: (...args: unknown[]) => mocks.regenerateBackupCodes(...args),
  },
}));

// AuthProvider would perform a session refresh on mount; the section only needs
// the WebAuthn ceremony and the signed-in username.
vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({
    registerPasskey: (...args: unknown[]) => mocks.registerPasskey(...args),
    user: { username: 'ada.guest', user_type: 'guest' },
  }),
}));

vi.mock('../../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => (...args: unknown[]) => mocks.confirm(...args),
}));

import { SecuritySection } from './SecuritySection';

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SecuritySection />, { wrapper });
}

const passkey = (id: string, deviceName: string) => ({
  id,
  credential_id: `cred-${id}`,
  device_name: deviceName,
  created_at: '2026-07-01',
  last_used_at: undefined,
});

describe('SecuritySection', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listPasskeys.mockResolvedValue([]);
    mocks.getTwoFactorStatus.mockResolvedValue({ enabled: false, backup_codes_remaining: 0 });
    mocks.confirm.mockResolvedValue(true);
    // jsdom has no WebAuthn; without this the section correctly reports the
    // browser as unsupported (asserted in its own test below).
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredentialStub() {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows all three credentials the guest can control', async () => {
    renderSection();

    // The two-factor cards render only once the status query settles; the
    // passkeys card is independent of it.
    expect(await screen.findByRole('region', { name: 'Passkeys' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Authenticator app' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Recovery codes' })).toBeTruthy();
  });

  // Recovery codes are minted by the 2FA enable call and reissued only against
  // a live TOTP code, so offering the button with 2FA off would be a dead end.
  it('does not offer to generate recovery codes before the authenticator app is set up', async () => {
    renderSection();

    expect(await screen.findByText(/recovery codes when you set up an authenticator app/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate new codes' })).toBeNull();
  });

  it('warns when the guest is running low on recovery codes', async () => {
    mocks.getTwoFactorStatus.mockResolvedValue({ enabled: true, backup_codes_remaining: 1 });

    renderSection();

    expect(await screen.findByText(/Only 1 recovery code left/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate new codes' })).toBeTruthy();
  });

  it('tells the guest when every recovery code is spent', async () => {
    mocks.getTwoFactorStatus.mockResolvedValue({ enabled: true, backup_codes_remaining: 0 });

    renderSection();

    expect(await screen.findByText(/used every recovery code/i)).toBeTruthy();
  });

  it('lists saved passkeys', async () => {
    mocks.listPasskeys.mockResolvedValue([passkey('1', 'Ada iPhone'), passkey('2', 'Work laptop')]);

    renderSection();

    expect(await screen.findByText('Ada iPhone')).toBeTruthy();
    expect(screen.getByText('Work laptop')).toBeTruthy();
    expect(screen.getByText('2 saved')).toBeTruthy();
  });

  it('registers a passkey against the signed-in account', async () => {
    mocks.registerPasskey.mockResolvedValue(undefined);

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));

    await waitFor(() => expect(mocks.registerPasskey).toHaveBeenCalledWith('ada.guest'));
  });

  // The backend refuses an eleventh passkey, so the UI must not invite one.
  it('stops at the passkey limit the API enforces', async () => {
    mocks.listPasskeys.mockResolvedValue(
      Array.from({ length: 10 }, (_unused, index) => passkey(String(index), `Device ${index}`)),
    );

    renderSection();

    await screen.findByText('Device 0');
    expect(screen.getByRole('button', { name: 'Add a passkey' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/maximum of 10 passkeys/i)).toBeTruthy();
  });

  it('explains itself instead of failing when the browser has no WebAuthn', async () => {
    vi.unstubAllGlobals();

    renderSection();

    expect(await screen.findByText(/does not support passkeys/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a passkey' }).hasAttribute('disabled')).toBe(true);
  });

  it('removes a passkey only after the guest confirms', async () => {
    mocks.listPasskeys.mockResolvedValue([passkey('1', 'Ada iPhone')]);
    mocks.confirm.mockResolvedValue(false);

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ada iPhone' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.deletePasskey).not.toHaveBeenCalled();
  });

  // The API returns the codes in plaintext exactly once, so this dialog is the
  // guest's only chance to save them.
  it('shows the recovery codes once, after the authenticator app is enabled', async () => {
    mocks.setupTwoFactor.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qr_code_url: 'otpauth://totp/Hotel:ada?secret=JBSWY3DPEHPK3PXP',
      challenge_code: 'challenge-1',
    });
    mocks.enableTwoFactor.mockResolvedValue({ message: 'ok', backup_codes: ['AAAA-1111', 'BBBB-2222'] });

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));

    const codeField = await screen.findByLabelText('6-digit code');
    fireEvent.change(codeField, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText('AAAA-1111')).toBeTruthy();
    expect(screen.getByText('BBBB-2222')).toBeTruthy();
    await waitFor(() =>
      expect(mocks.enableTwoFactor).toHaveBeenCalledWith('123456', 'challenge-1'),
    );
  });

  // The secret must never reach a third-party QR service: the code is drawn
  // in-page from the otpauth URI.
  it('draws the setup QR code locally rather than loading a remote image', async () => {
    mocks.setupTwoFactor.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qr_code_url: 'otpauth://totp/Hotel:ada?secret=JBSWY3DPEHPK3PXP',
      challenge_code: 'challenge-1',
    });

    const { container } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));

    await screen.findByText('JBSWY3DPEHPK3PXP');
    expect(container.ownerDocument.querySelector('svg[height="200"]')).toBeTruthy();
    expect(container.ownerDocument.querySelector('img[src*="chart.googleapis"]')).toBeNull();
  });

  it('requires a fresh code before replacing the recovery codes', async () => {
    mocks.getTwoFactorStatus.mockResolvedValue({ enabled: true, backup_codes_remaining: 8 });
    mocks.regenerateBackupCodes.mockResolvedValue({ backup_codes: ['CCCC-3333'] });

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate new codes' }));

    const generate = await screen.findByRole('button', { name: 'Generate' });
    expect(generate.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.regenerateBackupCodes).toHaveBeenCalledWith('654321'));
    expect(await screen.findByText('CCCC-3333')).toBeTruthy();
  });

  it('surfaces a failed load instead of showing an empty, working-looking panel', async () => {
    mocks.getTwoFactorStatus.mockRejectedValue(new Error('boom'));

    renderSection();

    expect(await screen.findByText('We could not load your two-factor settings.')).toBeTruthy();
  });
});
