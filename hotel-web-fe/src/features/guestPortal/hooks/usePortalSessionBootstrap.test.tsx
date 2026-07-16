import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    user: { user_type: 'guest' as 'admin' | 'guest' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  },
  createSession: vi.fn(),
  logoutPortal: vi.fn(),
  navigate: vi.fn(),
  portalToken: null as string | null,
  setPortalToken: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    createSession: (...args: unknown[]) => mocks.createSession(...args),
  },
}));

vi.mock('../api/portalTokenStore', () => ({
  setPortalToken: (...args: unknown[]) => mocks.setPortalToken(...args),
}));

vi.mock('../api/usePortalSession', () => ({
  usePortalSession: () => ({
    token: mocks.portalToken,
    logout: mocks.logoutPortal,
  }),
}));

import { usePortalSessionBootstrap } from './usePortalSessionBootstrap';

describe('usePortalSessionBootstrap', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.auth.user = { user_type: 'guest' };
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoading = false;
    mocks.auth.logout.mockReset();
    mocks.createSession.mockReset();
    mocks.logoutPortal.mockReset();
    mocks.navigate.mockReset();
    mocks.portalToken = null;
    mocks.setPortalToken.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a portal session for an authenticated guest', async () => {
    mocks.createSession.mockResolvedValue({
      token: 'portal-token',
      expires_at: '2999-01-01T00:00:00Z',
    });

    const { result } = renderHook(() => usePortalSessionBootstrap());

    expect(result.current.status).toBe('opening-portal');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.token).toBe('portal-token');
    expect(mocks.setPortalToken).toHaveBeenCalledWith(
      'portal-token',
      '2999-01-01T00:00:00Z',
    );
  });

  it('flags a signed-in staff account so pages can send it to the admin portal', () => {
    mocks.auth.user = { user_type: 'admin' };

    const { result } = renderHook(() => usePortalSessionBootstrap());

    expect(result.current.isStaffAccount).toBe(true);
    expect(result.current.needsLogin).toBe(false);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('does not restore a portal token without a signed-in guest account', () => {
    mocks.auth.isAuthenticated = false;
    mocks.auth.user = { user_type: 'guest' };
    mocks.portalToken = 'stale-portal-token';

    const { result } = renderHook(() => usePortalSessionBootstrap());

    expect(result.current.token).toBeNull();
    expect(result.current.needsLogin).toBe(true);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('offers a retry after the portal session exchange fails', async () => {
    mocks.createSession
      .mockRejectedValueOnce(new Error('Backend unavailable'))
      .mockResolvedValueOnce({
        token: 'portal-token',
        expires_at: '2999-01-01T00:00:00Z',
      });

    const { result } = renderHook(() => usePortalSessionBootstrap());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.canRetry).toBe(true);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });

  it('stops an account-session check and provides sign-in recovery', async () => {
    vi.useFakeTimers();
    mocks.auth.isLoading = true;

    const { result } = renderHook(() => usePortalSessionBootstrap());

    expect(result.current.status).toBe('checking-account');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('sign in again');

    act(() => result.current.restartSignIn());

    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
    expect(mocks.logoutPortal).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/login?account=guest', {
      replace: true,
    });
  });
});
