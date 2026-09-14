import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserProfile } from '../../../types';

const mocks = vi.hoisted(() => ({
  profile: {
    data: undefined as UserProfile | undefined,
    isPending: false,
    isError: false,
  },
  passkeys: { data: [] as unknown[] },
  sessions: { data: [] as unknown[] },
}));

const emptyMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };

vi.mock('../../../router', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { id: '1', username: 'reception' } }),
}));

vi.mock('../hooks/useProfileQueries', () => ({
  useProfileQuery: () => mocks.profile,
  usePasskeysQuery: () => mocks.passkeys,
  useSessionsQuery: () => mocks.sessions,
  useUpdateProfileMutation: () => emptyMutation,
  useUpdatePasswordMutation: () => emptyMutation,
  useDeletePasskeyMutation: () => emptyMutation,
  useRenamePasskeyMutation: () => emptyMutation,
  useRegisterPasskeyMutation: () => emptyMutation,
  useRevokeSessionMutation: () => emptyMutation,
}));

vi.mock('../../auth/components/TwoFactorSetup', () => ({
  default: () => <div data-testid="twofactor-setup" />,
}));

import UserProfilePage from './UserProfilePage';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserProfilePage />
    </QueryClientProvider>,
  );
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const profile: UserProfile = {
  id: 1,
  username: 'reception',
  email: 'desk@hotel.test',
  email_configured: true,
  is_verified: true,
  user_type: 'staff',
  full_name: 'Front Desk',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('UserProfilePage', () => {
  beforeEach(() => {
    mocks.profile = { data: profile, isPending: false, isError: false };
    mocks.passkeys = { data: [] };
    mocks.sessions = { data: [] };
  });

  afterEach(cleanup);

  it('renders the profile tabs', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Profile/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Passkeys/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Devices/i })).toBeTruthy();
  });

  it('shows an error when the profile fails to load', () => {
    mocks.profile = { data: undefined, isPending: false, isError: true };
    renderPage();
    expect(screen.getByText(/Failed to load user profile/)).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});
