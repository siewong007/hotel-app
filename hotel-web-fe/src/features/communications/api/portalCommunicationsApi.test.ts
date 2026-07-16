import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const put = vi.fn();
const getPortalToken = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

vi.mock('../../guestPortal/api/portalTokenStore', () => ({
  getPortalToken: () => getPortalToken(),
}));

import { PortalCommunicationsApi } from './portalCommunicationsApi';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

describe('PortalCommunicationsApi', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    getPortalToken.mockReset();
  });

  it('uses an explicitly supplied portal token without reading storage', async () => {
    get.mockReturnValue(jsonResponse({ subscriptions: [] }));

    await PortalCommunicationsApi.getPreferences('guest-token-a');

    expect(get).toHaveBeenCalledWith('guest-portal/me/notification-preferences', {
      headers: { Authorization: 'Bearer guest-token-a' },
    });
    expect(getPortalToken).not.toHaveBeenCalled();
  });

  it('falls back to the stored portal token when updating preferences', async () => {
    getPortalToken.mockReturnValue('stored-guest-token');
    put.mockReturnValue(jsonResponse({ subscriptions: [] }));
    const input = {
      subscriptions: [{ topic: 'birthday_voucher' as const, subscribed: true }],
      policy_version: '2026-07',
    };

    await PortalCommunicationsApi.updatePreferences(input);

    expect(put).toHaveBeenCalledWith('guest-portal/me/notification-preferences', {
      headers: { Authorization: 'Bearer stored-guest-token' },
      json: input,
    });
  });

  it('does not issue an unauthenticated guest-portal request', () => {
    getPortalToken.mockReturnValue(null);

    expect(() => PortalCommunicationsApi.getPreferences()).toThrow(
      'Sign in to the guest portal to continue'
    );
    expect(get).not.toHaveBeenCalled();
  });
});
