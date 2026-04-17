import { HTTPError } from 'ky';
import { api, APIError } from './client';
import {
  Booking,
  BookingCreateRequest,
  BookingUpdateRequest,
  BookingCancellationRequest,
  BookingWithDetails,
  CheckInRequest,
  PreCheckInUpdateRequest,
} from '../types';
import { withRetry } from '../utils/retry';
import { validateBookingRequest, enhanceBookingDetails } from '../utils/bookingUtils';

export class BookingsService {
  static async getAllBookings(filters?: { room_number?: string }): Promise<Booking[]> {
    try {
      const pageSize = 500;
      const baseParams: Record<string, any> = { page: 1, page_size: pageSize };
      if (filters?.room_number) baseParams.room_number = filters.room_number;

      const firstPage = await withRetry(
        () => api.get('bookings', { searchParams: baseParams }).json<any>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
      const firstData: Booking[] = Array.isArray(firstPage) ? firstPage : (firstPage.data || []);
      const total = firstPage.total || firstData.length;

      if (total <= pageSize) return firstData;

      // Fetch remaining pages in parallel
      const totalPages = Math.ceil(total / pageSize);
      const remainingPages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          withRetry(
            () => api.get('bookings', { searchParams: { ...baseParams, page: i + 2 } }).json<any>(),
            { maxAttempts: 3, initialDelay: 1000 }
          )
        )
      );

      return remainingPages.reduce(
        (acc, res) => acc.concat(Array.isArray(res) ? res : (res.data || [])),
        firstData
      );
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch bookings',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch bookings');
    }
  }

  static async getMyBookings(): Promise<BookingWithDetails[]> {
    try {
      return await withRetry(
        () => api.get('bookings/my-bookings').json<BookingWithDetails[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch your bookings',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch your bookings');
    }
  }

  static async createBooking(bookingData: BookingCreateRequest): Promise<Booking> {
    const validation = validateBookingRequest(bookingData);
    if (!validation.isValid) {
      throw new APIError(
        `Invalid booking data: ${validation.errors.join(', ')}`,
        400,
        { errors: validation.errors }
      );
    }

    try {
      const backendData = {
        ...bookingData,
        guest_id: bookingData.guest_id,
        room_id: parseInt(bookingData.room_id, 10),
      };
      return await api.post('bookings', { json: backendData }).json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to create booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to create booking');
    }
  }

  static async updateBooking(bookingId: string, updateData: BookingUpdateRequest): Promise<Booking> {
    try {
      return await api
        .patch(`bookings/${bookingId}`, { json: updateData })
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update booking');
    }
  }

  static async checkInGuest(bookingId: string, checkinData?: CheckInRequest): Promise<Booking> {
    try {
      return await api
        .post(`bookings/${bookingId}/checkin`, { json: checkinData || {} })
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to check in guest',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to check in guest');
    }
  }

  static async preCheckInUpdate(bookingId: string, updateData: PreCheckInUpdateRequest): Promise<{ success: boolean; message: string }> {
    try {
      return await api
        .patch(`bookings/${bookingId}/pre-checkin`, { json: updateData })
        .json<{ success: boolean; message: string }>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update pre-check-in information',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update pre-check-in information');
    }
  }

  static async voidBooking(cancellationData: BookingCancellationRequest): Promise<Booking> {
    try {
      return await api
        .post('bookings/void', { json: cancellationData })
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to void booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to void booking');
    }
  }

  static async getBookingById(bookingId: string): Promise<Booking> {
    try {
      return await api.get(`bookings/${bookingId}`).json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch booking');
    }
  }

  static async getBookingsPage(params: {
    page?: number;
    page_size?: number;
    search?: string;
    status?: string;
    room_number?: string;
    date_search?: string;
    check_in_from?: string;
    check_in_to?: string;
    sort_by?: string;
    sort_order?: string;
  } = {}): Promise<{ data: BookingWithDetails[]; total: number; page: number; page_size: number }> {
    try {
      const searchParams: Record<string, any> = {
        page: params.page ?? 1,
        page_size: params.page_size ?? 50,
      };
      if (params.search) searchParams.search = params.search;
      if (params.status && params.status !== 'all') searchParams.status = params.status;
      if (params.room_number) searchParams.room_number = params.room_number;
      if (params.date_search) searchParams.date_search = params.date_search;
      if (params.check_in_from) searchParams.check_in_from = params.check_in_from;
      if (params.check_in_to) searchParams.check_in_to = params.check_in_to;
      if (params.sort_by) searchParams.sort_by = params.sort_by;
      if (params.sort_order) searchParams.sort_order = params.sort_order;

      const resp = await withRetry(
        () => api.get('bookings', { searchParams }).json<any>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
      const raw: any[] = Array.isArray(resp) ? resp : (resp.data || []);
      return {
        data: raw.map(b => enhanceBookingDetails(b as any)),
        total: resp.total ?? raw.length,
        page: resp.page ?? 1,
        page_size: resp.page_size ?? 50,
      };
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(errorData.error || 'Failed to fetch bookings', error.response.status, errorData);
      }
      throw new APIError('Failed to fetch bookings');
    }
  }

  static async getBookingStats(): Promise<{ total: number; checked_in: number; confirmed: number; today_check_ins: number }> {
    try {
      return await withRetry(
        () => api.get('bookings/stats').json<any>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      return { total: 0, checked_in: 0, confirmed: 0, today_check_ins: 0 };
    }
  }

  static async getBookingsWithDetails(filters?: { room_number?: string }): Promise<BookingWithDetails[]> {
    try {
      const bookings = await this.getAllBookings(filters);
      const bookingsWithDetails = bookings as any as BookingWithDetails[];
      return bookingsWithDetails.map(booking => enhanceBookingDetails(booking));
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError('Failed to fetch booking details');
    }
  }

  static async markBookingComplimentary(
    bookingId: string,
    reason?: string,
    complimentaryStartDate?: string,
    complimentaryEndDate?: string
  ): Promise<{
    success: boolean;
    message: string;
    booking_id: number;
    status: string;
    total_nights: number;
    complimentary_nights: number;
    paid_nights: number;
    complimentary_start_date: string;
    complimentary_end_date: string;
    original_total: string;
    new_total: string;
    payment_status: string;
    nights_credited: number;
    room_type: string;
  }> {
    try {
      return await api
        .post(`bookings/${bookingId}/complimentary`, {
          json: {
            reason,
            complimentary_start_date: complimentaryStartDate,
            complimentary_end_date: complimentaryEndDate
          }
        })
        .json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to mark booking as complimentary',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to mark booking as complimentary');
    }
  }

  static async convertComplimentaryToCredits(
    bookingId: string
  ): Promise<{ success: boolean; message: string; nights_credited: number; guest_id: number }> {
    try {
      return await api
        .post(`bookings/${bookingId}/convert-credits`)
        .json<{ success: boolean; message: string; nights_credited: number; guest_id: number }>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to convert complimentary to credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to convert complimentary to credits');
    }
  }

  static async bookWithCredits(data: {
    guest_id: number;
    room_id: number;
    check_in_date: string;
    check_out_date: string;
    adults?: number;
    children?: number;
    special_requests?: string;
    complimentary_dates: string[];  // Specific dates to mark as complimentary (YYYY-MM-DD format)
  }): Promise<{
    success: boolean;
    message: string;
    booking_id: number;
    booking_number: string;
    total_nights: number;
    complimentary_nights: number;
    complimentary_dates: string[];
    paid_nights: number;
    total_amount: string;
    room_type: string;
    is_free_gift: boolean;
  }> {
    try {
      return await api
        .post('bookings/book-with-credits', { json: data })
        .json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to book with complimentary credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to book with complimentary credits');
    }
  }

  // New complimentary management methods

  static async getComplimentaryBookings(): Promise<BookingWithDetails[]> {
    try {
      return await withRetry(
        () => api.get('bookings/complimentary').json<BookingWithDetails[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch complimentary bookings',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch complimentary bookings');
    }
  }

  static async getComplimentarySummary(): Promise<{
    total_complimentary_bookings: number;
    total_complimentary_nights: number;
    total_credits_available: number;
    value_of_complimentary_nights: string;
  }> {
    try {
      return await api.get('complimentary/summary').json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch complimentary summary',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch complimentary summary');
    }
  }

  static async updateComplimentary(
    bookingId: string,
    data: {
      complimentary_start_date?: string;
      complimentary_end_date?: string;
      complimentary_reason?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    booking_id: number;
    complimentary_nights?: number;
    new_total?: string;
  }> {
    try {
      return await api
        .patch(`bookings/${bookingId}/complimentary`, { json: data })
        .json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update complimentary booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update complimentary booking');
    }
  }

  static async removeComplimentary(bookingId: string): Promise<{
    success: boolean;
    message: string;
    booking_id: number;
    restored_total?: string;
  }> {
    try {
      return await api.delete(`bookings/${bookingId}/complimentary`).json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to remove complimentary status',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to remove complimentary status');
    }
  }

  static async getGuestsWithCredits(): Promise<{
    credits: Array<{
      guest_id: number;
      guest_name: string;
      email: string | null;
      room_type_id: number;
      room_type_name: string;
      room_type_code: string | null;
      nights_available: number;
      notes: string | null;
    }>;
  }> {
    try {
      return await api.get('guests/credits').json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch guests with credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch guests with credits');
    }
  }

  static async addGuestCredits(data: {
    guest_id: number;
    room_type_id: number;
    nights: number;
    notes?: string;
  }): Promise<{
    success: boolean;
    message: string;
    credit: {
      guest_id: number;
      guest_name: string;
      room_type_id: number;
      room_type_name: string;
      nights_available: number;
      notes: string | null;
    };
  }> {
    try {
      return await api.post('guests/credits', { json: data }).json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to add guest credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to add guest credits');
    }
  }

  static async updateGuestCredits(
    guestId: number,
    roomTypeId: number,
    data: {
      nights_available?: number;
      notes?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    credit: {
      guest_id: number;
      guest_name: string;
      room_type_id: number;
      room_type_name: string;
      nights_available: number;
      notes: string | null;
    };
  }> {
    try {
      return await api.patch(`guests/${guestId}/credits/${roomTypeId}`, { json: data }).json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update guest credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update guest credits');
    }
  }

  static async deleteGuestCredits(
    guestId: number,
    roomTypeId: number
  ): Promise<{
    success: boolean;
    message: string;
    deleted: {
      guest_id: number;
      guest_name: string;
      room_type_id: number;
      room_type_name: string;
      nights_deleted: number;
    };
  }> {
    try {
      return await api.delete(`guests/${guestId}/credits/${roomTypeId}`).json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to delete guest credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to delete guest credits');
    }
  }

  static async reactivateBooking(bookingId: string): Promise<Booking> {
    try {
      return await api
        .post(`bookings/${bookingId}/reactivate`)
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to reactivate booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to reactivate booking');
    }
  }
}
