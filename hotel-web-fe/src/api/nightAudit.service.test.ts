import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
    },
  };
});

import { NightAuditService } from './nightAudit.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Read the searchParams object passed to the most recent api.get call. */
function lastGetSearchParams(): Record<string, any> {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams ?? {};
}

describe('NightAuditService.getPreview', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('GETs night-audit/preview with the date as a query string', async () => {
    const payload = { audit_date: '2026-01-15', bookings_to_post: [] };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await NightAuditService.getPreview('2026-01-15');

    expect(get).toHaveBeenCalledWith('night-audit/preview?date=2026-01-15');
    expect(result).toEqual(payload);
  });
});

describe('NightAuditService.runNightAudit', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('POSTs the request body to night-audit/run', async () => {
    const request = { audit_date: '2026-01-15', notes: 'closing', force: false };
    const payload = { success: true, audit_run: { id: 1 }, message: 'done' };
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await NightAuditService.runNightAudit(request);

    expect(post).toHaveBeenCalledWith('night-audit/run', { json: request });
    expect(result).toEqual(payload);
  });
});

describe('NightAuditService.listNightAudits', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('defaults to page 1 / page_size 50 when no params are given', async () => {
    get.mockReturnValue(mockJsonResponse({ data: [], total: 0, page: 1, page_size: 50 }));

    await NightAuditService.listNightAudits();

    expect(get).toHaveBeenCalledWith('night-audit', expect.anything());
    expect(lastGetSearchParams()).toEqual({ page: '1', page_size: '50' });
  });

  it('forwards page and pageSize as strings', async () => {
    get.mockReturnValue(mockJsonResponse({ data: [], total: 0, page: 2, page_size: 25 }));

    await NightAuditService.listNightAudits({ page: 2, pageSize: 25 });

    expect(lastGetSearchParams()).toEqual({ page: '2', page_size: '25' });
  });

  it('forwards year and month when provided', async () => {
    get.mockReturnValue(mockJsonResponse({ data: [], total: 0, page: 1, page_size: 50 }));

    await NightAuditService.listNightAudits({ year: 2026, month: 7 });

    expect(lastGetSearchParams()).toEqual({
      page: '1',
      page_size: '50',
      year: '2026',
      month: '7',
    });
  });

  it('omits year and month when not provided', async () => {
    get.mockReturnValue(mockJsonResponse({ data: [], total: 0, page: 1, page_size: 50 }));

    await NightAuditService.listNightAudits({});

    const params = lastGetSearchParams();
    expect(params).not.toHaveProperty('year');
    expect(params).not.toHaveProperty('month');
  });
});

describe('NightAuditService.getNightAudit', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('GETs night-audit/<id>', async () => {
    const payload = { id: 7, audit_date: '2026-01-15' };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await NightAuditService.getNightAudit(7);

    expect(get).toHaveBeenCalledWith('night-audit/7');
    expect(result).toEqual(payload);
  });
});

describe('NightAuditService.isBookingPosted', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('GETs bookings/<id>/posted', async () => {
    const payload = { booking_id: 42, is_posted: true };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await NightAuditService.isBookingPosted(42);

    expect(get).toHaveBeenCalledWith('bookings/42/posted');
    expect(result).toEqual(payload);
  });
});

describe('NightAuditService.getAuditDetails', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('GETs night-audit/<id>/details', async () => {
    const payload = { audit_run: { id: 7 }, posted_bookings: [] };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await NightAuditService.getAuditDetails(7);

    expect(get).toHaveBeenCalledWith('night-audit/7/details');
    expect(result).toEqual(payload);
  });
});
