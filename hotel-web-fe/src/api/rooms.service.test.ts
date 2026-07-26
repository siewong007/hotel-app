import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
      patch: (...args: any[]) => patch(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { RoomsService } from './rooms.service';
import { APIError } from './client';
import type {
  Room,
  RoomStatusUpdateInput,
  RoomEventInput,
  RoomTypeCreateInput,
  RoomTypeUpdateInput,
} from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

function httpErrorWith(status: number, body: unknown) {
  const httpError = Object.create(HTTPError.prototype);
  httpError.response = {
    status,
    json: () => Promise.resolve(body),
  };
  return httpError;
}

function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    room_number: '101',
    room_type: 'Deluxe',
    price_per_night: 150,
    available: true,
    max_occupancy: 2,
    ...overrides,
  };
}

function resetMocks() {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  patch.mockReset();
  del.mockReset();
}

describe('RoomsService.getAllRooms', () => {
  beforeEach(resetMocks);

  it('GETs rooms and returns the list', async () => {
    const payload = [buildRoom()];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getAllRooms();

    expect(get).toHaveBeenCalledWith('rooms');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.searchRooms', () => {
  beforeEach(resetMocks);

  it('GETs rooms/available with no searchParams when no filters are given', async () => {
    get.mockReturnValue(mockJsonResponse([]));

    await RoomsService.searchRooms();

    expect(get).toHaveBeenCalledWith('rooms/available', { searchParams: {} });
  });

  it('forwards room_type when provided', async () => {
    get.mockReturnValue(mockJsonResponse([]));

    await RoomsService.searchRooms('Deluxe');

    expect(get).toHaveBeenCalledWith('rooms/available', { searchParams: { room_type: 'Deluxe' } });
  });

  it('forwards max_price when provided', async () => {
    get.mockReturnValue(mockJsonResponse([]));

    await RoomsService.searchRooms(undefined, 300);

    expect(get).toHaveBeenCalledWith('rooms/available', { searchParams: { max_price: 300 } });
  });

  it('forwards both room_type and max_price when provided', async () => {
    get.mockReturnValue(mockJsonResponse([]));

    await RoomsService.searchRooms('Suite', 500);

    expect(get).toHaveBeenCalledWith('rooms/available', {
      searchParams: { room_type: 'Suite', max_price: 500 },
    });
  });
});

describe('RoomsService.getAvailableRoomsForDates', () => {
  beforeEach(resetMocks);

  it('always forwards check_in_date and check_out_date', async () => {
    get.mockReturnValue(mockJsonResponse([]));

    await RoomsService.getAvailableRoomsForDates('2026-02-01', '2026-02-05');

    expect(get).toHaveBeenCalledWith('rooms/available', {
      searchParams: { check_in_date: '2026-02-01', check_out_date: '2026-02-05' },
    });
  });

  it('forwards exclude_booking_id when provided', async () => {
    get.mockReturnValue(mockJsonResponse([]));

    await RoomsService.getAvailableRoomsForDates('2026-02-01', '2026-02-05', 99);

    expect(get).toHaveBeenCalledWith('rooms/available', {
      searchParams: {
        check_in_date: '2026-02-01',
        check_out_date: '2026-02-05',
        exclude_booking_id: 99,
      },
    });
  });
});

describe('RoomsService.updateRoom', () => {
  beforeEach(resetMocks);

  it('PATCHes rooms/<id> with the partial data as json', async () => {
    const data = { status: 'dirty' };
    const payload = buildRoom({ status: 'dirty' });
    patch.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.updateRoom('room-1', data);

    expect(patch).toHaveBeenCalledWith('rooms/room-1', { json: data });
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    patch.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(409, { error: 'Room locked' })),
    });

    await expect(RoomsService.updateRoom('room-1', {})).rejects.toMatchObject({
      message: 'Room locked',
      statusCode: 409,
    });
    await expect(RoomsService.updateRoom('room-1', {})).rejects.toBeInstanceOf(APIError);
  });

  it('throws a generic APIError on non-HTTP failures', async () => {
    patch.mockReturnValue({ json: () => Promise.reject(new Error('network down')) });

    await expect(RoomsService.updateRoom('room-1', {})).rejects.toMatchObject({
      message: 'Failed to update room',
    });
  });
});

describe('RoomsService.updateRoomStatus', () => {
  beforeEach(resetMocks);

  it('PUTs rooms/<id>/status with the status data as json', async () => {
    const data: RoomStatusUpdateInput = { status: 'maintenance', notes: 'AC broken' };
    const payload = buildRoom({ status: 'maintenance' });
    put.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.updateRoomStatus('room-1', data);

    expect(put).toHaveBeenCalledWith('rooms/room-1/status', { json: data });
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    put.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(400, { error: 'Invalid status' })),
    });

    await expect(
      RoomsService.updateRoomStatus('room-1', { status: 'occupied' }),
    ).rejects.toMatchObject({ message: 'Invalid status', statusCode: 400 });
  });
});

describe('RoomsService.endMaintenance', () => {
  beforeEach(resetMocks);

  it('POSTs rooms/<id>/end-maintenance', async () => {
    const payload = buildRoom({ status: 'available' });
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.endMaintenance('room-1');

    expect(post).toHaveBeenCalledWith('rooms/room-1/end-maintenance');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    post.mockReturnValue({ json: () => Promise.reject(httpErrorWith(500, {})) });

    await expect(RoomsService.endMaintenance('room-1')).rejects.toMatchObject({
      message: 'Failed to end maintenance',
    });
  });
});

describe('RoomsService.syncRoomStatuses', () => {
  beforeEach(resetMocks);

  it('POSTs rooms/sync-statuses and returns the sync result', async () => {
    const payload = { success: true, synced_count: 3, changes: [], message: 'Synced' };
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.syncRoomStatuses();

    expect(post).toHaveBeenCalledWith('rooms/sync-statuses');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    post.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(500, { error: 'Sync failed' })),
    });

    await expect(RoomsService.syncRoomStatuses()).rejects.toMatchObject({
      message: 'Sync failed',
    });
  });
});

describe('RoomsService.executeRoomChange', () => {
  beforeEach(resetMocks);

  it('POSTs rooms/<id>/execute-change with the target room id parsed to a number', async () => {
    post.mockReturnValue(mockJsonResponse({ success: true }));

    await RoomsService.executeRoomChange('room-1', '42');

    expect(post).toHaveBeenCalledWith('rooms/room-1/execute-change', {
      json: { target_room_id: 42 },
    });
  });

  it('surfaces backend error messages as an APIError', async () => {
    post.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(409, { error: 'Target room occupied' })),
    });

    await expect(RoomsService.executeRoomChange('room-1', '42')).rejects.toMatchObject({
      message: 'Target room occupied',
      statusCode: 409,
    });
  });
});

describe('RoomsService.createRoomEvent', () => {
  beforeEach(resetMocks);

  it('POSTs rooms/<id>/events with the event as json', async () => {
    const event: RoomEventInput = {
      event_type: 'maintenance',
      status: 'pending',
      notes: 'AC check',
    };
    const payload = {
      id: 'evt-1',
      room_id: 'room-1',
      ...event,
      created_by: 'staff-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.createRoomEvent('room-1', event);

    expect(post).toHaveBeenCalledWith('rooms/room-1/events', { json: event });
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    post.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(400, { error: 'Invalid event' })),
    });

    await expect(
      RoomsService.createRoomEvent('room-1', { event_type: 'maintenance', status: 'pending' }),
    ).rejects.toMatchObject({ message: 'Invalid event' });
  });
});

describe('RoomsService.getRoomDetailedStatus', () => {
  beforeEach(resetMocks);

  it('GETs rooms/<id>/detailed', async () => {
    const payload = {
      id: 'room-1',
      room_number: '101',
      room_type: 'Deluxe',
      status: 'available',
      available: true,
      recent_events: [],
    };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomDetailedStatus('room-1');

    expect(get).toHaveBeenCalledWith('rooms/room-1/detailed');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    get.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(404, { error: 'Room not found' })),
    });

    await expect(RoomsService.getRoomDetailedStatus('room-1')).rejects.toMatchObject({
      message: 'Room not found',
      statusCode: 404,
    });
  });
});

describe('RoomsService.getRoomHistory', () => {
  beforeEach(() => {
    resetMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('GETs rooms/<id>/history with a timeout and retry config, returning the list', async () => {
    const payload = [
      { id: 'h-1', room_id: 'room-1', to_status: 'available', created_at: '2026-01-01T00:00:00Z' },
    ];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomHistory('room-1');

    expect(get).toHaveBeenCalledWith(
      'rooms/room-1/history',
      expect.objectContaining({
        timeout: 60000,
        retry: expect.objectContaining({ limit: 3, methods: ['get'] }),
      }),
    );
    expect(result).toEqual(payload);
  });

  it('wraps an HTTPError as an APIError using the backend message', async () => {
    get.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(500, { error: 'History fetch failed' })),
    });

    await expect(RoomsService.getRoomHistory('room-1')).rejects.toMatchObject({
      message: 'History fetch failed',
      statusCode: 500,
    });
  });

  it('reports cancellation as "Request was cancelled" for AbortError', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    get.mockReturnValue({ json: () => Promise.reject(abortError) });

    await expect(RoomsService.getRoomHistory('room-1')).rejects.toMatchObject({
      message: 'Request was cancelled',
    });
  });

  it('reports a network-unreachable message when the error mentions "fetch"', async () => {
    get.mockReturnValue({ json: () => Promise.reject(new Error('Failed to fetch')) });

    await expect(RoomsService.getRoomHistory('room-1')).rejects.toMatchObject({
      message: 'Network error - backend may not be accessible. Check if backend is running on port 3030.',
    });
  });

  it('reports a network-unreachable message when the error mentions "Load failed"', async () => {
    get.mockReturnValue({ json: () => Promise.reject(new Error('Load failed')) });

    await expect(RoomsService.getRoomHistory('room-1')).rejects.toMatchObject({
      message: 'Network error - backend may not be accessible. Check if backend is running on port 3030.',
    });
  });

  it('falls back to a generic message for any other error', async () => {
    get.mockReturnValue({ json: () => Promise.reject(new Error('boom')) });

    await expect(RoomsService.getRoomHistory('room-1')).rejects.toMatchObject({
      message: 'Failed to fetch room history',
    });
  });
});

describe('RoomsService.createRoom', () => {
  beforeEach(resetMocks);

  const roomData = {
    room_number: '202',
    room_type: 'Suite',
    room_type_id: 2,
    price_per_night: 250,
    max_occupancy: 4,
    floor: 2,
  };

  it('POSTs rooms with the room data as json', async () => {
    const payload = buildRoom({ room_number: '202' });
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.createRoom(roomData);

    expect(post).toHaveBeenCalledWith('rooms', { json: roomData });
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    post.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(400, { error: 'Room number taken' })),
    });

    await expect(RoomsService.createRoom(roomData)).rejects.toMatchObject({
      message: 'Room number taken',
    });
  });
});

describe('RoomsService.deleteRoom', () => {
  beforeEach(resetMocks);

  it('DELETEs rooms/<id>', async () => {
    const payload = { success: true, message: 'Room deleted' };
    del.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.deleteRoom(7);

    expect(del).toHaveBeenCalledWith('rooms/7');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    del.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(409, { error: 'Room has bookings' })),
    });

    await expect(RoomsService.deleteRoom(7)).rejects.toMatchObject({
      message: 'Room has bookings',
    });
  });
});

describe('RoomsService.getRoomTypes', () => {
  beforeEach(resetMocks);

  it('GETs room-types', async () => {
    const payload = [{ id: 1, name: 'Deluxe' }];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomTypes();

    expect(get).toHaveBeenCalledWith('room-types');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    get.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(500, { error: 'Query failed' })),
    });

    await expect(RoomsService.getRoomTypes()).rejects.toMatchObject({
      message: 'Query failed',
    });
  });
});

describe('RoomsService.getAllRoomTypes', () => {
  beforeEach(resetMocks);

  it('GETs room-types/all', async () => {
    const payload = [{ id: 1, name: 'Deluxe' }];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getAllRoomTypes();

    expect(get).toHaveBeenCalledWith('room-types/all');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.getRoomType', () => {
  beforeEach(resetMocks);

  it('GETs room-types/<id>', async () => {
    const payload = { id: 3, name: 'Suite' };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomType(3);

    expect(get).toHaveBeenCalledWith('room-types/3');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.createRoomType', () => {
  beforeEach(resetMocks);

  it('POSTs room-types with the input as json', async () => {
    const input: RoomTypeCreateInput = { name: 'Penthouse', code: 'PH', base_price: 500 };
    const payload = { id: 9, ...input };
    post.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.createRoomType(input);

    expect(post).toHaveBeenCalledWith('room-types', { json: input });
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.updateRoomType', () => {
  beforeEach(resetMocks);

  it('PATCHes room-types/<id> with the input as json', async () => {
    const input: RoomTypeUpdateInput = { name: 'Updated Suite' };
    const payload = { id: 3, name: 'Updated Suite' };
    patch.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.updateRoomType(3, input);

    expect(patch).toHaveBeenCalledWith('room-types/3', { json: input });
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.deleteRoomType', () => {
  beforeEach(resetMocks);

  it('DELETEs room-types/<id>', async () => {
    const payload = { success: true, message: 'Room type deleted' };
    del.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.deleteRoomType(3);

    expect(del).toHaveBeenCalledWith('room-types/3');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.getRoomReviews', () => {
  beforeEach(resetMocks);

  it('GETs rooms/<url-encoded room type>/reviews', async () => {
    const payload = [{ rating: 5, comment: 'Great stay' }];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomReviews('Deluxe Suite');

    expect(get).toHaveBeenCalledWith('rooms/Deluxe%20Suite/reviews');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.formatRoomForDisplay', () => {
  it('formats a numeric price to a whole-dollar amount and marks it available', () => {
    const room = buildRoom({ price_per_night: 150, available: true });

    const result = RoomsService.formatRoomForDisplay(room);

    expect(result.displayPrice).toBe('$150/night');
    expect(result.availabilityText).toBe('Available');
  });

  it('passes through a string price unchanged and marks it booked', () => {
    const room = buildRoom({ price_per_night: '199.99', available: false });

    const result = RoomsService.formatRoomForDisplay(room);

    expect(result.displayPrice).toBe('$199.99/night');
    expect(result.availabilityText).toBe('Booked');
  });
});

describe('RoomsService.getAllRoomOccupancy', () => {
  beforeEach(resetMocks);

  it('GETs rooms/occupancy', async () => {
    const payload = [
      {
        room_id: 1,
        room_number: '101',
        current_adults: 2,
        current_children: 0,
        current_infants: 0,
        current_total_guests: 2,
        is_occupied: true,
      },
    ];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getAllRoomOccupancy();

    expect(get).toHaveBeenCalledWith('rooms/occupancy');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    get.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(500, { error: 'Occupancy query failed' })),
    });

    await expect(RoomsService.getAllRoomOccupancy()).rejects.toMatchObject({
      message: 'Occupancy query failed',
    });
  });
});

describe('RoomsService.getRoomOccupancy', () => {
  beforeEach(resetMocks);

  it('GETs rooms/<id>/occupancy', async () => {
    const payload = {
      room_id: 1,
      room_number: '101',
      current_adults: 1,
      current_children: 0,
      current_infants: 0,
      current_total_guests: 1,
      is_occupied: true,
    };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomOccupancy('room-1');

    expect(get).toHaveBeenCalledWith('rooms/room-1/occupancy');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.getHotelOccupancySummary', () => {
  beforeEach(resetMocks);

  it('GETs rooms/occupancy/summary', async () => {
    const payload = {
      total_rooms: 10,
      occupied_rooms: 4,
      available_rooms: 6,
      total_adults: 8,
      total_children: 0,
      total_infants: 0,
      total_guests: 8,
      total_capacity: 20,
    };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getHotelOccupancySummary();

    expect(get).toHaveBeenCalledWith('rooms/occupancy/summary');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.getOccupancyByRoomType', () => {
  beforeEach(resetMocks);

  it('GETs rooms/occupancy/by-type', async () => {
    const payload = [{ total_rooms: 5, occupied_rooms: 2, total_guests: 4, total_capacity: 10 }];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getOccupancyByRoomType();

    expect(get).toHaveBeenCalledWith('rooms/occupancy/by-type');
    expect(result).toEqual(payload);
  });
});

describe('RoomsService.getRoomsWithOccupancy', () => {
  beforeEach(resetMocks);

  it('GETs rooms/with-occupancy', async () => {
    const payload = [
      {
        ...buildRoom(),
        current_adults: 2,
        current_children: 0,
        current_infants: 0,
        current_total_guests: 2,
        is_occupied: true,
      },
    ];
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RoomsService.getRoomsWithOccupancy();

    expect(get).toHaveBeenCalledWith('rooms/with-occupancy');
    expect(result).toEqual(payload);
  });
});
