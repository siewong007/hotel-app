import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      patch: (...args: any[]) => patch(...args),
    },
  };
});

import { MaintenanceService } from './maintenance.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Read the searchParams object passed to the most recent api.get call. */
function lastGetSearchParams(): Record<string, any> {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams ?? {};
}

describe('MaintenanceService.listTickets', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  it('calls GET maintenance forwarding filter params as searchParams', async () => {
    get.mockReturnValue(
      mockJsonResponse({ items: [], total: 0, page: 1, page_size: 50 }),
    );

    await MaintenanceService.listTickets({ status: 'open', category: 'plumbing' });

    expect(get).toHaveBeenCalledWith('maintenance', expect.anything());
    expect(lastGetSearchParams()).toMatchObject({ status: 'open', category: 'plumbing' });
  });
});

describe('MaintenanceService.createTicket', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  it('posts the input as json to maintenance', async () => {
    const input = { title: 'Leaky faucet', category: 'plumbing' as const };
    post.mockReturnValue(mockJsonResponse({ id: 1 }));

    await MaintenanceService.createTicket(input);

    expect(post).toHaveBeenCalledWith('maintenance', { json: input });
  });
});

describe('MaintenanceService.updateTicket', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  it('patches maintenance/<id> with the input as json', async () => {
    const input = { status: 'in_progress' as const };
    patch.mockReturnValue(mockJsonResponse({ id: 42 }));

    await MaintenanceService.updateTicket(42, input);

    expect(patch).toHaveBeenCalledWith('maintenance/42', { json: input });
  });
});
