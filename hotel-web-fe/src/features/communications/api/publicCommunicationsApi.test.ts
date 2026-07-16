import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { PublicCommunicationsApi } from './publicCommunicationsApi';

function jsonResponse<T>(value: T) {
  return { json: vi.fn().mockResolvedValue(value) };
}

describe('PublicCommunicationsApi', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('uses root-absolute, token-encoded paths for the public preferences view', async () => {
    get.mockReturnValue(jsonResponse({ subscriptions: [] }));

    await PublicCommunicationsApi.view('signed/token?one');

    expect(get).toHaveBeenCalledWith('/communications/unsubscribe/signed%2Ftoken%3Fone');
  });

  it('keeps per-topic and global unsubscribe payloads distinct', async () => {
    post.mockReturnValue(jsonResponse({ subscriptions: [] }));

    await PublicCommunicationsApi.unsubscribeTopic('signed-token', 'promotion');
    await PublicCommunicationsApi.unsubscribeAll('signed-token');

    expect(post).toHaveBeenNthCalledWith(1, '/communications/unsubscribe/signed-token', {
      json: { topic: 'promotion' },
    });
    expect(post).toHaveBeenNthCalledWith(2, '/communications/unsubscribe/signed-token', {
      json: { global: true },
    });
  });
});
