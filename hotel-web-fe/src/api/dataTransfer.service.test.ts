import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

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

import { DataTransferService } from './dataTransfer.service';
import { APIError } from './client';
import type { BookingDataExport, ExportPreview, ImportResult } from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Every method under test here chains `.json()` onto the api call, so a
 * rejection must come from that `.json()` call — not from the outer mock
 * return value directly (which is never awaited on its own). */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/data-transfer/export') {
  const response = new Response(JSON.stringify(body), { status, statusText: 'Error' });
  const request = new Request(url, { method: 'GET' });
  return new HTTPError(response, request, {} as any);
}

const fakeExport: BookingDataExport = {
  version: '2.0',
  exported_at: '2026-07-27T00:00:00Z',
  tables: {
    'public.users': [{ id: 1, password_hash: 'stored-hash' }],
  },
} as unknown as BookingDataExport;

describe('DataTransferService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  describe('previewExport', () => {
    it('calls GET data-transfer/export/preview with no timeout', async () => {
      const preview: ExportPreview = { generated_at: '2026-07-26T00:00:00Z', counts: { guests: 10 }, total_records: 10 };
      get.mockReturnValue(mockJsonResponse(preview));

      const result = await DataTransferService.previewExport();

      expect(get).toHaveBeenCalledWith('data-transfer/export/preview', { timeout: false });
      expect(result).toEqual(preview);
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
        message: 'Failed to preview export data',
      });
    });
  });

  describe('exportData', () => {
    it('calls GET data-transfer/export with no timeout', async () => {
      get.mockReturnValue(mockJsonResponse(fakeExport));

      const result = await DataTransferService.exportData();

      expect(get).toHaveBeenCalledWith('data-transfer/export', { timeout: false });
      expect(result).toBe(fakeExport);
    });

    it('wraps an HTTPError into an APIError', async () => {
      get.mockReturnValue(mockJsonRejection(buildHttpError(500, { error: 'Export failed' })));

      await expect(DataTransferService.exportData()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Export failed',
        statusCode: 500,
      });
    });
  });

  describe('importData', () => {
    it('posts schema-qualified v2 tables unchanged with no timeout', async () => {
      const result: ImportResult = { success: true, mode: 'import', records_imported: { guests: 10 } };
      post.mockReturnValue(mockJsonResponse(result));

      const outcome = await DataTransferService.importData('import', fakeExport, ['public.users']);

      expect(post).toHaveBeenCalledWith('data-transfer/import', {
        json: { mode: 'import', data: fakeExport, tables: ['public.users'] },
        timeout: false,
      });
      expect(outcome).toEqual(result);
    });

    it('forwards "overwrite" mode as given', async () => {
      post.mockReturnValue(mockJsonResponse({ success: true, mode: 'overwrite', records_imported: {} }));

      await DataTransferService.importData('overwrite', fakeExport, []);

      expect(post).toHaveBeenCalledWith('data-transfer/import', {
        json: { mode: 'overwrite', data: fakeExport, tables: [] },
        timeout: false,
      });
    });

    it('wraps an HTTPError into an APIError', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(422, { error: 'Import validation failed' })));

      await expect(DataTransferService.importData('import', fakeExport, ['guests'])).rejects.toMatchObject({
        name: 'APIError',
        message: 'Import validation failed',
        statusCode: 422,
      });
    });

    it('falls back to a generic message when the error is not an HTTPError', async () => {
      post.mockReturnValue(mockJsonRejection(new Error('timeout')));

      await expect(DataTransferService.importData('import', fakeExport, ['guests'])).rejects.toMatchObject({
        name: 'APIError',
        message: 'Failed to import data',
      });
    });
  });
});
