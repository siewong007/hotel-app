import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
    },
  };
});

import { ReportsService } from './reports.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Read the searchParams (a real URLSearchParams instance) passed to the most recent api.get call. */
function lastGetSearchParams(): URLSearchParams {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams as URLSearchParams;
}

function resetMocks() {
  get.mockReset();
  post.mockReset();
  put.mockReset();
}

describe('ReportsService.generateReport', () => {
  beforeEach(resetMocks);

  it('forwards only the required params when no optional fields are given', async () => {
    get.mockReturnValue(mockJsonResponse({ rows: [] }));

    await ReportsService.generateReport({
      reportType: 'shift-summary',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(get).toHaveBeenCalledWith('reports/generate', expect.anything());
    const params = lastGetSearchParams();
    expect(params.get('report_type')).toBe('shift-summary');
    expect(params.get('start_date')).toBe('2026-01-01');
    expect(params.get('end_date')).toBe('2026-01-31');
    expect(params.has('shift')).toBe(false);
    expect(params.has('drawer')).toBe(false);
    expect(params.has('company_name')).toBe(false);
    expect(params.has('booking_channel_id')).toBe(false);
    expect(params.has('booking_channel')).toBe(false);
    expect(params.has('platform_name')).toBe(false);
    expect(params.has('booking_status')).toBe(false);
    expect(params.has('posted_status')).toBe(false);
    expect(params.has('room_type')).toBe(false);
  });

  it('forwards every optional field when provided', async () => {
    get.mockReturnValue(mockJsonResponse({ rows: [] }));

    await ReportsService.generateReport({
      reportType: 'shift-summary',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      shift: 'night',
      drawer: 'D1',
      companyName: 'Acme Corp',
      bookingChannelId: 3,
      bookingChannel: 'direct',
      platformName: 'Booking.com',
      bookingStatus: 'confirmed',
      postedStatus: 'posted',
      roomType: 'deluxe',
    });

    const params = lastGetSearchParams();
    expect(params.get('shift')).toBe('night');
    expect(params.get('drawer')).toBe('D1');
    expect(params.get('company_name')).toBe('Acme Corp');
    expect(params.get('booking_channel_id')).toBe('3');
    expect(params.get('booking_channel')).toBe('direct');
    expect(params.get('platform_name')).toBe('Booking.com');
    expect(params.get('booking_status')).toBe('confirmed');
    expect(params.get('posted_status')).toBe('posted');
    expect(params.get('room_type')).toBe('deluxe');
  });

  it('returns the unwrapped JSON response', async () => {
    const payload = { rows: [{ id: 1 }] };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await ReportsService.generateReport({
      reportType: 'shift-summary',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(result).toEqual(payload);
  });
});

describe('ReportsService.listBookingChannels', () => {
  beforeEach(resetMocks);

  it('GETs booking-channels and returns the list', async () => {
    const payload = [{ id: 1, name: 'Direct' }];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await ReportsService.listBookingChannels();

    expect(get).toHaveBeenCalledWith('booking-channels');
    expect(result).toEqual(payload);
  });
});

describe('ReportsService.createBookingChannel', () => {
  beforeEach(resetMocks);

  it('POSTs the input as json to booking-channels', async () => {
    const input = { name: 'OTA Partner', channel_type: 'ota' };
    const payload = { id: 5, ...input };
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await ReportsService.createBookingChannel(input);

    expect(post).toHaveBeenCalledWith('booking-channels', { json: input });
    expect(result).toEqual(payload);
  });
});

describe('ReportsService.updateBookingChannel', () => {
  beforeEach(resetMocks);

  it('PUTs booking-channels/<id> with the input as json', async () => {
    const input = { name: 'Updated Name' };
    const payload = { id: 5, name: 'Updated Name' };
    put.mockReturnValue(mockJsonResponse(payload));

    const result = await ReportsService.updateBookingChannel(5, input);

    expect(put).toHaveBeenCalledWith('booking-channels/5', { json: input });
    expect(result).toEqual(payload);
  });
});

describe('ReportsService.downloadReportPDF', () => {
  beforeEach(resetMocks);

  it('forwards required params and returns the blob', async () => {
    const blob = new Blob(['pdf-bytes']);
    get.mockReturnValue({ blob: () => Promise.resolve(blob) });

    const result = await ReportsService.downloadReportPDF({
      reportType: 'shift-summary',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(get).toHaveBeenCalledWith('reports/pdf', expect.anything());
    const params = lastGetSearchParams();
    expect(params.get('report_type')).toBe('shift-summary');
    expect(params.has('shift')).toBe(false);
    expect(result).toBe(blob);
  });

  it('forwards optional shift, drawer and companyName when provided', async () => {
    get.mockReturnValue({ blob: () => Promise.resolve(new Blob()) });

    await ReportsService.downloadReportPDF({
      reportType: 'shift-summary',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      shift: 'day',
      drawer: 'D2',
      companyName: 'Acme Corp',
    });

    const params = lastGetSearchParams();
    expect(params.get('shift')).toBe('day');
    expect(params.get('drawer')).toBe('D2');
    expect(params.get('company_name')).toBe('Acme Corp');
  });
});
