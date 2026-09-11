import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  confirm: vi.fn(),
}));

// The section reaches the network only through AuthService, so the real
// query/mutation hooks stay in the test rather than being stubbed out.
vi.mock('../../../../api/auth.service', () => ({
  AuthService: {
    listSessions: (...args: unknown[]) => mocks.listSessions(...args),
    revokeSession: (...args: unknown[]) => mocks.revokeSession(...args),
  },
}));

vi.mock('../../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => (...args: unknown[]) => mocks.confirm(...args),
}));

import { DevicesSection } from './DevicesSection';

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<DevicesSection />, { wrapper });
}

const session = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  user_agent: 'MacBook Pro',
  ip_address: '203.0.113.•••',
  created_at: '2026-09-01T10:00:00Z',
  last_used_at: '2026-09-02T10:00:00Z',
  expires_at: '2026-10-01T10:00:00Z',
  is_current: false,
  location: 'Kuala Lumpur',
  timezone: 'Asia/Kuala_Lumpur',
  ...overrides,
});

describe('DevicesSection', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  afterEach(cleanup);

  it('lists each signed-in device with its approximate location', async () => {
    mocks.listSessions.mockResolvedValue([session()]);

    renderSection();

    // Asserted on the device's own line, not the section blurb (which also
    // says "approximate"): the qualifier has to travel with the value.
    const line = await screen.findByText(/Last active:/);
    expect(line.textContent).toContain('Kuala Lumpur');
    expect(line.textContent).toContain('approximate');
  });

  it('renders a session that carries no location without a dangling separator', async () => {
    mocks.listSessions.mockResolvedValue([
      session({ location: null, timezone: null }),
    ]);

    renderSection();

    const line = await screen.findByText(/Last active:/);
    expect(line.textContent).not.toContain('approximate');
    expect(line.textContent).not.toContain('·');
  });

  it('marks the current device and offers no sign-out control for it', async () => {
    mocks.listSessions.mockResolvedValue([session({ is_current: true })]);

    renderSection();

    expect(await screen.findByText('This device')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('revokes a device once the guest confirms', async () => {
    mocks.listSessions.mockResolvedValue([session({ id: 'other-session' })]);
    mocks.confirm.mockResolvedValue(true);
    mocks.revokeSession.mockResolvedValue(undefined);

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(mocks.revokeSession).toHaveBeenCalledWith('other-session'));
  });

  it('does not revoke anything when the guest cancels the confirmation', async () => {
    mocks.listSessions.mockResolvedValue([session({ id: 'other-session' })]);
    mocks.confirm.mockResolvedValue(false);

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });
});
