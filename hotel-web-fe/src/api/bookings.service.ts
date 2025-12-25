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
  static async getAllBookings(): Promise<Booking[]> {
    try {
      return await withRetry(
        () => api.get('bookings').json<Booking[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
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
        .post(`bookings/${bookingId}/checkin`, { json: checkinData || null })
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

  static async cancelBooking(cancellationData: BookingCancellationRequest): Promise<Booking> {
    try {
      return await api
        .post('bookings/cancel', { json: cancellationData })
        .json<Booking>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to cancel booking',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to cancel booking');
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

  static async getBookingsWithDetails(): Promise<BookingWithDetails[]> {
    try {
      const bookings = await this.getAllBookings();
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
}
