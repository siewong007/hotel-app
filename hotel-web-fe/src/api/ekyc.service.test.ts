import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

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

import { EkycService } from './ekyc.service';
import type { EkycActionPayload, EkycAdminCreatePayload } from './ekyc.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

function mockBlobResponse(blob: Blob) {
  return { blob: () => Promise.resolve(blob) };
}

function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/ekyc/submit') {
  const response = new Response(JSON.stringify(body), { status, statusText: 'Error' });
  const request = new Request(url, { method: 'POST' });
  return new HTTPError(response, request, {} as any);
}

/** Methods that chain `.json()` onto the api call must reject from that
 * `.json()` call — a bare rejected mock return value is never awaited. */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

describe('EkycService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
  });

  describe('getEkycStatus', () => {
    it('calls GET ekyc/status', async () => {
      const status = { status: 'pending' };
      get.mockReturnValue(mockJsonResponse(status));

      const result = await EkycService.getEkycStatus();

      expect(get).toHaveBeenCalledWith('ekyc/status');
      expect(result).toEqual(status);
    });
  });

  describe('submitEkycVerification', () => {
    it('posts the payload as json to ekyc/submit', async () => {
      const data = { id_type: 'passport' };
      post.mockReturnValue(Promise.resolve(undefined));

      await EkycService.submitEkycVerification(data);

      expect(post).toHaveBeenCalledWith('ekyc/submit', { json: data });
    });

    it('wraps an HTTPError into an APIError with the server message', async () => {
      post.mockReturnValue(Promise.reject(buildHttpError(400, { error: 'Missing document' })));

      await expect(EkycService.submitEkycVerification({})).rejects.toMatchObject({
        name: 'APIError',
        message: 'Missing document',
        statusCode: 400,
      });
    });

    it('falls back to a generic message when the error is not an HTTPError', async () => {
      post.mockReturnValue(Promise.reject(new Error('offline')));

      await expect(EkycService.submitEkycVerification({})).rejects.toMatchObject({
        name: 'APIError',
        message: 'eKYC submission failed',
      });
    });
  });

  describe('getEkycVerificationDetails', () => {
    it('calls GET ekyc/status', async () => {
      const details = { status: 'approved' };
      get.mockReturnValue(mockJsonResponse(details));

      const result = await EkycService.getEkycVerificationDetails();

      expect(get).toHaveBeenCalledWith('ekyc/status');
      expect(result).toEqual(details);
    });
  });

  describe('getAllEkycVerifications', () => {
    it('calls GET ekyc/admin/applications with no query string when no params are given', async () => {
      const response = { data: [], metrics: {}, total: 0, page: 1, page_size: 50, total_pages: 0 };
      get.mockReturnValue(mockJsonResponse(response));

      await EkycService.getAllEkycVerifications();

      expect(get).toHaveBeenCalledWith('ekyc/admin/applications');
    });

    it('builds a query string from provided filters, skipping empty-string and "all" values', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], metrics: {}, total: 0, page: 1, page_size: 50, total_pages: 0 }));

      await EkycService.getAllEkycVerifications({
        status: 'pending',
        risk_level: 'all',
        search: '',
        page: 2,
        page_size: 25,
      });

      const url = get.mock.calls[0][0] as string;
      expect(url).toBe('ekyc/admin/applications?status=pending&page=2&page_size=25');
    });
  });

  describe('getEkycApplication', () => {
    it('calls GET ekyc/admin/applications/<id>', async () => {
      const detail = { summary: { id: 1 } };
      get.mockReturnValue(mockJsonResponse(detail));

      const result = await EkycService.getEkycApplication(1);

      expect(get).toHaveBeenCalledWith('ekyc/admin/applications/1');
      expect(result).toEqual(detail);
    });
  });

  describe('getReasonCodes', () => {
    it('calls GET ekyc/admin/reason-codes', async () => {
      const codes = [{ code: 'other', label: 'Other', category: 'general', requires_details: false, customer_message_template: null, is_active: true }];
      get.mockReturnValue(mockJsonResponse(codes));

      const result = await EkycService.getReasonCodes();

      expect(get).toHaveBeenCalledWith('ekyc/admin/reason-codes');
      expect(result).toEqual(codes);
    });
  });

  describe('performReviewAction', () => {
    it('posts the payload as json to ekyc/admin/applications/<id>/actions', async () => {
      const payload: EkycActionPayload = { action: 'approve', expected_version: 1 };
      const detail = { summary: { id: 1, version: 2 } };
      post.mockReturnValue(mockJsonResponse(detail));

      const result = await EkycService.performReviewAction(1, payload);

      expect(post).toHaveBeenCalledWith('ekyc/admin/applications/1/actions', { json: payload });
      expect(result).toEqual(detail);
    });

    it('wraps an HTTPError into an APIError', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(409, { error: 'Version conflict' })));

      await expect(
        EkycService.performReviewAction(1, { action: 'approve', expected_version: 1 }),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Version conflict', statusCode: 409 });
    });
  });

  describe('revealSensitiveField', () => {
    it('posts field and reason as json to ekyc/admin/applications/<id>/reveal', async () => {
      const response = { field: 'id_number', value: '123456' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await EkycService.revealSensitiveField(1, 'id_number', 'fraud review');

      expect(post).toHaveBeenCalledWith('ekyc/admin/applications/1/reveal', {
        json: { field: 'id_number', reason: 'fraud review' },
      });
      expect(result).toEqual(response);
    });

    it('wraps an HTTPError into an APIError', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(403, { error: 'Not permitted' })));

      await expect(EkycService.revealSensitiveField(1, 'id_number', 'reason')).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('exportEkycApplications', () => {
    it('calls GET ekyc/admin/applications/export with the built query string and returns a blob', async () => {
      const blob = new Blob(['csv']);
      get.mockReturnValue(mockBlobResponse(blob));

      const result = await EkycService.exportEkycApplications({ status: 'approved' });

      expect(get).toHaveBeenCalledWith('ekyc/admin/applications/export?status=approved');
      expect(result).toBe(blob);
    });
  });

  describe('updateEkycVerification', () => {
    it('patches ekyc/verifications/<id> with the updates as json', async () => {
      patch.mockReturnValue(Promise.resolve(undefined));

      await EkycService.updateEkycVerification(5, { status: 'approved' });

      expect(patch).toHaveBeenCalledWith('ekyc/verifications/5', { json: { status: 'approved' } });
    });
  });

  describe('approveEkycVerification', () => {
    it('delegates to performReviewAction with a legacy manual-override approve payload', async () => {
      post.mockReturnValue(mockJsonResponse({ summary: {} }));

      await EkycService.approveEkycVerification(5);

      expect(post).toHaveBeenCalledWith('ekyc/admin/applications/5/actions', {
        json: {
          action: 'approve',
          expected_version: 1,
          reason_code: 'manual_override',
          reason: 'Legacy approval action',
          self_checkin_enabled: true,
        },
      });
    });
  });

  describe('rejectEkycVerification', () => {
    it('delegates to performReviewAction with a reject payload carrying the given reason', async () => {
      post.mockReturnValue(mockJsonResponse({ summary: {} }));

      await EkycService.rejectEkycVerification(5, 'Blurry document');

      expect(post).toHaveBeenCalledWith('ekyc/admin/applications/5/actions', {
        json: {
          action: 'reject',
          expected_version: 1,
          reason_code: 'other',
          reason: 'Blurry document',
        },
      });
    });
  });

  describe('uploadEkycDocument', () => {
    it('posts a FormData body with the file and documentType to ekyc/upload-document', async () => {
      const response = { filename: 'id.png', file_path: '/uploads/id.png' };
      post.mockReturnValue(mockJsonResponse(response));
      const file = new File(['bytes'], 'id.png', { type: 'image/png' });

      const result = await EkycService.uploadEkycDocument(file, 'id_front');

      expect(post).toHaveBeenCalledTimes(1);
      const [url, options] = post.mock.calls[0];
      expect(url).toBe('ekyc/upload-document');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('file')).toBe(file);
      expect(options.body.get('documentType')).toBe('id_front');
      expect(result).toEqual(response);
    });

    it('wraps an HTTPError into an APIError', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(413, { error: 'File too large' })));
      const file = new File(['bytes'], 'id.png', { type: 'image/png' });

      await expect(EkycService.uploadEkycDocument(file, 'id_front')).rejects.toMatchObject({
        statusCode: 413,
      });
    });
  });

  describe('createEkycApplication', () => {
    it('posts the payload as json to ekyc/admin/applications', async () => {
      const payload: EkycAdminCreatePayload = {
        guest_id: 1,
        selfie_image: 'data:...',
        id_front_image: 'data:...',
        id_type: 'passport',
        id_number: 'A1234567',
        full_name: 'Jane Doe',
        date_of_birth: '1990-01-01',
        id_expiry_date: '2030-01-01',
      };
      const detail = { summary: { id: 1 } };
      post.mockReturnValue(mockJsonResponse(detail));

      const result = await EkycService.createEkycApplication(payload);

      expect(post).toHaveBeenCalledWith('ekyc/admin/applications', { json: payload });
      expect(result).toEqual(detail);
    });

    it('wraps an HTTPError into an APIError', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(400, { error: 'Guest not found' })));

      await expect(
        EkycService.createEkycApplication({} as EkycAdminCreatePayload),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Guest not found', statusCode: 400 });
    });
  });
});
