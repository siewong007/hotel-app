import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      put: (...args: any[]) => put(...args),
      post: (...args: any[]) => post(...args),
    },
  };
});

import { PaymentApprovalsService } from './paymentApprovals.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Read the searchParams object passed to the most recent api.get call. */
function lastGetSearchParams(): Record<string, any> {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams ?? {};
}

function resetMocks() {
  get.mockReset();
  put.mockReset();
  post.mockReset();
}

describe('PaymentApprovalsService.listPending', () => {
  beforeEach(resetMocks);

  it('GETs admin/payments/pending with no searchParams when no params given', async () => {
    get.mockReturnValue(mockJsonResponse({ payments: [], total: 0 }));

    await PaymentApprovalsService.listPending();

    expect(get).toHaveBeenCalledWith('admin/payments/pending', { searchParams: {} });
  });

  it('forwards page and perPage as page / per_page strings', async () => {
    get.mockReturnValue(mockJsonResponse({ payments: [], total: 0 }));

    await PaymentApprovalsService.listPending({ page: 2, perPage: 10 });

    expect(lastGetSearchParams()).toEqual({ page: '2', per_page: '10' });
  });
});

describe('PaymentApprovalsService.approve', () => {
  beforeEach(resetMocks);

  it('PUTs admin/payments/<id>/approve and returns the unwrapped response', async () => {
    const payload = { success: true, message: 'Approved' };
    put.mockReturnValue(mockJsonResponse(payload));

    const result = await PaymentApprovalsService.approve(5);

    expect(put).toHaveBeenCalledWith('admin/payments/5/approve');
    expect(result).toEqual(payload);
  });
});

describe('PaymentApprovalsService.listHistory', () => {
  beforeEach(resetMocks);

  it('GETs admin/payments/history with no searchParams when no params given', async () => {
    get.mockReturnValue(mockJsonResponse({ payments: [], total: 0 }));

    await PaymentApprovalsService.listHistory();

    expect(get).toHaveBeenCalledWith('admin/payments/history', { searchParams: {} });
  });

  it('forwards page and perPage as page / per_page strings', async () => {
    get.mockReturnValue(mockJsonResponse({ payments: [], total: 0 }));

    await PaymentApprovalsService.listHistory({ page: 3, perPage: 20 });

    expect(lastGetSearchParams()).toEqual({ page: '3', per_page: '20' });
  });
});

describe('PaymentApprovalsService.downloadReceipt', () => {
  beforeEach(resetMocks);

  it('GETs admin/payments/<id>/receipt and returns the blob', async () => {
    const blob = new Blob(['pdf-bytes']);
    get.mockReturnValue({ blob: () => Promise.resolve(blob) });

    const result = await PaymentApprovalsService.downloadReceipt(9);

    expect(get).toHaveBeenCalledWith('admin/payments/9/receipt');
    expect(result).toBe(blob);
  });
});

describe('PaymentApprovalsService.reject', () => {
  beforeEach(resetMocks);

  it('PUTs admin/payments/<id>/reject with the reason as json', async () => {
    const payload = { success: true, message: 'Rejected' };
    put.mockReturnValue(mockJsonResponse(payload));

    const result = await PaymentApprovalsService.reject(9, 'Insufficient proof');

    expect(put).toHaveBeenCalledWith('admin/payments/9/reject', {
      json: { reason: 'Insufficient proof' },
    });
    expect(result).toEqual(payload);
  });
});

describe('PaymentApprovalsService.requestReceipt', () => {
  beforeEach(resetMocks);

  it('POSTs the trimmed message when provided', async () => {
    post.mockReturnValue(mockJsonResponse(undefined));

    await PaymentApprovalsService.requestReceipt(9, '  please resend  ');

    expect(post).toHaveBeenCalledWith('admin/payments/9/request-receipt', {
      json: { message: 'please resend' },
    });
  });

  it('sends null when no message is given', async () => {
    post.mockReturnValue(mockJsonResponse(undefined));

    await PaymentApprovalsService.requestReceipt(9);

    expect(post).toHaveBeenCalledWith('admin/payments/9/request-receipt', {
      json: { message: null },
    });
  });

  it('sends null when the message is only whitespace', async () => {
    post.mockReturnValue(mockJsonResponse(undefined));

    await PaymentApprovalsService.requestReceipt(9, '   ');

    expect(post).toHaveBeenCalledWith('admin/payments/9/request-receipt', {
      json: { message: null },
    });
  });
});
