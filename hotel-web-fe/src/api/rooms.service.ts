import { HTTPError } from 'ky';
import { api, APIError, API_BASE_URL } from './client';
import {
  Room,
  SearchQuery,
  RoomWithDisplay,
  RoomEvent,
  RoomEventInput,
  RoomStatusUpdateInput,
  RoomDetailedStatus,
  RoomHistory,
  RoomCurrentOccupancy,
  HotelOccupancySummary,
  OccupancyByRoomType,
  RoomWithOccupancy,
} from '../types';
import { withRetry } from '../utils/retry';

export class RoomsService {
  static async getAllRooms(): Promise<Room[]> {
    return await withRetry(
      () => api.get('rooms').json<Room[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async searchRooms(roomType?: string, maxPrice?: number): Promise<Room[]> {
    const params: SearchQuery = {};
    if (roomType) params.room_type = roomType;
    if (maxPrice) params.max_price = maxPrice;

    return await withRetry(
      () => api.get('rooms/available', { searchParams: params }).json<Room[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getAvailableRoomsForDates(checkInDate: string, checkOutDate: string): Promise<Room[]> {
    const params: SearchQuery = {
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
    };

    return await withRetry(
      () => api.get('rooms/available', { searchParams: params }).json<Room[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async updateRoom(id: string | number, data: Partial<Room>): Promise<Room> {
    try {
      return await api.patch(`rooms/${id}`, { json: data }).json<Room>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update room',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update room');
    }
  }

  static async updateRoomStatus(id: string | number, data: RoomStatusUpdateInput): Promise<Room> {
    try {
      return await api.put(`rooms/${id}/status`, { json: data }).json<Room>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to update room status',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to update room status');
    }
  }

  static async endMaintenance(roomId: string | number): Promise<Room> {
    try {
      return await api.post(`rooms/${roomId}/end-maintenance`).json<Room>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to end maintenance',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to end maintenance');
    }
  }

  static async executeRoomChange(roomId: string | number, targetRoomId: string): Promise<any> {
    try {
      return await api.post(`rooms/${roomId}/execute-change`, {
        json: { target_room_id: parseInt(targetRoomId, 10) }
      }).json();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to execute room change',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to execute room change');
    }
  }

  static async createRoomEvent(roomId: string | number, event: RoomEventInput): Promise<RoomEvent> {
    try {
      return await api.post(`rooms/${roomId}/events`, { json: event }).json<RoomEvent>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to create room event',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to create room event');
    }
  }

  static async getRoomDetailedStatus(roomId: string | number): Promise<RoomDetailedStatus> {
    try {
      return await api.get(`rooms/${roomId}/detailed`).json<RoomDetailedStatus>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch room detailed status',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch room detailed status');
    }
  }

  static async getRoomHistory(roomId: string | number): Promise<RoomHistory[]> {
    const url = `rooms/${roomId}/history`;
    const fullUrl = API_BASE_URL ? `${API_BASE_URL}/${url}` : `/${url}`;
    console.log('[API] Fetching room history:', url, 'Full URL:', fullUrl, 'Env:', process.env.NODE_ENV);
    try {
      const response = await api.get(url, {
        timeout: 60000,
        retry: {
          limit: 3,
          methods: ['get'],
          statusCodes: [408, 413, 429, 500, 502, 503, 504],
          backoffLimit: 3000
        }
      }).json<RoomHistory[]>();
      console.log('[API] Room history loaded successfully:', response);
      return response;
    } catch (error) {
      console.error('[API] Room history failed:', error);
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch room history',
          error.response.status,
          errorData
        );
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new APIError('Request was cancelled');
      }
      if (error instanceof Error && (error.message.includes('fetch') || error.message.includes('Load failed'))) {
        throw new APIError('Network error - backend may not be accessible. Check if backend is running on port 3030.');
      }
      throw new APIError('Failed to fetch room history');
    }
  }

  static async createRoom(roomData: {
    room_number: string;
    room_type_id: number;
    floor: number;
    building?: string;
    custom_price?: number;
    is_accessible?: boolean;
  }): Promise<Room> {
    try {
      return await api.post('rooms', { json: roomData }).json<Room>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to create room',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to create room');
    }
  }

  static async deleteRoom(roomId: number): Promise<{ success: boolean; message: string }> {
    try {
      return await api.delete(`rooms/${roomId}`).json<{ success: boolean; message: string }>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to delete room',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to delete room');
    }
  }

  static async getRoomTypes(): Promise<Array<{ id: number; name: string; code: string; base_price: number }>> {
    try {
      return await api.get('room-types').json<Array<{ id: number; name: string; code: string; base_price: number }>>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch room types',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch room types');
    }
  }

  static async getRoomReviews(roomType: string): Promise<any[]> {
    return await api.get(`rooms/${encodeURIComponent(roomType)}/reviews`).json<any[]>();
  }

  static formatRoomForDisplay(room: Room): RoomWithDisplay {
    return {
      ...room,
      displayPrice: `$${typeof room.price_per_night === 'number' ? room.price_per_night.toFixed(0) : room.price_per_night}/night`,
      availabilityText: room.available ? 'Available' : 'Booked',
    };
  }

  // ==================== OCCUPANCY METHODS ====================
  // Automatic occupancy derived from bookings - no manual input required

  /** Get all rooms with their current occupancy status */
  static async getAllRoomOccupancy(): Promise<RoomCurrentOccupancy[]> {
    try {
      return await api.get('rooms/occupancy').json<RoomCurrentOccupancy[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch room occupancy',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch room occupancy');
    }
  }

  /** Get occupancy for a specific room */
  static async getRoomOccupancy(roomId: string | number): Promise<RoomCurrentOccupancy> {
    try {
      return await api.get(`rooms/${roomId}/occupancy`).json<RoomCurrentOccupancy>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch room occupancy',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch room occupancy');
    }
  }

  /** Get hotel-wide occupancy summary */
  static async getHotelOccupancySummary(): Promise<HotelOccupancySummary> {
    try {
      return await api.get('rooms/occupancy/summary').json<HotelOccupancySummary>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch hotel occupancy summary',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch hotel occupancy summary');
    }
  }

  /** Get occupancy breakdown by room type */
  static async getOccupancyByRoomType(): Promise<OccupancyByRoomType[]> {
    try {
      return await api.get('rooms/occupancy/by-type').json<OccupancyByRoomType[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch occupancy by room type',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch occupancy by room type');
    }
  }

  /** Get rooms with their occupancy combined */
  static async getRoomsWithOccupancy(): Promise<RoomWithOccupancy[]> {
    try {
      return await api.get('rooms/with-occupancy').json<RoomWithOccupancy[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch rooms with occupancy',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch rooms with occupancy');
    }
  }
}
