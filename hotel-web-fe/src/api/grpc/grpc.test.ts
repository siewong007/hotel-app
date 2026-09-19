import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';
import { create, fromJson } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';

import { grpcInterceptor, resetGrpcTransportForTests } from '../grpcClient';
import { grpcEnabled, setGrpcContexts } from './flags';
import { roomFromPb } from './rooms';
import { taskFromPb } from './housekeeping';
import { guestFromPb } from './guests';
import { enumToRest, restToEnum, nameId, moneyToMajor } from './convert';
import { setAccessToken, clearAccessToken } from '../../auth/tokenStore';
import { queryClient } from '../queryClient';
import { storage } from '../../utils/storage';
import { RoomSchema, RoomStatus } from '../../gen/hotel/rooms/v1/room_pb';
import {
  HousekeepingTaskSchema,
  HousekeepingPriority,
} from '../../gen/hotel/housekeeping/v1/housekeeping_pb';
import {
  GuestSchema,
  GuestType as PbGuestType,
  TourismType as PbTourismType,
} from '../../gen/hotel/guests/v1/guest_pb';

// refreshAccessToken is the single seam the interceptor shares with the REST
// client; the mock keeps the real HttpOnly-cookie request out of tests.
const refreshMock = vi.fn<() => Promise<{ access_token: string } | null>>();
vi.mock('../client', async importOriginal => {
  const actual = await importOriginal<typeof import('../client')>();
  return { ...actual, refreshAccessToken: (...args: unknown[]) => refreshMock(...(args as [])) };
});

function unaryRequest(overrides: Record<string, unknown> = {}) {
  return {
    stream: false as const,
    service: { typeName: 'hotel.rooms.v1.RoomService' },
    method: { name: 'ListRooms' },
    header: new Headers(),
    message: {},
    requestMethod: 'POST',
    url: 'http://localhost/hotel.rooms.v1.RoomService/ListRooms',
    signal: new AbortController().signal,
    contextValues: undefined,
    ...overrides,
  } as any;
}

const unaryResponse = {
  stream: false as const,
  message: {},
  header: new Headers(),
  trailer: new Headers(),
} as any;

beforeEach(() => {
  clearAccessToken();
  storage.removeItem('grpcContexts');
  resetGrpcTransportForTests();
});

afterEach(() => {
  refreshMock.mockReset();
  clearAccessToken();
  storage.removeItem('grpcContexts');
  vi.restoreAllMocks();
});

describe('grpcEnabled', () => {
  it('defaults every context off (REST stays the default transport)', () => {
    expect(grpcEnabled('rooms')).toBe(false);
    expect(grpcEnabled('housekeeping')).toBe(false);
    expect(grpcEnabled('maintenance')).toBe(false);
    expect(grpcEnabled('guests')).toBe(false);
  });

  it('honors the storage override, including an empty list forcing all off', () => {
    setGrpcContexts(['rooms']);
    expect(grpcEnabled('rooms')).toBe(true);
    expect(grpcEnabled('housekeeping')).toBe(false);
    setGrpcContexts([]);
    expect(grpcEnabled('rooms')).toBe(false);
    setGrpcContexts(null);
    expect(grpcEnabled('rooms')).toBe(false);
  });
});

describe('grpcInterceptor', () => {
  it('injects the bearer token and locale headers', async () => {
    setAccessToken('tok-123');
    const next = vi.fn(async () => unaryResponse);
    const req = unaryRequest();

    await grpcInterceptor(next)(req);

    expect(req.header.get('authorization')).toBe('Bearer tok-123');
    expect(req.header.get('accept-language')).toBeTruthy();
    expect(next).toHaveBeenCalledOnce();
  });

  it('refreshes once on Unauthenticated and retries with the fresh token', async () => {
    setAccessToken('stale');
    refreshMock.mockImplementation(async () => {
      setAccessToken('fresh');
      return { access_token: 'fresh' };
    });
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError('unauthenticated', Code.Unauthenticated))
      .mockResolvedValueOnce(unaryResponse);

    const res = await grpcInterceptor(next)(unaryRequest());

    expect(refreshMock).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledTimes(2);
    expect(res).toBe(unaryResponse);
  });

  it('clears auth and fires auth:unauthorized when refresh fails', async () => {
    setAccessToken('stale');
    refreshMock.mockResolvedValue(null);
    const next = vi.fn().mockRejectedValue(new ConnectError('unauthenticated', Code.Unauthenticated));
    const listener = vi.fn();
    window.addEventListener('auth:unauthorized', listener);

    await expect(grpcInterceptor(next)(unaryRequest())).rejects.toThrow(ConnectError);

    expect(listener).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    window.removeEventListener('auth:unauthorized', listener);
  });

  it('does not refresh on non-auth errors', async () => {
    setAccessToken('tok');
    const next = vi.fn().mockRejectedValue(new ConnectError('denied', Code.PermissionDenied));

    await expect(grpcInterceptor(next)(unaryRequest())).rejects.toThrow(ConnectError);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('invalidates the rooms domain after a mutating RPC succeeds', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const next = vi.fn(async () => unaryResponse);
    const req = unaryRequest({ method: { name: 'UpdateRoom' } });

    await grpcInterceptor(next)(req);

    expect(invalidate).toHaveBeenCalled();
  });

  it('does not invalidate after read RPCs', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const next = vi.fn(async () => unaryResponse);

    await grpcInterceptor(next)(unaryRequest({ method: { name: 'ListRooms' } }));

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('convert helpers', () => {
  it('extracts ids from resource names', () => {
    expect(nameId('rooms/42')).toBe(42);
    expect(nameId('housekeepingTasks/7')).toBe(7);
  });

  it('converts Money minor units to major-unit numbers', () => {
    expect(moneyToMajor({ $typeName: 'hotel.common.v1.Money', amountMinor: 15050n, currencyCode: 'MYR' })).toBe(150.5);
  });

  it('maps pb enums to REST strings and back', () => {
    expect(enumToRest(RoomStatus, RoomStatus.RESERVED_DIRTY)).toBe('reserved_dirty');
    expect(enumToRest(RoomStatus, RoomStatus.UNSPECIFIED)).toBeUndefined();
    expect(restToEnum(RoomStatus, 'out_of_order')).toBe(RoomStatus.OUT_OF_ORDER);
    expect(restToEnum(RoomStatus, undefined)).toBeUndefined();
    expect(restToEnum(RoomStatus, 'nonexistent')).toBeUndefined();
  });
});

describe('pb → REST converters', () => {
  it('maps a Room message to the REST Room shape', () => {
    const pb = create(RoomSchema, {
      name: 'rooms/12',
      roomNumber: '201',
      roomType: 'Deluxe',
      roomTypeCode: 'DLX',
      pricePerNight: { $typeName: 'hotel.common.v1.Money', amountMinor: 25000n, currencyCode: 'MYR' },
      available: true,
      status: RoomStatus.RESERVED_DIRTY,
      maxOccupancy: 3,
      isSmoking: true,
    });

    const room = roomFromPb(pb);

    expect(room.id).toBe('12');
    expect(room.room_number).toBe('201');
    expect(room.room_type).toBe('Deluxe');
    expect(room.room_type_code).toBe('DLX');
    expect(room.price_per_night).toBe(250);
    expect(room.status).toBe('reserved_dirty');
    expect(room.is_smoking).toBe(true);
  });

  it('keeps free-form items_used JSON identical across the wire', () => {
    const items = ['lightbulb', { sku: 'ABC', qty: 2 }];
    const pb = create(HousekeepingTaskSchema, {
      name: 'housekeepingTasks/5',
      room: 'rooms/9',
      priority: HousekeepingPriority.HIGH,
      itemsUsed: fromJson(ValueSchema, items),
    });

    const task = taskFromPb(pb);

    expect(task.id).toBe(5);
    expect(task.room_id).toBe(9);
    expect(task.priority).toBe('high');
    expect(task.items_used).toEqual(items);
  });

  it('maps a Guest message to the REST Guest shape', () => {
    const pb = create(GuestSchema, {
      name: 'guests/7',
      nickName: 'Riley Seven',
      firstName: 'Riley',
      lastName: 'Seven',
      email: 'riley@hotel.local',
      isActive: true,
      guestType: PbGuestType.MEMBER,
      tourismType: PbTourismType.FOREIGN,
      discountPercentage: 15,
      companyName: 'Acme',
      vipStatus: 'vip-gold',
      tags: ['repeat', 'corporate'],
      isBlacklisted: false,
      bookingsCount: 4n,
      hasOpenSupport: true,
      ekycSummary: {
        $typeName: 'hotel.guests.v1.GuestEkycStatusSummary',
        guest: 'guests/7',
        status: 'verified',
        selfCheckinEnabled: true,
        canAutoCheckin: true,
      },
    });

    const guest = guestFromPb(pb);

    expect(guest.id).toBe(7);
    expect(guest.nick_name).toBe('Riley Seven');
    expect(guest.first_name).toBe('Riley');
    expect(guest.guest_type).toBe('member');
    expect(guest.tourism_type).toBe('foreign');
    expect(guest.discount_percentage).toBe(15);
    expect(guest.company_name).toBe('Acme');
    expect(guest.vip_status).toBe('vip-gold');
    expect(guest.tags).toEqual(['repeat', 'corporate']);
    expect(guest.is_blacklisted).toBe(false);
    expect(guest.bookings_count).toBe(4);
    expect(guest.has_open_support).toBe(true);
    expect((guest as any).ekyc_summary.status).toBe('verified');
    expect((guest as any).ekyc_summary.guest_id).toBe(7);
  });

  it('omits absent optional fields exactly like REST skip_serializing_if', () => {
    const pb = create(GuestSchema, {
      name: 'guests/8',
      nickName: 'Slim Guest',
      isActive: true,
      guestType: PbGuestType.NON_MEMBER,
    });

    const guest = guestFromPb(pb) as unknown as Record<string, unknown>;

    expect(guest.vip_status).toBeUndefined();
    expect('vip_status' in guest).toBe(false);
    expect('tags' in guest).toBe(false);
    expect('is_blacklisted' in guest).toBe(false);
    expect('bookings_count' in guest).toBe(false);
    expect('ekyc_summary' in guest).toBe(false);
    expect(guest.first_name).toBeNull();
  });
});
