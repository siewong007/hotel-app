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
}
