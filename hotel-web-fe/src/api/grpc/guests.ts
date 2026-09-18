// gRPC implementations of GuestsService methods — same public signatures,
// same REST-shaped return values. Each function here replaces exactly one
// REST call inside GuestsService when the 'guests' context flag is on.
// See ./rooms.ts for conventions.
//
// Notes on parity choices:
//   - `optional` pb fields map to REST's skip_serializing_if/absent keys:
//     undefined pb → key omitted (conditional spread), matching the REST
//     payload the FE types describe.
//   - `getAllGuests` reproduces the REST page loop with the same
//     allSettled partial-tolerance — a failed page logs and is skipped,
//     never rejects the whole list.
//   - `deleteGuest`/`transferPortalAccount` synthesize the same literals
//     the REST handlers return.
//   - `getGuestBookings`/`getGuestCredits`/`getMyGuestsWithCredits` return
//     the exact shapes the service declares (extra pb/REST fields the FE
//     type doesn't name are dropped, same as the typed REST view).

import { ConnectError, Code } from '@connectrpc/connect';

import { APIError } from '../client';
import { guestClient } from '../grpcClient';
import {
  nameId,
  nameIdString,
  guestName,
  moneyToMajor,
  tsToIso,
  gdateToString,
  stringToGdate,
  enumToRest,
  restToEnum,
} from './convert';
import {
  GuestType as PbGuestType,
  TourismType as PbTourismType,
  GuestSegment as PbGuestSegment,
} from '../../gen/hotel/guests/v1/guest_pb';
import type {
  Guest as PbGuest,
  GuestBooking as PbGuestBooking,
  GuestCredits as PbGuestCredits,
  GuestCreditSummary as PbGuestCreditSummary,
  GuestEkycStatusSummary as PbEkycSummary,
  GuestProfile as PbGuestProfile,
  GuestProfileBooking as PbProfileBooking,
  GuestRoomTypeCredit as PbRoomTypeCredit,
  GuestSummary as PbGuestSummary,
  GuestTourismConversion as PbTourismConversion,
} from '../../gen/hotel/guests/v1/guest_pb';
import type {
  Guest,
  GuestCreateRequest,
  GuestListSegment,
  GuestProfile,
  GuestTourismConversionResponse,
  GuestType,
  GuestUpdateRequest,
  TourismType,
} from '../../types';

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

function ekycFromPb(e: PbEkycSummary) {
  return {
    guest_id: nameId(e.guest),
    ekyc_verification_id:
      e.ekycVerificationId !== undefined ? Number(e.ekycVerificationId) : null,
    status: e.status,
    self_checkin_enabled: e.selfCheckinEnabled,
    verified_at: tsToIso(e.verifiedAt) ?? null,
    can_auto_checkin: e.canAutoCheckin,
    auto_checkin_block_reason: e.autoCheckinBlockReason ?? null,
    auto_checkin_block_code: e.autoCheckinBlockCode ?? null,
  };
}

export function guestFromPb(g: PbGuest): Guest {
  return {
    id: nameId(g.name),
    nick_name: g.nickName,
    first_name: g.firstName ?? null,
    last_name: g.lastName ?? null,
    ...(g.email !== undefined ? { email: g.email } : {}),
    ...(g.phone !== undefined ? { phone: g.phone } : {}),
    ...(g.icNumber !== undefined ? { ic_number: g.icNumber } : {}),
    ...(g.nationality !== undefined ? { nationality: g.nationality } : {}),
    ...(g.addressLine1 !== undefined ? { address_line1: g.addressLine1 } : {}),
    ...(g.city !== undefined ? { city: g.city } : {}),
    ...(g.stateProvince !== undefined ? { state_province: g.stateProvince } : {}),
    ...(g.postalCode !== undefined ? { postal_code: g.postalCode } : {}),
    ...(g.country !== undefined ? { country: g.country } : {}),
    ...(g.title !== undefined ? { title: g.title } : {}),
    ...(g.altPhone !== undefined ? { alt_phone: g.altPhone } : {}),
    is_active: g.isActive,
    guest_type: enumToRest(PbGuestType, g.guestType) as Guest['guest_type'],
    tourism_type: enumToRest(PbTourismType, g.tourismType) as Guest['tourism_type'],
    discount_percentage: g.discountPercentage,
    ...(g.companyName !== undefined ? { company_name: g.companyName } : {}),
    complimentary_nights_credit: g.complimentaryNightsCredit,
    created_at: tsToIso(g.createdAt) ?? '',
    updated_at: tsToIso(g.updatedAt) ?? '',
    ...(g.vipStatus !== undefined ? { vip_status: g.vipStatus } : {}),
    ...(g.tags.length ? { tags: [...g.tags] } : {}),
    ...(g.jobTitle !== undefined ? { job_title: g.jobTitle } : {}),
    ...(g.notes !== undefined ? { notes: g.notes } : {}),
    ...(g.specialRequests !== undefined ? { special_requests: g.specialRequests } : {}),
    ...(g.marketingOptIn !== undefined ? { marketing_opt_in: g.marketingOptIn } : {}),
    ...(g.communicationPreference !== undefined
      ? { communication_preference: g.communicationPreference }
      : {}),
    ...(g.languagePreference !== undefined
      ? { language_preference: g.languagePreference }
      : {}),
    ...(g.isBlacklisted !== undefined ? { is_blacklisted: g.isBlacklisted } : {}),
    ...(g.blacklistReason !== undefined ? { blacklist_reason: g.blacklistReason } : {}),
    ...(g.accountUsername !== undefined ? { account_username: g.accountUsername } : {}),
    ...(g.accountIsActive !== undefined ? { account_is_active: g.accountIsActive } : {}),
    ...(g.bookingsCount !== undefined ? { bookings_count: Number(g.bookingsCount) } : {}),
    ...(gdateToString(g.lastStayDate) !== undefined
      ? { last_stay_date: gdateToString(g.lastStayDate) }
      : {}),
    ...(g.hasOpenSupport !== undefined ? { has_open_support: g.hasOpenSupport } : {}),
    ...(g.ekycSummary ? { ekyc_summary: ekycFromPb(g.ekycSummary) } : {}),
  } as Guest;
}

function summaryFromPb(s: PbGuestSummary): GuestProfile['summary'] {
  return {
    completed_stays: Number(s.completedStays),
    total_nights: Number(s.totalNights),
    total_room_revenue: moneyToMajor(s.totalRoomRevenue) ?? 0,
    last_stay_at: gdateToString(s.lastStayAt) ?? null,
    next_stay_at: gdateToString(s.nextStayAt) ?? null,
    outstanding_balance: moneyToMajor(s.outstandingBalance) ?? 0,
    total_bookings: Number(s.totalBookings),
    active_booking_id: s.activeBooking ? nameId(s.activeBooking) : null,
    active_booking_number: s.activeBookingNumber ?? null,
  };
}

function profileBookingFromPb(b: PbProfileBooking): GuestProfile['reservations'][number] {
  return {
    id: nameId(b.name),
    booking_number: b.bookingNumber ?? null,
    check_in_date: gdateToString(b.checkInDate) ?? '',
    check_out_date: gdateToString(b.checkOutDate) ?? '',
    nights: Number(b.nights),
    status: b.status,
    payment_status: b.paymentStatus ?? null,
    total_amount: moneyToMajor(b.totalAmount) ?? 0,
    total_paid: moneyToMajor(b.totalPaid) ?? 0,
    balance_due: moneyToMajor(b.balanceDue) ?? 0,
    created_at: tsToIso(b.createdAt) ?? '',
    room_number: b.roomNumber,
    room_type: b.roomType,
    special_requests: b.specialRequests ?? null,
    source: b.source ?? null,
  };
}

function profileFromPb(p: PbGuestProfile): GuestProfile {
  return {
    guest: guestFromPb(p.guest!),
    summary: summaryFromPb(p.summary!),
    ...(p.ekycSummary ? { ekyc_summary: ekycFromPb(p.ekycSummary) } : {}),
    reservations: (p.reservations ?? []).map(profileBookingFromPb),
    duplicate_candidates: (p.duplicateCandidates ?? []).map(d => ({
      guest: guestFromPb(d.guest!),
      score: d.score,
      match_reasons: [...d.matchReasons],
      blocking_reasons: [...d.blockingReasons],
      recommended_action: d.recommendedAction,
    })),
    ...(p.sensitive
      ? {
          sensitive: {
            date_of_birth: gdateToString(p.sensitive.dateOfBirth) ?? null,
            id_type: p.sensitive.idType ?? null,
            id_number: p.sensitive.idNumber ?? null,
            id_expiry: gdateToString(p.sensitive.idExpiry) ?? null,
            id_country: p.sensitive.idCountry ?? null,
          },
        }
      : {}),
  } as GuestProfile;
}

/** REST emits `id`/`total_amount` as strings in this json!-built shape. */
function bookingFromPb(b: PbGuestBooking): Record<string, unknown> {
  return {
    id: nameIdString(b.name),
    booking_number: b.bookingNumber ?? null,
    check_in_date: gdateToString(b.checkInDate) ?? '',
    check_out_date: gdateToString(b.checkOutDate) ?? '',
    nights: Number(b.nights),
    status: b.status,
    total_amount: moneyToMajor(b.totalAmount) ?? 0,
    created_at: tsToIso(b.createdAt) ?? '',
    room_number: b.roomNumber,
    room_type: b.roomType,
  };
}

/** Slim row used by my-guests-with-credits — REST emits no id/guest/timestamps. */
function slimCreditRowFromPb(c: PbRoomTypeCredit) {
  return {
    room_type_id: nameId(c.roomType),
    room_type_name: c.roomTypeName,
    room_type_code: c.roomTypeCode,
    nights_available: c.nightsAvailable,
  };
}

/** Full row used by get-guest-credits — REST emits id/guest/timestamps. */
function fullCreditRowFromPb(c: PbRoomTypeCredit) {
  return {
    id: Number(c.id),
    guest_id: nameId(c.guest),
    room_type_id: nameId(c.roomType),
    room_type_name: c.roomTypeName,
    room_type_code: c.roomTypeCode,
    nights_available: c.nightsAvailable,
    created_at: tsToIso(c.createdAt) ?? '',
    updated_at: tsToIso(c.updatedAt) ?? '',
  };
}

// ---------------------------------------------------------------------------
// REST → pb input
// ---------------------------------------------------------------------------

function guestToPb(input: Partial<GuestUpdateRequest>, id?: number | string): PbGuest {
  return {
    $typeName: 'hotel.guests.v1.Guest',
    name: id !== undefined ? guestName(id) : '',
    nickName: '',
    firstName: input.first_name,
    lastName: input.last_name,
    email: input.email,
    phone: input.phone,
    icNumber: input.ic_number,
    nationality: input.nationality,
    addressLine1: input.address_line1,
    city: input.city,
    stateProvince: input.state_province,
    postalCode: input.postal_code,
    country: input.country,
    title: input.title,
    altPhone: input.alt_phone,
    isActive: input.is_active ?? false,
    guestType: restToEnum(PbGuestType, input.guest_type) ?? PbGuestType.UNSPECIFIED,
    tourismType: restToEnum(PbTourismType, input.tourism_type),
    discountPercentage: input.discount_percentage,
    companyName: input.company_name,
    complimentaryNightsCredit: 0,
    createdAt: undefined,
    updatedAt: undefined,
    vipStatus: input.vip_status,
    tags: input.tags ?? [],
    jobTitle: input.job_title,
    notes: input.notes,
    specialRequests: input.special_requests,
    marketingOptIn: input.marketing_opt_in,
    communicationPreference: input.communication_preference,
    languagePreference: input.language_preference,
    isBlacklisted: input.is_blacklisted,
    blacklistReason: input.blacklist_reason,
    accountUsername: undefined,
    accountIsActive: undefined,
    bookingsCount: undefined,
    lastStayDate: undefined,
    hasOpenSupport: undefined,
    ekycSummary: undefined,
    dateOfBirth: stringToGdate(input.date_of_birth),
    idType: input.id_type,
    idNumber: input.id_number,
    idExpiry: stringToGdate(input.id_expiry),
    idCountry: input.id_country,
  };
}

/** Field-mask paths the backend adapter maps — mirrors the REST PATCH body
 *  (serde drops unknown keys, so they must not reach the mask). */
const UPDATE_FIELDS = new Set([
  'first_name',
  'last_name',
  'email',
  'phone',
  'title',
  'alt_phone',
  'ic_number',
  'nationality',
  'address_line1',
  'city',
  'state_province',
  'postal_code',
  'country',
  'is_active',
  'guest_type',
  'tourism_type',
  'discount_percentage',
  'company_name',
  'vip_status',
  'tags',
  'job_title',
  'notes',
  'special_requests',
  'marketing_opt_in',
  'communication_preference',
  'language_preference',
  'is_blacklisted',
  'blacklist_reason',
  'date_of_birth',
  'id_type',
  'id_number',
  'id_expiry',
  'id_country',
]);

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

interface GuestsPageParams {
  page?: number;
  page_size?: number;
  search?: string;
  guest_type?: GuestType;
  tourism_type?: TourismType;
  missing_tourism?: boolean;
  missing_info?: boolean;
  vip?: boolean;
  blacklisted?: boolean;
  has_open_support?: boolean;
  segment?: GuestListSegment;
}

export async function getGuestsPage(
  params: GuestsPageParams = {},
): Promise<{ data: Guest[]; total: number; page: number; page_size: number }> {
  try {
    const res = await guestClient().listGuests({
      page: BigInt(params.page ?? 0),
      pageSize: BigInt(params.page_size ?? 0),
      search: params.search ?? '',
      guestType: restToEnum(PbGuestType, params.guest_type) ?? PbGuestType.UNSPECIFIED,
      tourismType: restToEnum(PbTourismType, params.tourism_type) ?? PbTourismType.UNSPECIFIED,
      missingTourism: params.missing_tourism,
      missingInfo: params.missing_info,
      vip: params.vip,
      blacklisted: params.blacklisted,
      hasOpenSupport: params.has_open_support,
      segment: restToEnum(PbGuestSegment, params.segment) ?? PbGuestSegment.UNSPECIFIED,
    });
    const data = res.guests.map(guestFromPb);
    return {
      data,
      total: Number(res.total),
      page: Number(res.page),
      page_size: Number(res.pageSize),
    };
  } catch (error) {
    throw toGrpcError(error, 'Failed to load guests');
  }
}

/**
 * Same contract as the REST version: every page fetched, page failures
 * tolerated (logged + skipped), a 401 in any page aborts the whole list.
 */
export async function getAllGuests(params?: { search?: string }): Promise<Guest[]> {
  const pageSize = 500;
  const firstPage = await getGuestsPage({ page: 1, page_size: pageSize, search: params?.search });
  const total = firstPage.total || firstPage.data.length;
  if (total <= pageSize) return firstPage.data;

  const totalPages = Math.ceil(total / pageSize);
  const guests: Guest[] = [...firstPage.data];
  let failedPages = 0;
  let authError: unknown = null;
  const CONCURRENCY = 2;
  for (let offset = 2; offset <= totalPages; offset += CONCURRENCY) {
    const chunk = Array.from(
      { length: Math.min(CONCURRENCY, totalPages - offset + 1) },
      (_, i) => offset + i,
    );
    const settled = await Promise.allSettled(
      chunk.map(page => getGuestsPage({ page, page_size: pageSize, search: params?.search })),
    );
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        guests.push(...result.value.data);
      } else {
        failedPages++;
        if (result.reason instanceof APIError && result.reason.statusCode === 401) {
          authError = result.reason;
        }
        console.warn(`getAllGuests: failed to load page ${offset + i} of ${totalPages}`, result.reason);
      }
    });
  }
  if (authError) throw authError;
  if (failedPages > 0) {
    console.warn(`getAllGuests: returning ${guests.length} of ~${total} guests; ${failedPages} page(s) failed to load`);
  }
  return guests;
}

export async function getGuest(guestId: number | string): Promise<Guest> {
  try {
    const res = await guestClient().getGuest({ name: guestName(guestId) });
    return guestFromPb(res.guest!);
  } catch (error) {
    throw toGrpcError(error, 'Failed to load guest');
  }
}

export async function getGuestProfile(guestId: number | string): Promise<GuestProfile> {
  try {
    const res = await guestClient().getGuestProfile({ name: guestName(guestId) });
    return profileFromPb(res.profile!);
  } catch (error) {
    throw toGrpcError(error, 'Failed to load guest profile');
  }
}

export async function createGuest(input: GuestCreateRequest): Promise<Guest> {
  try {
    const res = await guestClient().createGuest({
      guest: guestToPb(input),
      requestId: '',
    });
    return guestFromPb(res.guest!);
  } catch (error) {
    throw toGrpcError(error, 'Failed to create guest');
  }
}

export async function updateGuest(
  guestId: number,
  input: Partial<GuestUpdateRequest>,
): Promise<Guest> {
  try {
    const paths = Object.keys(input).filter(k => UPDATE_FIELDS.has(k));
    const res = await guestClient().updateGuest({
      guest: guestToPb(input, guestId),
      updateMask: { paths },
      requestId: '',
    });
    return guestFromPb(res.guest!);
  } catch (error) {
    throw toGrpcError(error, 'Failed to update guest');
  }
}

export async function applyTourismTypeFromLastCheckIn(
  guestId: number,
): Promise<GuestTourismConversionResponse> {
  try {
    const res = await guestClient().applyTourismTypeFromLastCheckIn({
      name: guestName(guestId),
      requestId: '',
    });
    const c = res.conversion as PbTourismConversion;
    return {
      guest: guestFromPb(c.guest!),
      source: {
        booking_id: nameId(c.booking),
        booking_number: c.bookingNumber ?? null,
        check_in_date: gdateToString(c.checkInDate) ?? '',
        check_out_date: gdateToString(c.checkOutDate) ?? '',
        tourism_tax_amount: moneyToMajor(c.tourismTaxAmount) ?? 0,
        net_paid_amount: moneyToMajor(c.netPaidAmount) ?? 0,
        paid_tourism_tax: c.paidTourismTax,
        inferred_tourism_type: enumToRest(PbTourismType, c.inferredTourismType) as TourismType,
      },
    };
  } catch (error) {
    throw toGrpcError(error, 'Failed to apply tourism type');
  }
}

export async function transferPortalAccount(guestId: number, username: string): Promise<void> {
  try {
    await guestClient().transferGuestPortalAccount({
      name: guestName(guestId),
      username,
      requestId: '',
    });
  } catch (error) {
    throw toGrpcError(error, 'Failed to transfer guest portal account');
  }
}

export async function deleteGuest(guestId: number): Promise<{ success: boolean; message: string }> {
  try {
    await guestClient().deleteGuest({ name: guestName(guestId), requestId: '' });
    // Same literal the REST handler emits on success.
    return { success: true, message: 'Guest deleted successfully' };
  } catch (error) {
    throw toGrpcError(error, 'Failed to delete guest');
  }
}

export async function getGuestBookings(guestId: number): Promise<Record<string, unknown>[]> {
  try {
    const res = await guestClient().listGuestBookings({ name: guestName(guestId) });
    return res.bookings.map(bookingFromPb);
  } catch (error) {
    throw toGrpcError(error, 'Failed to load guest bookings');
  }
}

export async function getMyGuests(): Promise<Guest[]> {
  try {
    const res = await guestClient().listMyGuests({});
    return res.guests.map(guestFromPb);
  } catch (error) {
    throw toGrpcError(error, 'Failed to load linked guests');
  }
}

export async function getMyGuestsWithCredits(): Promise<
  {
    id: number;
    nick_name: string;
    email: string;
    total_complimentary_credits: number;
    credits_by_room_type: {
      room_type_id: number;
      room_type_name: string;
      room_type_code: string;
      nights_available: number;
    }[];
  }[]
> {
  try {
    const res = await guestClient().listMyGuestsWithCredits({});
    return res.summaries.map((s: PbGuestCreditSummary) => ({
      id: nameId(s.guest),
      nick_name: s.nickName,
      email: s.email ?? '',
      total_complimentary_credits: s.totalComplimentaryCredits,
      credits_by_room_type: s.creditsByRoomType.map(slimCreditRowFromPb),
    }));
  } catch (error) {
    throw toGrpcError(error, 'Failed to load guest credits');
  }
}

export async function getGuestCredits(guestId: number): Promise<{
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
    const res = await guestClient().getGuestCredits({ name: guestName(guestId) });
    const c = res.credits as PbGuestCredits;
    return {
      guest_id: nameId(c.guest),
      guest_name: c.guestName,
      total_nights: c.totalNights,
      credits_by_room_type: c.creditsByRoomType.map(fullCreditRowFromPb),
    };
  } catch (error) {
    throw toGrpcError(error, 'Failed to load guest credits');
  }
}
