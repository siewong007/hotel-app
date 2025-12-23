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
}
