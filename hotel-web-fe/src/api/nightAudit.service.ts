import { api } from './client';
import { withRetry } from '../utils/retry';
import type {
  AuditDetailsResponse,
  BookingPostedStatus,
  NightAuditPreview,
  NightAuditResponse,
  NightAuditRun,
  RunNightAuditRequest,
} from '../types';

export class NightAuditService {
  /**
   * Get preview of what will be posted for a given date
   */
  static async getPreview(date: string): Promise<NightAuditPreview> {
    return await withRetry(
      () => api.get(`night-audit/preview?date=${date}`).json<NightAuditPreview>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Run night audit for a specific date
   */
  static async runNightAudit(request: RunNightAuditRequest): Promise<NightAuditResponse> {
    return await withRetry(
      () => api.post('night-audit/run', { json: request }).json<NightAuditResponse>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  /**
   * Get list of all night audit runs
   */
  static async listNightAudits(page: number = 1, pageSize: number = 30): Promise<NightAuditRun[]> {
    return await withRetry(
      () => api.get(`night-audit?page=${page}&page_size=${pageSize}`).json<NightAuditRun[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Get a specific night audit run by ID
   */
  static async getNightAudit(id: number): Promise<NightAuditRun> {
    return await withRetry(
      () => api.get(`night-audit/${id}`).json<NightAuditRun>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Check if a booking is posted
   */
  static async isBookingPosted(bookingId: number): Promise<BookingPostedStatus> {
    return await withRetry(
      () => api.get(`bookings/${bookingId}/posted`).json<BookingPostedStatus>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Get audit details including all posted bookings
   */
  static async getAuditDetails(id: number): Promise<AuditDetailsResponse> {
    return await withRetry(
      () => api.get(`night-audit/${id}/details`).json<AuditDetailsResponse>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }
}
