import { api } from './client';
import { withRetry } from '../utils/retry';

// Types
export interface RoomSnapshot {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  dirty: number;
}

export interface RevenueBreakdownItem {
  category: string;
  count: number;
  amount: number;
}

export interface UnpostedBooking {
  booking_id: number;
  booking_number: string;
  guest_name: string;
  room_number: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  total_amount: number;
  payment_method: string | null;
  source: string | null;
}

export interface NightAuditPreview {
  audit_date: string;
  can_run: boolean;
  already_run: boolean;
  unposted_bookings: UnpostedBooking[];
  total_unposted: number;
  estimated_revenue: number;
  room_snapshot: RoomSnapshot;
  payment_method_breakdown: RevenueBreakdownItem[];
  booking_channel_breakdown: RevenueBreakdownItem[];
}

export interface NightAuditRun {
  id: number;
  audit_date: string;
  run_at: string;
  run_by_username: string | null;
  status: string;
  total_bookings_posted: number;
  total_checkins: number;
  total_checkouts: number;
  total_revenue: number;
  occupancy_rate: number;
  rooms_available: number;
  rooms_occupied: number;
  rooms_reserved: number;
  rooms_maintenance: number;
  rooms_dirty: number;
  notes: string | null;
  created_at: string;
  payment_method_breakdown: RevenueBreakdownItem[];
  booking_channel_breakdown: RevenueBreakdownItem[];
}

export interface NightAuditResponse {
  success: boolean;
  audit_run: NightAuditRun;
  message: string;
}

export interface RunNightAuditRequest {
  audit_date: string;
  notes?: string;
}

export interface BookingPostedStatus {
  booking_id: number;
  is_posted: boolean;
  posted_date: string | null;
}

export interface PostedBookingDetail {
  booking_id: number;
  booking_number: string;
  guest_name: string;
  room_number: string;
  room_type: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  status: string;
  total_amount: number;
  payment_status: string | null;
  payment_method: string | null;
  source: string | null;
}

export interface AuditDetailsResponse {
  audit_run: NightAuditRun;
  posted_bookings: PostedBookingDetail[];
}

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
