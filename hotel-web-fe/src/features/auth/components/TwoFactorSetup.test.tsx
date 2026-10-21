import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  setup: vi.fn(),
  enable: vi.fn(),
}));
vi.mock('../../../api/auth.service', () => ({
  AuthService: {
    getTwoFactorStatus: (...args: unknown[]) => mocks.status(...args),
    setupTwoFactor: (...args: unknown[]) => mocks.setup(...args),
    enableTwoFactor: (...args: unknown[]) => mocks.enable(...args),
  },
}));
import TwoFactorSetup from './TwoFactorSetup';

function renderSetup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}><TwoFactorSetup /></QueryClientProvider>);
  return client;
}

describe('TwoFactorSetup password verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockResolvedValue({ enabled: false, backup_codes_remaining: 0 });
    mocks.setup.mockResolvedValue({ secret: 'secret', qr_code_url: 'otpauth://totp/test', challenge_code: 'challenge' });
    mocks.enable.mockResolvedValue({ message: 'ok', backup_codes: ['AAAA-BBBB'] });
  });
  afterEach(cleanup);

  it('requires the existing password for both enrollment steps and clears it after success', async () => {
    const client = renderSetup();
    const setup = await screen.findByRole('button', { name: 'Set Up 2FA' });
    expect(setup.hasAttribute('disabled')).toBe(true);
    fireEvent.click(setup);
    expect(mocks.setup).not.toHaveBeenCalled();
    const password = screen.getByLabelText('Current Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: ' current password ' } });
    fireEvent.click(setup);
    fireEvent.change(await screen.findByLabelText('Verification Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable 2FA' }));
    expect(await screen.findByText('AAAA-BBBB')).toBeTruthy();
    expect(mocks.setup).toHaveBeenCalledWith(' current password ', undefined);
    expect(mocks.enable).toHaveBeenCalledWith('123456', 'challenge', ' current password ', undefined);
    expect(password.value).toBe('');
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });

  it('clears the password when setup is cancelled', async () => {
    const client = renderSetup();
    const setup = await screen.findByRole('button', { name: 'Set Up 2FA' });
    const password = screen.getByLabelText('Current Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'current password' } });
    fireEvent.click(setup);
    await screen.findByLabelText('Verification Code');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(password.value).toBe('');
    expect(setup.hasAttribute('disabled')).toBe(true);
    expect(mocks.enable).not.toHaveBeenCalled();
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});
