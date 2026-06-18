import { HTTPError } from 'ky';
import { api, APIError } from './client';
import { Guest, GuestCreateRequest, GuestProfile } from '../types';
import { withRetry } from '../utils/retry';
import { getPaginationState, toPaginationSearchParams } from '../utils/pagination';

export class GuestsService {
  static async getAllGuests(params?: { search?: string }): Promise<Guest[]> {
    const pageSize = 500;
    const baseParams: Record<string, any> = toPaginationSearchParams({ page: 1, pageSize });
    if (params?.search) baseParams.search = params.search;

    const firstPage = await withRetry(
      () => api.get('guests', { searchParams: baseParams }).json<any>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
    const firstData: Guest[] = Array.isArray(firstPage) ? firstPage : (firstPage.data || []);
    const total = firstPage.total || firstData.length;

    if (total <= pageSize) return firstData;

    // Fetch remaining pages in parallel. Use allSettled (not Promise.all) so a
    // single failed page can't reject the whole call and leave the caller with
    // an empty list — a partial guest list is far less harmful than no list at
    // all, which silently funnels users into re-creating an existing guest and
    // hitting the backend's duplicate-name guard.
    const totalPages = getPaginationState({ page: 1, pageSize, totalItems: total }).totalPages;
    const settledPages = await Promise.allSettled(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        withRetry(
          () => api.get('guests', { searchParams: { ...baseParams, page: i + 2 } }).json<any>(),
          { maxAttempts: 3, initialDelay: 1000 }
        )
      )
    );

    const guests: Guest[] = [...firstData];
    let failedPages = 0;
    settledPages.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const res = result.value;
        const pageData: Guest[] = Array.isArray(res) ? res : (res.data || []);
        guests.push(...pageData);
      } else {
        failedPages++;
        console.warn(`getAllGuests: failed to load page ${i + 2} of ${totalPages}`, result.reason);
      }
    });

    if (failedPages > 0) {
      console.warn(
        `getAllGuests: returning ${guests.length} of ~${total} guests; ${failedPages} page(s) failed to load`
      );
    }

    return guests;
  }

  static async getGuestsPage(params: {
    page?: number;
    page_size?: number;
    search?: string;
    guest_type?: string;
  } = {}): Promise<{ data: Guest[]; total: number; page: number; page_size: number }> {
    const searchParams: Record<string, any> = {
      ...toPaginationSearchParams({ page: params.page, pageSize: params.page_size }),
    };
    if (params.search) searchParams.search = params.search;
    if (params.guest_type) searchParams.guest_type = params.guest_type;

    try {
      const resp = await withRetry(
        () => api.get('guests', { searchParams }).json<any>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
      const data: Guest[] = Array.isArray(resp) ? resp : (resp.data || []);
      return {
        data,
        total: resp.total ?? data.length,
        page: resp.page ?? 1,
        page_size: resp.page_size ?? 50,
      };
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(errorData.error || 'Failed to fetch guests', error.response.status, errorData);
      }
      throw new APIError('Failed to fetch guests');
    }
  }

  static async getGuest(guestId: number | string): Promise<Guest> {
    return await withRetry(
      () => api.get(`guests/${guestId}`).json<Guest>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getGuestProfile(guestId: number | string): Promise<GuestProfile> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/profile`).json<GuestProfile>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch guest profile',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch guest profile');
    }
  }

  static async createGuest(guestData: GuestCreateRequest): Promise<Guest> {
    try {
      return await withRetry(
        () => api.post('guests', { json: guestData }).json<Guest>(),
        { maxAttempts: 2, initialDelay: 1000 }
      );
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to create guest',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to create guest');
    }
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
