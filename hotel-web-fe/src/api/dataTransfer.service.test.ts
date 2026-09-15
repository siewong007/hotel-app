import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildKyHttpError } from './testSupport/httpError';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { DataTransferService } from './dataTransfer.service';
import { APIError } from './client';
import type { ExportPreview, ImportJobStatus, ImportPreview } from '../types';

const SKIP_HEADER = 'x-skip-api-notification';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Every JSON method under test chains `.json()` onto the api call, so a
 * rejection must come from that `.json()` call — not from the outer mock
 * return value directly (which is never awaited on its own). */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/data-transfer/export') {
  return buildKyHttpError(status, body, url);
}

const fakePreview: ExportPreview = {
  generated_at: '2026-09-14T00:00:00Z',
  counts: { 'public.guests': 10 },
  total_records: 10,
  tables: [{ name: 'public.guests', count: 10, dependencies: [] }],
  entities: [{ name: 'public.guests', primaryKey: ['id'], columns: ['id', 'full_name'] }],
  exclusions: [{ name: 'public.users', reason: 'credentials_and_auth_state' }],
};

const fakeImportPreview: ImportPreview = {
  uploadId: 'u1',
  format: 'v1',
  version: 3,
  exportType: 'full',
  sensitive: true,
  requiresPermissions: ['data_transfer:import_sensitive'],
  exportedAt: '2026-09-14T00:00:00Z',
  sourceEnvironment: 'production',
  applicationVersion: '1.2.3',
  entities: [{ name: 'public.guests', rows: 10, new: 8, existing: 2, skipped: 0 }],
  unsupportedEntities: [],
  validationErrors: [],
  relationshipProblems: [],
  warnings: [],
  totalRows: 10,
};

describe('DataTransferService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    del.mockReset();
  });

  describe('previewExport', () => {
    it('calls GET data-transfer/export/preview with no timeout and notification skip', async () => {
      get.mockReturnValue(mockJsonResponse(fakePreview));

      const result = await DataTransferService.previewExport();

      expect(get).toHaveBeenCalledWith('data-transfer/export/preview', {
        timeout: false,
        headers: { [SKIP_HEADER]: 'true' },
        searchParams: { scope: 'standard' },
      });
      expect(result).toEqual(fakePreview);
    });

    it('passes the requested scope through as a query param', async () => {
      get.mockReturnValue(mockJsonResponse(fakePreview));

      await DataTransferService.previewExport('backup');

      expect(get).toHaveBeenCalledWith('data-transfer/export/preview', {
        timeout: false,
        headers: { [SKIP_HEADER]: 'true' },
        searchParams: { scope: 'backup' },
      });
    });

    it('wraps an HTTPError into an APIError with the server message', async () => {
      get.mockReturnValue(mockJsonRejection(buildHttpError(500, { error: 'Export preview failed unexpectedly' })));

      let caught: unknown;
      try {
        await DataTransferService.previewExport();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(APIError);
      expect(caught).toMatchObject({ message: 'Export preview failed unexpectedly', statusCode: 500 });
    });

    it('falls back to a generic message when the error is not an HTTPError', async () => {
      get.mockReturnValue(mockJsonRejection(new Error('offline')));

      await expect(DataTransferService.previewExport()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Something went wrong. Please try again.',
      });
    });
  });

  describe('exportData', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      createObjectURL = vi.fn(() => 'blob:mock-url');
      revokeObjectURL = vi.fn();
      window.URL.createObjectURL = createObjectURL as unknown as typeof window.URL.createObjectURL;
      window.URL.revokeObjectURL = revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      clickSpy.mockRestore();
    });

    function mockDownloadResponse(disposition: string | null, bytes = 42) {
      const headers = new Headers();
      if (disposition !== null) headers.set('content-disposition', disposition);
      return {
        headers,
        blob: () => Promise.resolve(new Blob([new Uint8Array(bytes)], { type: 'application/json' })),
      };
    }

    it('downloads the blob under the Content-Disposition filename', async () => {
      get.mockReturnValue(
        mockDownloadResponse('attachment; filename="saliminn-backup-20260914T120000Z.json"'),
      );

      const result = await DataTransferService.exportData();

      expect(get).toHaveBeenCalledWith('data-transfer/export', {
        timeout: false,
        headers: { [SKIP_HEADER]: 'true' },
        searchParams: { scope: 'standard' },
      });
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('saliminn-backup-20260914T120000Z.json');
      expect(anchor.href).toBe('blob:mock-url');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
      expect(result).toEqual({ filename: 'saliminn-backup-20260914T120000Z.json', bytes: 42 });
    });

    it('sends the scope and X-Step-Up header for privileged exports', async () => {
      get.mockReturnValue(mockDownloadResponse('attachment; filename="b.json"'));

      await DataTransferService.exportData('full', 'step-token-123');

      expect(get).toHaveBeenCalledWith('data-transfer/export', {
        timeout: false,
        headers: { [SKIP_HEADER]: 'true', 'X-Step-Up': 'step-token-123' },
        searchParams: { scope: 'full' },
      });
    });

    it('falls back to a generated filename when Content-Disposition is absent', async () => {
      get.mockReturnValue(mockDownloadResponse(null));

      const result = await DataTransferService.exportData();

      expect(result.filename).toMatch(/^saliminn-backup-\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('wraps an HTTPError into an APIError', async () => {
      get.mockImplementation(() => Promise.reject(buildHttpError(500, { error: 'Export failed' })));

      await expect(DataTransferService.exportData()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Export failed',
        statusCode: 500,
      });
      expect(createObjectURL).not.toHaveBeenCalled();
    });
  });

  describe('uploadBackup', () => {
    it('posts the raw file with the documented headers and no timeout', async () => {
      const upload = { uploadId: 'u1', bytes: 5, detectedFormat: 'v1' };
      post.mockReturnValue(mockJsonResponse(upload));
      const file = new File(['{}'], 'backup file.json', { type: 'application/json' });

      const result = await DataTransferService.uploadBackup(file);

      expect(post).toHaveBeenCalledWith('data-transfer/import/uploads', {
        body: file,
        headers: {
          [SKIP_HEADER]: 'true',
          'content-type': 'application/octet-stream',
        },
        timeout: false,
      });
      expect(result).toEqual(upload);
    });

    it('surfaces the server 413 message', async () => {
      post.mockReturnValue(
        mockJsonRejection(buildHttpError(413, { error: 'the uploaded backup exceeds the 256 MB limit' })),
      );

      await expect(DataTransferService.uploadBackup(new File(['{}'], 'big.json'))).rejects.toMatchObject({
        name: 'APIError',
        message: 'the uploaded backup exceeds the 256 MB limit',
        statusCode: 413,
      });
    });
  });

  describe('previewImport', () => {
    it('posts the uploadId and returns the preview', async () => {
      post.mockReturnValue(mockJsonResponse(fakeImportPreview));

      const result = await DataTransferService.previewImport('u1');

      expect(post).toHaveBeenCalledWith('data-transfer/import/preview', {
        json: { uploadId: 'u1' },
        headers: { [SKIP_HEADER]: 'true' },
        timeout: false,
      });
      expect(result).toEqual(fakeImportPreview);
    });
  });

  describe('executeImport', () => {
    it('posts mode + confirm:true and returns the job id', async () => {
      post.mockReturnValue(mockJsonResponse({ jobId: 'job-1' }));

      const result = await DataTransferService.executeImport({
        uploadId: 'u1',
        mode: 'merge',
        onConflict: 'update',
      });

      expect(post).toHaveBeenCalledWith('data-transfer/import/execute', {
        json: { uploadId: 'u1', mode: 'merge', onConflict: 'update', confirm: true },
        headers: { [SKIP_HEADER]: 'true' },
      });
      expect(result).toEqual({ jobId: 'job-1' });
    });

    it('omits onConflict for restore when the caller leaves it undefined', async () => {
      post.mockReturnValue(mockJsonResponse({ jobId: 'job-2' }));

      await DataTransferService.executeImport({ uploadId: 'u1', mode: 'restore' });

      expect(post).toHaveBeenCalledWith('data-transfer/import/execute', {
        json: { uploadId: 'u1', mode: 'restore', confirm: true },
        headers: { [SKIP_HEADER]: 'true' },
      });
    });

    it('sends X-Step-Up for restore executions', async () => {
      post.mockReturnValue(mockJsonResponse({ jobId: 'job-3' }));

      await DataTransferService.executeImport(
        { uploadId: 'u1', mode: 'restore' },
        'step-token-abc',
      );

      expect(post).toHaveBeenCalledWith('data-transfer/import/execute', {
        json: { uploadId: 'u1', mode: 'restore', confirm: true },
        headers: { [SKIP_HEADER]: 'true', 'X-Step-Up': 'step-token-abc' },
      });
    });
  });

  describe('stepUp', () => {
    it('posts password and optional TOTP code', async () => {
      post.mockReturnValue(
        mockJsonResponse({ stepUpToken: 'tok', expiresAt: '2026-09-15T00:02:00Z' }),
      );

      const result = await DataTransferService.stepUp({ password: 'pw', totpCode: '123456' });

      expect(post).toHaveBeenCalledWith('data-transfer/step-up', {
        json: { password: 'pw', totpCode: '123456' },
        headers: { [SKIP_HEADER]: 'true' },
      });
      expect(result).toEqual({ stepUpToken: 'tok', expiresAt: '2026-09-15T00:02:00Z' });
    });

    it('surfaces a re-authentication failure', async () => {
      post.mockReturnValue(
        mockJsonRejection(buildHttpError(401, { error: 'Re-authentication failed' }, 'http://localhost/api/data-transfer/step-up')),
      );

      await expect(DataTransferService.stepUp({ password: 'wrong' })).rejects.toMatchObject({
        name: 'APIError',
        message: 'Re-authentication failed',
        statusCode: 401,
      });
    });
  });

  describe('transferHistory', () => {
    it('gets the history endpoint with the default limit', async () => {
      const payload = { entries: [], total: 0 };
      get.mockReturnValue(mockJsonResponse(payload));

      const result = await DataTransferService.transferHistory();

      expect(get).toHaveBeenCalledWith('data-transfer/history', {
        headers: { [SKIP_HEADER]: 'true' },
        searchParams: { limit: 100 },
      });
      expect(result).toEqual(payload);
    });
  });

  describe('getImportJob', () => {
    it('gets the job status endpoint', async () => {
      const status: ImportJobStatus = {
        status: 'running',
        progress: { entity: 'public.guests', rowsApplied: 5, totalRows: 10 },
      };
      get.mockReturnValue(mockJsonResponse(status));

      const result = await DataTransferService.getImportJob('job-1');

      expect(get).toHaveBeenCalledWith('data-transfer/import/jobs/job-1', {
        headers: { [SKIP_HEADER]: 'true' },
      });
      expect(result).toEqual(status);
    });
  });

  describe('deleteUpload', () => {
    it('deletes the staged upload', async () => {
      del.mockResolvedValue({});

      await DataTransferService.deleteUpload('u1');

      expect(del).toHaveBeenCalledWith('data-transfer/import/uploads/u1', {
        headers: { [SKIP_HEADER]: 'true' },
      });
    });

    it('wraps failures into APIError', async () => {
      del.mockRejectedValue(new Error('offline'));

      await expect(DataTransferService.deleteUpload('u1')).rejects.toMatchObject({
        name: 'APIError',
        message: 'Something went wrong. Please try again.',
      });
    });
  });
});
