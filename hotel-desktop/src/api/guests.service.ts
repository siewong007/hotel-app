import { HTTPError } from 'ky';
import { api, APIError } from './client';
import { Guest, GuestCreateRequest } from '../types';
import { withRetry } from '../utils/retry';

export class GuestsService {
  static async getAllGuests(): Promise<Guest[]> {
    return await withRetry(
      () => api.get('guests').json<Guest[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getGuest(guestId: number | string): Promise<Guest> {
    return await withRetry(
      () => api.get(`guests/${guestId}`).json<Guest>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async createGuest(guestData: GuestCreateRequest): Promise<Guest> {
    return await withRetry(
      () => api.post('guests', { json: guestData }).json<Guest>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async updateGuest(guestId: number, guestData: Partial<GuestCreateRequest>): Promise<Guest> {
    try {
      return await api.patch(`guests/${guestId}`, { json: guestData }).json<Guest>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update guest',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update guest');
    }
  }

  static async deleteGuest(guestId: number): Promise<{ success: boolean; message: string }> {
    try {
      return await api.delete(`guests/${guestId}`).json<{ success: boolean; message: string }>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to delete guest',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to delete guest');
    }
  }

  static async getGuestBookings(guestId: number): Promise<any[]> {
    try {
      return await api.get(`guests/${guestId}/bookings`).json<any[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch guest bookings',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch guest bookings');
    }
  }

  static async getMyGuests(): Promise<Guest[]> {
    try {
      return await withRetry(
        () => api.get('guests/my-guests').json<Guest[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch your linked guests',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch your linked guests');
    }
  }

  static async getMyGuestsWithCredits(): Promise<{
    id: number;
    full_name: string;
    email: string;
    total_complimentary_credits: number;
    credits_by_room_type: {
      room_type_id: number;
      room_type_name: string;
      room_type_code: string;
      nights_available: number;
    }[];
  }[]> {
    try {
      return await withRetry(
        () => api.get('guests/my-guests-with-credits').json(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
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

  static async getGuestCredits(guestId: number): Promise<{
    guest_id: number;
    guest_name: string;
    total_nights: number;
    credits_by_room_type: {
      id: number;
      guest_id: number;
      room_type_id: number;
      room_type_name: string;
      room_type_code: string;
      nights_available: number;
      created_at: string;
      updated_at: string;
    }[];
  }> {
    try {
      return await api.get(`guests/${guestId}/credits`).json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch guest credits',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch guest credits');
    }
  }
}
