import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { get: (...args: any[]) => get(...args) },
  };
});

// downloadPDF pulls jspdf/jspdf-autotable in dynamically — stub both so the
// test never touches real canvas/PDF rendering (unsupported in jsdom).
const jsPdfSave = vi.fn();
const jsPdfSetFontSize = vi.fn();
const jsPdfText = vi.fn();
vi.mock('jspdf', () => ({
  // `new jsPDF()` requires a real constructor — an arrow-function
  // implementation has no [[Construct]] and throws "is not a constructor".
  jsPDF: vi.fn(function mockJsPdf() {
    return {
      setFontSize: jsPdfSetFontSize,
      text: jsPdfText,
      save: jsPdfSave,
    };
  }),
}));
const autoTableMock = vi.fn();
vi.mock('jspdf-autotable', () => ({
  default: (...args: any[]) => autoTableMock(...args),
}));

import { AuditService } from './audit.service';
import type { AuditLogResponse } from '../types/audit.types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

function mockBlobResponse(blob: Blob) {
  return { blob: () => Promise.resolve(blob) };
}

function buildLogResponse(overrides: Partial<AuditLogResponse> = {}): AuditLogResponse {
  return {
    data: [],
    total: 0,
    page: 1,
    page_size: 50,
    total_pages: 0,
    ...overrides,
  };
}

describe('AuditService', () => {
  beforeEach(() => {
    get.mockReset();
    jsPdfSave.mockReset();
    jsPdfSetFontSize.mockReset();
    jsPdfText.mockReset();
    autoTableMock.mockReset();
  });

  describe('getAuditLogs', () => {
    it('calls GET audit-logs with no query string when no params are given', async () => {
      get.mockReturnValue(mockJsonResponse(buildLogResponse()));

      await AuditService.getAuditLogs();

      expect(get).toHaveBeenCalledWith('audit-logs');
    });

    it('builds the query string from every provided filter, in field order', async () => {
      get.mockReturnValue(mockJsonResponse(buildLogResponse()));

      await AuditService.getAuditLogs({
        user_id: 7,
        action: 'update',
        resource_type: 'bookings',
        category: 'bookings',
        start_date: '2026-07-01',
        end_date: '2026-07-26',
        search: 'smith',
        page: 2,
        page_size: 25,
        sort_by: 'created_at',
        sort_order: 'desc',
      });

      expect(get).toHaveBeenCalledWith(
        'audit-logs?user_id=7&action=update&resource_type=bookings&category=bookings' +
          '&start_date=2026-07-01&end_date=2026-07-26&search=smith&page=2&page_size=25' +
          '&sort_by=created_at&sort_order=desc',
      );
    });

    it('returns the response unwrapped', async () => {
      const response = buildLogResponse({ total: 3 });
      get.mockReturnValue(mockJsonResponse(response));

      const result = await AuditService.getAuditLogs();

      expect(result).toEqual(response);
    });
  });

  describe('getCategoryCounts', () => {
    it('calls GET audit-logs/category-counts with no query string when no params are given', async () => {
      get.mockReturnValue(mockJsonResponse({ rooms: 0, guests: 0, bookings: 0, system: 0, reports: 0, other: 0, total: 0 }));

      await AuditService.getCategoryCounts();

      expect(get).toHaveBeenCalledWith('audit-logs/category-counts');
    });

    it('only forwards start_date, end_date and search — ignores unrelated fields', async () => {
      get.mockReturnValue(mockJsonResponse({ rooms: 0, guests: 0, bookings: 0, system: 0, reports: 0, other: 0, total: 0 }));

      await AuditService.getCategoryCounts({
        start_date: '2026-07-01',
        end_date: '2026-07-26',
        search: 'smith',
        user_id: 7,
        action: 'update',
      } as any);

      expect(get).toHaveBeenCalledWith(
        'audit-logs/category-counts?start_date=2026-07-01&end_date=2026-07-26&search=smith',
      );
    });
  });

  describe('getAuditActions', () => {
    it('calls GET audit-logs/actions', async () => {
      get.mockReturnValue(mockJsonResponse(['create', 'update']));

      const result = await AuditService.getAuditActions();

      expect(get).toHaveBeenCalledWith('audit-logs/actions');
      expect(result).toEqual(['create', 'update']);
    });
  });

  describe('getAuditResourceTypes', () => {
    it('calls GET audit-logs/resource-types', async () => {
      get.mockReturnValue(mockJsonResponse(['bookings', 'rooms']));

      const result = await AuditService.getAuditResourceTypes();

      expect(get).toHaveBeenCalledWith('audit-logs/resource-types');
      expect(result).toEqual(['bookings', 'rooms']);
    });
  });

  describe('getAuditUsers', () => {
    it('calls GET audit-logs/users', async () => {
      const users = [{ id: 1, username: 'admin' }];
      get.mockReturnValue(mockJsonResponse(users));

      const result = await AuditService.getAuditUsers();

      expect(get).toHaveBeenCalledWith('audit-logs/users');
      expect(result).toEqual(users);
    });
  });

  describe('exportCSV', () => {
    it('calls GET audit-logs/export/csv with no query string when no params are given', async () => {
      const blob = new Blob(['csv']);
      get.mockReturnValue(mockBlobResponse(blob));

      const result = await AuditService.exportCSV();

      expect(get).toHaveBeenCalledWith('audit-logs/export/csv');
      expect(result).toBe(blob);
    });

    it('forwards only user_id/action/resource_type/category/start_date/end_date/search — not page or sort', async () => {
      const blob = new Blob(['csv']);
      get.mockReturnValue(mockBlobResponse(blob));

      await AuditService.exportCSV({
        user_id: 7,
        action: 'update',
        resource_type: 'bookings',
        category: 'bookings',
        start_date: '2026-07-01',
        end_date: '2026-07-26',
        search: 'smith',
        page: 2,
        sort_by: 'created_at',
      });

      expect(get).toHaveBeenCalledWith(
        'audit-logs/export/csv?user_id=7&action=update&resource_type=bookings&category=bookings' +
          '&start_date=2026-07-01&end_date=2026-07-26&search=smith',
      );
    });
  });

  describe('downloadCSV', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      createObjectURL = vi.fn(() => 'blob:mock-url');
      revokeObjectURL = vi.fn();
      // jsdom does not implement Blob URL creation — stub it directly on the
      // real URL constructor rather than replacing the global (client.ts and
      // other tests still need `new URL(...)` to work as normal).
      window.URL.createObjectURL = createObjectURL as unknown as typeof window.URL.createObjectURL;
      window.URL.revokeObjectURL = revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      clickSpy.mockRestore();
    });

    it('exports the blob, triggers a download, and revokes the object URL', async () => {
      get.mockReturnValue(mockBlobResponse(new Blob(['csv'])));

      await AuditService.downloadCSV({ search: 'smith' });

      expect(get).toHaveBeenCalledWith('audit-logs/export/csv?search=smith');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  describe('downloadPDF', () => {
    it('fetches up to 10000 logs for the given filter and saves a PDF via jsPDF + autoTable', async () => {
      const response = buildLogResponse({
        data: [
          {
            id: 1,
            user_id: 1,
            username: 'admin',
            action: 'update_booking',
            resource_type: 'bookings',
            category: 'bookings',
            resource_id: 5,
            has_changes: true,
            details: null,
            ip_address: '127.0.0.1',
            user_agent: 'vitest',
            created_at: '2026-07-26T00:00:00Z',
          },
        ],
      });
      get.mockReturnValue(mockJsonResponse(response));

      await AuditService.downloadPDF({ search: 'smith' });

      // getAuditLogs is called internally with page=1, page_size=10000, merged with params.
      expect(get).toHaveBeenCalledWith('audit-logs?search=smith&page=1&page_size=10000');
      expect(autoTableMock).toHaveBeenCalledTimes(1);
      expect(jsPdfSave).toHaveBeenCalledWith(expect.stringMatching(/^audit_logs_\d{4}-\d{2}-\d{2}\.pdf$/));
    });
  });
});
