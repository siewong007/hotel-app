import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPortalToken, setPortalToken } from './portalTokenStore';

const navigate = vi.fn();

vi.mock('../../../router', () => ({
  useNavigate: () => navigate,
}));

import { usePortalSession } from './usePortalSession';

describe('usePortalSession', () => {
  beforeEach(() => {
    navigate.mockReset();
    window.sessionStorage.clear();
  });

  it('exposes a valid guest portal session', () => {
    setPortalToken('guest-token', '2999-01-01T00:00:00Z');

    const { result } = renderHook(() => usePortalSession());

    expect(result.current.token).toBe('guest-token');
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('does not authenticate an expired stored portal token', () => {
    setPortalToken('expired-token', '2000-01-01T00:00:00Z');

    const { result } = renderHook(() => usePortalSession());

    expect(result.current.token).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(getPortalToken()).toBeNull();
  });

  it('clears the guest token and returns to portal sign-in on logout', () => {
    setPortalToken('guest-token', '2999-01-01T00:00:00Z');
    const { result } = renderHook(() => usePortalSession());

    act(() => result.current.logout());

    expect(getPortalToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/portal/login', { replace: true });
  });
});
