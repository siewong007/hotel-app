// gRPC implementations of RoomsService methods — same public signatures,
// same REST-shaped return values. Each function here replaces exactly one
// REST call inside RoomsService when the 'rooms' context flag is on.
//
// Conventions:
//   - pb responses → REST wire shapes via ./convert helpers (snake keys,
//     major-unit money, ISO strings, plain-JSON free-form fields).
//   - Resource names: ids become "rooms/{id}" / "roomTypes/{id}" etc.
//   - Unpaginated REST list endpoints loop pages until next_page_token is
//     empty — callers must see the same complete array REST returned.
//   - Responses REST emits but the contract dropped (delete confirmations)
//     are synthesized with the same literals the REST handler produces.

import { ConnectError, Code } from '@connectrpc/connect';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';

import { APIError } from '../client';
import { roomClient, roomTypeClient } from '../grpcClient';
import {
  nameId,
  nameIdString,
  roomName,
  roomTypeName,
  bookingName,
  moneyToMajor,
  majorToMoney,
  decimalToNumber,
  tsToIso,
  gdateToString,
  stringToGdate,
  enumToRest,
  restToEnum,
} from './convert';
import { RoomStatus } from '../../gen/hotel/rooms/v1/room_pb';
import type {
  Room,
  RoomEvent,
  RoomDetailedStatus,
  RoomEventInput,
  RoomHistory,
  RoomStatusSyncResult,
  RoomStatusUpdateInput,
  RoomType,
  RoomTypeCreateInput,
  RoomTypeUpdateInput,
  RoomCurrentOccupancy,
  HotelOccupancySummary,
  OccupancyByRoomType,
  RoomWithOccupancy,
} from '../../types';
import type { BookingWithDetails } from '../../types/booking.types';
import type {
  Room as PbRoom,
  RoomType as PbRoomType,
  RoomEvent as PbRoomEvent,
  RoomBookingSummary,
  RoomStatusChange,
  RoomOccupancy,
  RoomTypeOccupancy,
} from '../../gen/hotel/rooms/v1/room_pb';

function toGrpcError(error: unknown, fallback: string): APIError {
  if (error instanceof ConnectError) {
    if (error.code === Code.Unauthenticated) {
      return new APIError(error.message, 401);
    }
    return new APIError(error.message || fallback);
  }
  return error instanceof APIError ? error : new APIError(fallback);
}

// ---------------------------------------------------------------------------
// pb → REST shapes
// ---------------------------------------------------------------------------

export function roomFromPb(r: PbRoom): Room {
  return {
    id: nameIdString(r.name),
    room_number: r.roomNumber,
    room_type: r.roomType,
    ...(r.roomTypeCode ? { room_type_code: r.roomTypeCode } : {}),
    price_per_night: moneyToMajor(r.pricePerNight) ?? 0,
    available: r.available,
    ...(r.description ? { description: r.description } : {}),
    max_occupancy: r.maxOccupancy,
    ...(r.averageRating ? { average_rating: decimalToNumber(r.averageRating) } : {}),
    ...(r.reviewCount !== undefined ? { review_count: Number(r.reviewCount) } : {}),
    ...(enumToRest(RoomStatus, r.status) ? { status: enumToRest(RoomStatus, r.status) } : {}),
    ...(r.floor !== undefined ? { floor: r.floor } : {}),
    ...(tsToIso(r.reservedStartDate) ? { reserved_start_date: tsToIso(r.reservedStartDate) } : {}),
    ...(tsToIso(r.reservedEndDate) ? { reserved_end_date: tsToIso(r.reservedEndDate) } : {}),
    ...(tsToIso(r.maintenanceStartDate) ? { maintenance_start_date: tsToIso(r.maintenanceStartDate) } : {}),
    ...(tsToIso(r.maintenanceEndDate) ? { maintenance_end_date: tsToIso(r.maintenanceEndDate) } : {}),
    ...(tsToIso(r.cleaningStartDate) ? { cleaning_start_date: tsToIso(r.cleaningStartDate) } : {}),
    ...(tsToIso(r.cleaningEndDate) ? { cleaning_end_date: tsToIso(r.cleaningEndDate) } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.isSmoking !== undefined ? { is_smoking: r.isSmoking } : {}),
  };
}

export function roomTypeFromPb(t: PbRoomType): RoomType {
  return {
    id: nameId(t.name),
    name: t.displayName,
    code: t.code,
    ...(t.description ? { description: t.description } : {}),
    base_price: moneyToMajor(t.basePrice) ?? 0,
    ...(t.weekdayRate ? { weekday_rate: moneyToMajor(t.weekdayRate) } : {}),
    ...(t.weekendRate ? { weekend_rate: moneyToMajor(t.weekendRate) } : {}),
    max_occupancy: t.maxOccupancy,
    ...(t.bedType ? { bed_type: t.bedType } : {}),
    ...(t.bedCount !== undefined ? { bed_count: t.bedCount } : {}),
    allows_extra_bed: t.allowsExtraBed,
    max_extra_beds: t.maxExtraBeds,
    extra_bed_charge: moneyToMajor(t.extraBedCharge) ?? 0,
    is_active: t.isActive,
    sort_order: t.sortOrder,
    ...(t.images.length ? { images: t.images } : {}),
    created_at: tsToIso(t.createdAt) ?? '',
    updated_at: tsToIso(t.updatedAt) ?? '',
  };
}

function eventFromPb(e: PbRoomEvent): RoomEvent {
  return {
    id: nameIdString(e.name),
    room_id: nameIdString(e.room),
    event_type: e.eventType as RoomEvent['event_type'],
    status: e.status as RoomEvent['status'],
    priority: (e.priority || 'normal') as RoomEvent['priority'],
    ...(e.notes ? { notes: e.notes } : {}),
    ...(tsToIso(e.scheduledDate) ? { scheduled_date: tsToIso(e.scheduledDate) } : {}),
    created_by: e.createdBy ? nameIdString(e.createdBy) : '',
    created_at: tsToIso(e.createdAt) ?? '',
    updated_at: tsToIso(e.updatedAt) ?? '',
  };
}

function historyFromPb(c: RoomStatusChange): RoomHistory {
  return {
    id: nameIdString(c.name),
    room_id: nameIdString(c.room),
    ...(enumToRest(RoomStatus, c.fromStatus) ? { from_status: enumToRest(RoomStatus, c.fromStatus) } : {}),
    to_status: enumToRest(RoomStatus, c.toStatus) ?? '',
    ...(tsToIso(c.startDate) ? { start_date: tsToIso(c.startDate) } : {}),
    ...(tsToIso(c.endDate) ? { end_date: tsToIso(c.endDate) } : {}),
    ...(c.changedBy ? { changed_by: nameIdString(c.changedBy) } : {}),
    ...(c.changedByName ? { changed_by_name: c.changedByName } : {}),
    created_at: tsToIso(c.createdAt) ?? '',
    ...(c.notes ? { notes: c.notes } : {}),
    is_auto_generated: c.isAutoGenerated,
  };
}

/**
 * The contract deliberately carries a booking *summary*, not the full
 * BookingWithDetails REST embeds. Every field the UI reads is present; the
 * rest stay undefined rather than being fabricated.
 */
function bookingSummaryFromPb(b: RoomBookingSummary): BookingWithDetails {
  return {
    id: nameIdString(b.name),
    guest_id: nameIdString(b.guest),
    room_id: nameIdString(b.room),
    booking_number: b.bookingNumber,
    guest_name: b.guestName,
    guest_email: '',
    room_number: '',
    room_type: '',
    check_in_date: gdateToString(b.checkInDate) ?? '',
    check_out_date: gdateToString(b.checkOutDate) ?? '',
    status: b.status,
    ...(b.adults !== undefined ? { adults: b.adults } : {}),
    ...(b.children !== undefined ? { children: b.children } : {}),
    room_rate: moneyToMajor(b.roomRate),
    price_per_night: moneyToMajor(b.roomRate) ?? 0,
    total_amount: moneyToMajor(b.totalAmount) ?? 0,
    ...(b.paymentStatus ? { payment_status: b.paymentStatus } : {}),
  } as BookingWithDetails;
}

function occupancyFromPb(o: RoomOccupancy): RoomCurrentOccupancy {
  return {
    room_id: nameId(o.room),
    room_number: o.roomNumber,
    ...(o.roomType ? { room_type_id: nameId(o.roomType) } : {}),
    ...(o.roomTypeName ? { room_type_name: o.roomTypeName } : {}),
    ...(o.maxOccupancy !== undefined ? { max_occupancy: o.maxOccupancy } : {}),
    ...(enumToRest(RoomStatus, o.roomStatus) ? { room_status: enumToRest(RoomStatus, o.roomStatus) } : {}),
    current_adults: o.currentAdults,
    current_children: o.currentChildren,
    current_infants: o.currentInfants,
    current_total_guests: o.currentTotalGuests,
    ...(o.occupancyPercentage ? { occupancy_percentage: decimalToNumber(o.occupancyPercentage) } : {}),
    ...(o.currentBooking ? { current_booking_id: nameId(o.currentBooking) } : {}),
    ...(o.currentBookingNumber ? { current_booking_number: o.currentBookingNumber } : {}),
    ...(o.currentGuest ? { current_guest_id: nameId(o.currentGuest) } : {}),
    ...(gdateToString(o.checkInDate) ? { check_in_date: gdateToString(o.checkInDate) } : {}),
    ...(gdateToString(o.checkOutDate) ? { check_out_date: gdateToString(o.checkOutDate) } : {}),
    is_occupied: o.isOccupied,
  };
}

// ---------------------------------------------------------------------------
// RoomService RPCs
// ---------------------------------------------------------------------------

export async function getAllRooms(): Promise<Room[]> {
  const rooms: Room[] = [];
  let pageToken = '';
  do {
    const res = await roomClient().listRooms({ pageToken });
    rooms.push(...res.rooms.map(roomFromPb));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return rooms;
}

export async function searchRooms(roomType?: string, maxPrice?: number): Promise<Room[]> {
  const res = await roomClient().searchRooms({
    roomType: roomType ?? '',
    ...(maxPrice !== undefined ? { maxPrice: majorToMoney(maxPrice) } : {}),
  });
  return res.rooms.map(roomFromPb);
}

export async function getAvailableRoomsForDates(
  checkInDate: string,
  checkOutDate: string,
  excludeBookingId?: number,
): Promise<Room[]> {
  const res = await roomClient().searchRooms({
    checkInDate: stringToGdate(checkInDate),
    checkOutDate: stringToGdate(checkOutDate),
    excludeBooking: excludeBookingId ? bookingName(excludeBookingId) : '',
  });
  return res.rooms.map(roomFromPb);
}

export async function updateRoom(id: string | number, data: Partial<Room>): Promise<Room> {
  // Field-mask semantics = REST PATCH semantics: only keys present in `data`
  // are sent, keys the contract doesn't carry are ignored (serde drops them
  // the same way).
  const FIELD_MAP: Record<string, string> = {
    room_number: 'room_number',
    room_type: 'room_type',
    price_per_night: 'price_per_night',
    available: 'available',
    description: 'description',
    max_occupancy: 'max_occupancy',
    notes: 'notes',
    is_smoking: 'is_smoking',
  };
  const paths = Object.keys(data).filter(k => k in FIELD_MAP);
  const res = await roomClient().updateRoom({
    room: {
      name: roomName(id),
      roomNumber: data.room_number ?? '',
      roomType: data.room_type ?? '',
      ...(data.price_per_night !== undefined
        ? { pricePerNight: majorToMoney(data.price_per_night) }
        : {}),
      available: data.available ?? false,
      description: data.description ?? '',
      maxOccupancy: data.max_occupancy ?? 0,
      notes: data.notes ?? '',
      ...(data.is_smoking !== undefined ? { isSmoking: data.is_smoking } : {}),
      status: RoomStatus.UNSPECIFIED,
      roomTypeCode: '',
      roomTypeLink: '',
      building: '',
    },
    updateMask: { paths },
  });
  return roomFromPb(res.room!);
}

export async function updateRoomStatus(
  id: string | number,
  data: RoomStatusUpdateInput,
): Promise<Room> {
  const res = await roomClient().updateRoomStatus({
    name: roomName(id),
    status: restToEnum(RoomStatus, data.status) ?? RoomStatus.UNSPECIFIED,
    notes: data.notes ?? '',
    reservedStartDate: stringToGdate(data.reserved_start_date),
    reservedEndDate: stringToGdate(data.reserved_end_date),
    maintenanceStartDate: stringToGdate(data.maintenance_start_date),
    maintenanceEndDate: stringToGdate(data.maintenance_end_date),
    cleaningStartDate: stringToGdate(data.cleaning_start_date),
    cleaningEndDate: stringToGdate(data.cleaning_end_date),
    targetRoom: data.target_room_id ? roomName(data.target_room_id) : '',
    booking: data.booking_id ? bookingName(data.booking_id) : '',
    guest: data.guest_id ? `guests/${data.guest_id}` : '',
    reward: data.reward_id ? `rewards/${data.reward_id}` : '',
    reason: '',
  });
  return roomFromPb(res.room!);
}

export async function endMaintenance(roomId: string | number): Promise<Room> {
  const res = await roomClient().endRoomMaintenance({ name: roomName(roomId) });
  return roomFromPb(res.room!);
}

export async function syncRoomStatuses(): Promise<RoomStatusSyncResult> {
  const res = await roomClient().syncRoomStatuses({});
  return {
    success: true,
    synced_count: Number(res.syncedCount),
    changes: res.changes.map(c => ({
      room_id: nameId(c.room),
      room_number: c.roomNumber,
      old_status: enumToRest(RoomStatus, c.oldStatus) ?? '',
      new_status: enumToRest(RoomStatus, c.newStatus) ?? '',
    })),
    message: res.message,
  };
}

export async function executeRoomChange(
  roomId: string | number,
  targetRoomId: string,
  options?: { roomRateOverride?: number; reason?: string },
): Promise<any> {
  const res = await roomClient().executeRoomChange({
    name: roomName(roomId),
    targetRoom: roomName(targetRoomId),
    reason: options?.reason ?? '',
    ...(options?.roomRateOverride != null
      ? { roomRateOverride: majorToMoney(options.roomRateOverride) }
      : {}),
  });
  return {
    success: true,
    message: res.message,
    from_room_id: nameId(res.fromRoom),
    from_room_number: res.fromRoomNumber,
    to_room_id: nameId(res.toRoom),
    to_room_number: res.toRoomNumber,
    booking_id: res.booking ? nameId(res.booking) : undefined,
    reason: res.reason,
  };
}

export async function createRoomEvent(
  roomId: string | number,
  event: RoomEventInput,
): Promise<RoomEvent> {
  const res = await roomClient().createRoomEvent({
    parent: roomName(roomId),
    event: {
      name: '',
      room: '',
      eventType: event.event_type,
      status: event.status,
      priority: event.priority ?? '',
      notes: event.notes ?? '',
      ...(event.scheduled_date
        ? { scheduledDate: timestampFromDate(new Date(`${event.scheduled_date}T00:00:00Z`)) }
        : {}),
      createdBy: '',
    },
  });
  return eventFromPb(res.event!);
}

export async function getRoomDetailedStatus(roomId: string | number): Promise<RoomDetailedStatus> {
  const res = await roomClient().getRoomDetailedStatus({ name: roomName(roomId) });
  const d = res.detailedStatus!;
  const room = d.room;
  return {
    id: nameIdString(room?.name ?? ''),
    room_number: room?.roomNumber ?? '',
    room_type: room?.roomType ?? '',
    status: enumToRest(RoomStatus, room?.status) ?? '',
    available: room?.available ?? false,
    ...(d.currentBooking ? { current_booking: bookingSummaryFromPb(d.currentBooking) } : {}),
    ...(d.nextBooking ? { next_booking: bookingSummaryFromPb(d.nextBooking) } : {}),
    recent_events: d.recentEvents.map(eventFromPb),
    ...(d.maintenanceNotes ? { maintenance_notes: d.maintenanceNotes } : {}),
    ...(tsToIso(d.lastMaintenanceDate) ? { last_maintenance_date: tsToIso(d.lastMaintenanceDate) } : {}),
    ...(tsToIso(d.nextMaintenanceDate) ? { next_maintenance_date: tsToIso(d.nextMaintenanceDate) } : {}),
    ...(tsToIso(d.reservedStartDate) ? { reserved_start_date: tsToIso(d.reservedStartDate) } : {}),
    ...(tsToIso(d.reservedEndDate) ? { reserved_end_date: tsToIso(d.reservedEndDate) } : {}),
    ...(tsToIso(d.maintenanceStartDate) ? { maintenance_start_date: tsToIso(d.maintenanceStartDate) } : {}),
    ...(tsToIso(d.maintenanceEndDate) ? { maintenance_end_date: tsToIso(d.maintenanceEndDate) } : {}),
    ...(tsToIso(d.cleaningStartDate) ? { cleaning_start_date: tsToIso(d.cleaningStartDate) } : {}),
    ...(tsToIso(d.cleaningEndDate) ? { cleaning_end_date: tsToIso(d.cleaningEndDate) } : {}),
    ...(d.targetRoom ? { target_room_id: nameIdString(d.targetRoom) } : {}),
    ...(d.statusNotes ? { status_notes: d.statusNotes } : {}),
  };
}

export async function getRoomHistory(roomId: string | number): Promise<RoomHistory[]> {
  const res = await roomClient().listRoomStatusHistory({ name: roomName(roomId) });
  return res.changes.map(historyFromPb);
}

export async function createRoom(roomData: {
  room_number: string;
  room_type: string;
  room_type_id: number;
  price_per_night: number;
  max_occupancy: number;
  floor: number;
  building?: string;
  custom_price?: number;
  is_accessible?: boolean;
  is_smoking?: boolean;
}): Promise<Room> {
  const res = await roomClient().createRoom({
    room: {
      name: '',
      roomNumber: roomData.room_number,
      roomType: roomData.room_type,
      roomTypeCode: '',
      pricePerNight: majorToMoney(roomData.custom_price ?? roomData.price_per_night),
      available: false,
      status: RoomStatus.UNSPECIFIED,
      description: '',
      maxOccupancy: roomData.max_occupancy,
      notes: '',
      floor: roomData.floor,
      building: roomData.building ?? '',
      isAccessible: roomData.is_accessible,
      roomTypeLink: roomTypeName(roomData.room_type_id),
      isSmoking: roomData.is_smoking,
    },
  });
  return roomFromPb(res.room!);
}

export async function deleteRoom(roomId: number): Promise<{ success: boolean; message: string }> {
  await roomClient().deleteRoom({ name: roomName(roomId) });
  return { success: true, message: 'Room and associated bookings deleted successfully' };
}

export async function getRoomTypes(): Promise<RoomType[]> {
  const res = await roomTypeClient().listRoomTypes({});
  return res.roomTypes.map(roomTypeFromPb);
}

export async function getAllRoomTypes(): Promise<RoomType[]> {
  const res = await roomTypeClient().listRoomTypes({ includeInactive: true });
  return res.roomTypes.map(roomTypeFromPb);
}

export async function getRoomType(id: number): Promise<RoomType> {
  const res = await roomTypeClient().getRoomType({ name: roomTypeName(id) });
  return roomTypeFromPb(res.roomType!);
}

export async function createRoomType(data: RoomTypeCreateInput): Promise<RoomType> {
  const res = await roomTypeClient().createRoomType({
    roomType: {
      name: '',
      displayName: data.name,
      code: data.code,
      description: data.description ?? '',
      basePrice: majorToMoney(data.base_price),
      ...(data.weekday_rate !== undefined ? { weekdayRate: majorToMoney(data.weekday_rate) } : {}),
      ...(data.weekend_rate !== undefined ? { weekendRate: majorToMoney(data.weekend_rate) } : {}),
      maxOccupancy: data.max_occupancy ?? 0,
      bedType: data.bed_type ?? '',
      ...(data.bed_count !== undefined ? { bedCount: data.bed_count } : {}),
      allowsExtraBed: data.allows_extra_bed ?? false,
      maxExtraBeds: data.max_extra_beds ?? 0,
      extraBedCharge: majorToMoney(data.extra_bed_charge),
      isActive: true,
      sortOrder: data.sort_order ?? 0,
      images: [],
    },
  });
  return roomTypeFromPb(res.roomType!);
}

export async function updateRoomType(id: number, data: RoomTypeUpdateInput): Promise<RoomType> {
  const FIELD_MAP: Record<string, string> = {
    name: 'display_name',
    code: 'code',
    description: 'description',
    base_price: 'base_price',
    weekday_rate: 'weekday_rate',
    weekend_rate: 'weekend_rate',
    max_occupancy: 'max_occupancy',
    bed_type: 'bed_type',
    bed_count: 'bed_count',
    allows_extra_bed: 'allows_extra_bed',
    max_extra_beds: 'max_extra_beds',
    extra_bed_charge: 'extra_bed_charge',
    is_active: 'is_active',
    sort_order: 'sort_order',
    images: 'images',
  };
  const paths = Object.keys(data)
    .filter(k => k in FIELD_MAP)
    .map(k => FIELD_MAP[k]);
  const res = await roomTypeClient().updateRoomType({
    roomType: {
      name: roomTypeName(id),
      displayName: data.name ?? '',
      code: data.code ?? '',
      description: data.description ?? '',
      basePrice: majorToMoney(data.base_price),
      ...(data.weekday_rate !== undefined ? { weekdayRate: majorToMoney(data.weekday_rate) } : {}),
      ...(data.weekend_rate !== undefined ? { weekendRate: majorToMoney(data.weekend_rate) } : {}),
      maxOccupancy: data.max_occupancy ?? 0,
      bedType: data.bed_type ?? '',
      ...(data.bed_count !== undefined ? { bedCount: data.bed_count } : {}),
      allowsExtraBed: data.allows_extra_bed ?? false,
      maxExtraBeds: data.max_extra_beds ?? 0,
      extraBedCharge: majorToMoney(data.extra_bed_charge),
      isActive: data.is_active ?? false,
      sortOrder: data.sort_order ?? 0,
      images: data.images ?? [],
    },
    updateMask: { paths },
  });
  return roomTypeFromPb(res.roomType!);
}

export async function deleteRoomType(id: number): Promise<{ success: boolean; message: string }> {
  await roomTypeClient().deleteRoomType({ name: roomTypeName(id) });
  return { success: true, message: 'Room type deleted successfully' };
}

export async function getRoomReviews(roomType: string): Promise<any[]> {
  const res = await roomClient().listRoomReviews({ roomTypeName: roomType });
  return res.reviews.map(r => ({
    id: nameId(r.name),
    guest_id: r.guest ? nameId(r.guest) : undefined,
    guest_name: r.guestName,
    room_type_id: r.roomType ? nameId(r.roomType) : undefined,
    overall_rating: decimalToNumber(r.overallRating),
    cleanliness_rating: decimalToNumber(r.cleanlinessRating),
    staff_rating: decimalToNumber(r.staffRating),
    facilities_rating: decimalToNumber(r.facilitiesRating),
    value_rating: decimalToNumber(r.valueRating),
    location_rating: decimalToNumber(r.locationRating),
    title: r.title,
    review_text: r.reviewText,
    pros: r.pros,
    cons: r.cons,
    recommend: r.recommend,
    stay_type: r.stayType,
    is_verified: r.isVerified,
    helpful_count: r.helpfulCount,
    created_at: tsToIso(r.createdAt),
  }));
}

export async function getAllRoomOccupancy(): Promise<RoomCurrentOccupancy[]> {
  const out: RoomCurrentOccupancy[] = [];
  let pageToken = '';
  do {
    const res = await roomClient().listRoomOccupancy({ pageToken });
    out.push(...res.occupancy.map(occupancyFromPb));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

export async function getRoomOccupancy(roomId: string | number): Promise<RoomCurrentOccupancy> {
  const res = await roomClient().getRoomOccupancy({ name: roomName(roomId) });
  return occupancyFromPb(res.occupancy!);
}

export async function getHotelOccupancySummary(): Promise<HotelOccupancySummary> {
  const res = await roomClient().getOccupancySummary({});
  const s = res.summary!;
  return {
    total_rooms: Number(s.totalRooms),
    occupied_rooms: Number(s.occupiedRooms),
    available_rooms: Number(s.availableRooms),
    ...(s.occupancyRate ? { occupancy_rate: decimalToNumber(s.occupancyRate) } : {}),
    total_adults: Number(s.totalAdults),
    total_children: Number(s.totalChildren),
    total_infants: Number(s.totalInfants),
    total_guests: Number(s.totalGuests),
    total_capacity: Number(s.totalCapacity),
    ...(s.guestOccupancyRate ? { guest_occupancy_rate: decimalToNumber(s.guestOccupancyRate) } : {}),
  };
}

export async function getOccupancyByRoomType(): Promise<OccupancyByRoomType[]> {
  const res = await roomClient().listRoomTypeOccupancy({});
  return res.occupancy.map((o: RoomTypeOccupancy) => ({
    ...(o.roomType ? { room_type_id: nameId(o.roomType) } : {}),
    ...(o.roomTypeName ? { room_type_name: o.roomTypeName } : {}),
    ...(o.capacityPerRoom !== undefined ? { capacity_per_room: o.capacityPerRoom } : {}),
    total_rooms: Number(o.totalRooms),
    occupied_rooms: Number(o.occupiedRooms),
    ...(o.roomOccupancyRate ? { room_occupancy_rate: decimalToNumber(o.roomOccupancyRate) } : {}),
    total_guests: Number(o.totalGuests),
    total_capacity: Number(o.totalCapacity),
    ...(o.guestOccupancyRate ? { guest_occupancy_rate: decimalToNumber(o.guestOccupancyRate) } : {}),
  }));
}

export async function getRoomsWithOccupancy(): Promise<RoomWithOccupancy[]> {
  const out: RoomWithOccupancy[] = [];
  let pageToken = '';
  do {
    const res = await roomClient().listRoomsWithOccupancy({ pageToken });
    out.push(
      ...res.rooms.map(r => ({
        ...roomFromPb(r.room!),
        current_adults: r.currentAdults,
        current_children: r.currentChildren,
        current_infants: r.currentInfants,
        current_total_guests: r.currentTotalGuests,
        is_occupied: r.isOccupied,
        ...(r.currentBooking ? { current_booking_id: nameId(r.currentBooking) } : {}),
        ...(r.currentGuest ? { current_guest_id: nameId(r.currentGuest) } : {}),
      })),
    );
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

export { toGrpcError };
