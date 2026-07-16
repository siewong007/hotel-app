import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const deleteRequest = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => deleteRequest(...args),
  },
}));

import { CommunicationsApi } from './communicationsApi';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

function latestSearchParams(mock: ReturnType<typeof vi.fn>): URLSearchParams {
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  return call[1].searchParams as URLSearchParams;
}

describe('CommunicationsApi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    deleteRequest.mockReset();
  });

  it('serializes meaningful campaign filters and omits empty values', async () => {
    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 2, page_size: 25 }));

    await CommunicationsApi.listCampaigns({
      status: 'draft',
      campaign_type: 'announcement',
      page: 2,
      page_size: 25,
    });

    expect(get).toHaveBeenCalledWith('admin/communications/campaigns', expect.anything());
    expect(Object.fromEntries(latestSearchParams(get))).toEqual({
      status: 'draft',
      campaign_type: 'announcement',
      page: '2',
      page_size: '25',
    });

    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 25 }));
    await CommunicationsApi.listCampaigns({ status: '', campaign_type: undefined });
    expect(Object.fromEntries(latestSearchParams(get))).toEqual({});
  });

  it('sends campaign actions and delivery pagination to their dedicated endpoints', async () => {
    post.mockReturnValue(jsonResponse({ status: 'queued' }));
    get.mockReturnValue(jsonResponse({ items: [], total: 0, page: 3, page_size: 10 }));

    await CommunicationsApi.testSendCampaign(17, 'tester@example.com');
    await CommunicationsApi.scheduleCampaign(17);
    await CommunicationsApi.scheduleCampaign(17, '2026-07-17T09:00:00Z');
    await CommunicationsApi.listDeliveries(17, 3, 10);

    expect(post).toHaveBeenNthCalledWith(1, 'admin/communications/campaigns/17/test-send', {
      json: { recipient_email: 'tester@example.com' },
    });
    expect(post).toHaveBeenNthCalledWith(2, 'admin/communications/campaigns/17/schedule', {
      json: { scheduled_at: null },
    });
    expect(post).toHaveBeenNthCalledWith(3, 'admin/communications/campaigns/17/schedule', {
      json: { scheduled_at: '2026-07-17T09:00:00Z' },
    });
    expect(get).toHaveBeenCalledWith(
      'admin/communications/campaigns/17/deliveries',
      expect.anything()
    );
    expect(Object.fromEntries(latestSearchParams(get))).toEqual({ page: '3', page_size: '10' });
  });

  it('encodes suppression addresses and preserves the staff consent payload', async () => {
    deleteRequest.mockReturnValue(jsonResponse({ status: 'removed' }));
    post.mockReturnValue(jsonResponse({ subscriptions: [], events: [] }));

    await CommunicationsApi.removeSuppression('guest+promo@example.com');
    await CommunicationsApi.recordStaffConsent(42, {
      subscriptions: [{ topic: 'promotion', subscribed: true }],
      policy_version: '2026-07',
    });

    expect(deleteRequest).toHaveBeenCalledWith(
      'admin/communications/suppressions/guest%2Bpromo%40example.com'
    );
    expect(post).toHaveBeenCalledWith('admin/communications/guests/42/consent', {
      json: {
        subscriptions: [{ topic: 'promotion', subscribed: true }],
        policy_version: '2026-07',
      },
    });
  });
});
