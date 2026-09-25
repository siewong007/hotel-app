import { api, APIError, toApiError } from './client';
import { t } from '../i18n';
import {
  Booking,
  BookingCreateRequest,
  BookingUpdateRequest,
  BookingCancellationRequest,
  BookingVoidResponse,
  BookingReleaseResponse,
  BookingTimelineEntry,
  BookingWithDetails,
  BookingBoardSummary,
  BookingBoardView,
  CheckInRequest,
  CheckInAdvisory,
} from '../types';
import { withRetry, batchWithRetry } from '../utils/retry';
import { validateBookingRequest, enhanceBookingDetails } from '../utils/bookingUtils';
import { addLocalDays, formatLocalDate, toHotelDateString } from '../utils/date';
import { IN_HOUSE_BOOKING_STATUSES, ROOM_HOLDING_RESERVATION_STATUSES } from '../constants/booking.constants';

// The backend pool is five connections. Two page fetches in flight keeps a
// single screen refresh from occupying it, and the per-status fan-out below is
// bounded for the same reason.
const PAGE_FETCH_CONCURRENCY = 2;
const STATUS_FETCH_CONCURRENCY = 2;

export interface BookingRevenuePoint {
  date: string;
  revenue: number;
}

export interface BookingStatsResponse {
  total: number;
  checked_in: number;
  confirmed: number;
  today_check_ins: number;
  today_check_outs: number;
  pending: number;
  active: number;
  total_revenue: number;
  revenue_last_7_days: BookingRevenuePoint[];
}

const emptyBookingStats: BookingStatsResponse = {
  total: 0,
  checked_in: 0,
  confirmed: 0,
  today_check_ins: 0,
  today_check_outs: 0,
  pending: 0,
  active: 0,
  total_revenue: 0,
  revenue_last_7_days: [],
};

export interface BookingListFilters {
  room_number?: string;
  company_billed?: boolean;
  status?: string;
  /** Start of the stay window. With check_in_to, the backend matches stay OVERLAP, not check-in date. */
  check_in_from?: string;
  /** End of the stay window. Must be sent together with check_in_from to get overlap semantics. */
  check_in_to?: string;
}

// How far ahead a "current and upcoming" window reaches. The backend's
// two-sided date filter is an overlap test, so the upper bound only has to
// clear the furthest reservation anyone will make: measured against production
// on 2026-09-15 the furthest check-in was 145 days out and nothing sat beyond a
// year. Two years leaves a wide margin while still excluding the years of
// checked-out history that dominate the table.
const UPCOMING_WINDOW_DAYS = 730;

/**
 * The stay window a live operational screen actually needs.
 *
 * The lower bound is yesterday, not today, and that is load-bearing: the
 * backend's overlap predicate is `check_out > from`, so a guest checking out
 * today (check_out = today) only matches when `from` is the day before. Passing
 * today would silently drop every same-day departure from the room grid and the
 * dashboard's check-out list.
 */
export const currentStayWindow = (): { check_in_from: string; check_in_to: string } => {
  const today = toHotelDateString(new Date());
  return {
    check_in_from: formatLocalDate(addLocalDays(today, -1)),
    check_in_to: formatLocalDate(addLocalDays(today, UPCOMING_WINDOW_DAYS)),
  };
};

export class BookingsService {
  static async getAllBookings(filters?: BookingListFilters): Promise<BookingWithDetails[]> {
    try {
      const pageSize = 500;
      const baseParams: Record<string, any> = { page: 1, page_size: pageSize };
      if (filters?.room_number) baseParams.room_number = filters.room_number;
      if (filters?.company_billed) baseParams.company_billed = true;
      if (filters?.status) baseParams.status = filters.status;
      if (filters?.check_in_from) baseParams.check_in_from = filters.check_in_from;
      if (filters?.check_in_to) baseParams.check_in_to = filters.check_in_to;

      const firstPage = await withRetry(
        () => api.get('bookings', { searchParams: baseParams }).json<any>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
      const firstData: BookingWithDetails[] = Array.isArray(firstPage) ? firstPage : (firstPage.data || []);
      const total = firstPage.total || firstData.length;

      if (total <= pageSize) return firstData;

      // Remaining pages go through batchWithRetry rather than Promise.all: the
      // backend pool is five connections, and firing every page at once let a
      // single screen refresh occupy all of them. Bounded concurrency keeps the
      // wall-clock benefit of parallelism without starving other requests.
      const totalPages = Math.ceil(total / pageSize);
      const remainingPages = await batchWithRetry(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          () => api.get('bookings', { searchParams: { ...baseParams, page: i + 2 } }).json<any>()
        ),
        { maxAttempts: 3, initialDelay: 1000, concurrency: PAGE_FETCH_CONCURRENCY }
      );

      return remainingPages.reduce(
        (acc, res) => acc.concat(Array.isArray(res) ? res : (res.data || [])),
        firstData
      );
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * Bookings whose stay overlaps today or lies ahead of it.
   *
   * Operational screens derive everything they show — current occupancy,
   * today's arrivals and departures, the next reservation per room — from
   * bookings that touch today or the future. They were nonetheless fetching the
   * entire table: 2,584 non-voided rows on production, over six sequential
   * 500-row pages, every dashboard load and every 30-second room-grid refresh.
   * Windowing that server-side returns 51 rows in a single page while leaving
   * all six derived quantities identical (verified against production).
   */
  static async getCurrentAndUpcomingBookings(
    filters?: Omit<BookingListFilters, 'check_in_from' | 'check_in_to'>
  ): Promise<BookingWithDetails[]> {
    return this.getAllBookings({ ...filters, ...currentStayWindow() });
  }

  // Only the statuses a live room grid can act on, and only bookings that touch
  // today or later — the grid cannot act on a stay that ended last year.
  // Includes every room-holding reservation status, not just confirmed/pending:
  // an unpaid website booking (`pending_payment`) or a bank transfer awaiting
  // confirmation (`pending_confirmation`) holds its room, and leaving them out
  // made a held room read as free on the grid.
  static async getActiveBookings(): Promise<BookingWithDetails[]> {
    const statuses: string[] = [...IN_HOUSE_BOOKING_STATUSES, ...ROOM_HOLDING_RESERVATION_STATUSES];
    const window = currentStayWindow();
    const results = await batchWithRetry(
      statuses.map((status) => () => this.getAllBookings({ status, ...window })),
      { maxAttempts: 1, concurrency: STATUS_FETCH_CONCURRENCY }
    );
    return results.flat();
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
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async updateBooking(bookingId: string, updateData: BookingUpdateRequest): Promise<Booking> {
    try {
      return await api
        .patch(`bookings/${bookingId}`, { json: updateData })
        .json<Booking>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async checkInGuest(bookingId: string, checkinData?: CheckInRequest): Promise<Booking> {
    try {
      return await api
        .post(`bookings/${bookingId}/checkin`, { json: checkinData || {} })
        .json<Booking>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * Pre-check-in advisory: flags when a guest who normally bills to a company
   * ledger is about to be checked in as a normal (non-company) guest, so the
   * front desk can attach company billing before completing check-in.
   */
  static async getCheckInAdvisory(bookingId: string): Promise<CheckInAdvisory> {
    try {
      return await api
        .get(`bookings/${bookingId}/checkin-advisory`)
        .json<CheckInAdvisory>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * Guest-level check-in advisory, for the walk-in / direct-booking flow where
   * no booking exists yet. Keyed purely on the guest's company-billing history.
   */
  static async getGuestCheckInAdvisory(guestId: number | string): Promise<CheckInAdvisory> {
    try {
      return await api
        .get('bookings/checkin-advisory', { searchParams: { guest_id: String(guestId) } })
        .json<CheckInAdvisory>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async voidBooking(cancellationData: BookingCancellationRequest): Promise<BookingVoidResponse> {
    try {
      return await api
        .post('bookings/void', { json: cancellationData })
        .json<BookingVoidResponse>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * Release the room held by a booking that was never paid for.
   *
   * Narrower than `voidBooking`: the backend accepts only a `pending_payment`
   * booking with no payments recorded, and the reason is mandatory — releasing
   * frees inventory somebody else was refused, so the audit trail must say why.
   */
  static async releaseBooking(
    bookingId: string | number,
    reason: string,
  ): Promise<BookingReleaseResponse> {
    try {
      return await api
        .post(`bookings/${bookingId}/release`, { json: { reason } })
        .json<BookingReleaseResponse>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getBookingById(bookingId: string): Promise<BookingWithDetails> {
    try {
      // GET /bookings/{id} already returns the joined detail row
      // (row_to_booking_with_details) — the previous `Booking` annotation was
      // under-typed. enhanceBookingDetails adds the same computed fields the
      // list endpoints get via getBookingsPage/getBookingsWithDetails.
      const booking = await api.get(`bookings/${bookingId}`).json<BookingWithDetails>();
      return enhanceBookingDetails(booking);
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getBookingTimeline(bookingId: string | number): Promise<BookingTimelineEntry[]> {
    try {
      return await api.get(`bookings/${bookingId}/timeline`).json<BookingTimelineEntry[]>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getBookingsPage(params: {
    page?: number;
    page_size?: number;
    search?: string;
    status?: string;
    room_number?: string;
    payment_method?: string;
    online_channel?: string;
    date_search?: string;
    check_in_from?: string;
    check_in_to?: string;
    month_search?: string;
    /** Bookings board view; applies the same predicate as the matching summary count. */
    view?: BookingBoardView;
    sort_by?: string;
    sort_order?: string;
  } = {}): Promise<{ data: BookingWithDetails[]; total: number; page: number; page_size: number }> {
    try {
      const searchParams: Record<string, any> = {
        page: params.page ?? 1,
        page_size: params.page_size ?? 50,
      };
      if (params.search) searchParams.search = params.search;
      if (params.status && params.status !== 'all') searchParams.status = params.status;
      if (params.room_number) searchParams.room_number = params.room_number;
      if (params.payment_method) searchParams.payment_method = params.payment_method;
      if (params.online_channel) searchParams.online_channel = params.online_channel;
      if (params.date_search) searchParams.date_search = params.date_search;
      if (params.check_in_from) searchParams.check_in_from = params.check_in_from;
      if (params.check_in_to) searchParams.check_in_to = params.check_in_to;
      if (params.month_search) searchParams.month_search = params.month_search;
      // 'all' means no view filter; the backend treats it the same way, but not
      // sending it keeps the query key and the request URL clean.
      if (params.view && params.view !== 'all') searchParams.view = params.view;
      if (params.sort_by) searchParams.sort_by = params.sort_by;
      if (params.sort_order) searchParams.sort_order = params.sort_order;

      type BookingsPageResponse = { data?: BookingWithDetails[]; total?: number; page?: number; page_size?: number };
      const resp = await withRetry(
        () => api.get('bookings', { searchParams }).json<BookingsPageResponse | BookingWithDetails[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
      const raw = Array.isArray(resp) ? resp : (resp.data || []);
      const meta = Array.isArray(resp) ? {} : resp;
      return {
        data: raw.map((b) => enhanceBookingDetails(b)),
        total: meta.total ?? raw.length,
        page: meta.page ?? 1,
        page_size: meta.page_size ?? 50,
      };
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * The bookings board's nine operational figures.
   *
   * Replaces a client-side reduction over `getAllBookings()` with no filter,
   * which paged the entire non-voided table (5 requests / ~3.1 MB measured on
   * 2,756 bookings) to produce these same numbers. No retry wrapper: the board
   * renders without the summary, and a stale count is worse than a missing one.
   */
  static async getBookingBoardSummary(): Promise<BookingBoardSummary> {
    try {
      return await api.get('bookings/summary').json<BookingBoardSummary>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getBookingStats(): Promise<BookingStatsResponse> {
    try {
      return await withRetry(
        () => api.get('bookings/stats').json<BookingStatsResponse>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      return emptyBookingStats;
    }
  }

  static async getBookingsWithDetails(filters?: { room_number?: string; company_billed?: boolean }): Promise<BookingWithDetails[]> {
    try {
      const bookings = await this.getAllBookings(filters);
      return bookings.map(booking => enhanceBookingDetails(booking));
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
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
      throw toApiError(error, t('generic', undefined, 'errors'));
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
      throw toApiError(error, t('generic', undefined, 'errors'));
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
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  // New complimentary management methods

  static async getComplimentaryBookings(): Promise<BookingWithDetails[]> {
    try {
      return await withRetry(
        () => api.get('bookings/complimentary').json<BookingWithDetails[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getComplimentarySummary(): Promise<{
    total_complimentary_bookings: number;
    total_complimentary_nights: number;
    total_credits_available: number;
    value_of_complimentary_nights: string;
  }> {
    try {
      return await api.get('complimentary/summary').json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async updateComplimentary(
    bookingId: string,
    data: {
      complimentary_start_date?: string;
      complimentary_end_date?: string;
      complimentary_reason?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    booking_id: number;
    complimentary_nights?: number;
    new_total?: string;
  }> {
    try {
      return await api
        .patch(`bookings/${bookingId}/complimentary`, { json: data })
        .json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async removeComplimentary(bookingId: string): Promise<{
    success: boolean;
    message: string;
    booking_id: number;
    restored_total?: string;
  }> {
    try {
      return await api.delete(`bookings/${bookingId}/complimentary`).json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getGuestsWithCredits(): Promise<{
    credits: Array<{
      guest_id: number;
      guest_name: string;
      email: string | null;
      room_type_id: number;
      room_type_name: string;
      room_type_code: string | null;
      nights_available: number;
      notes: string | null;
    }>;
  }> {
    try {
      return await api.get('guests/credits').json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async addGuestCredits(data: {
    guest_id: number;
    room_type_id: number;
    nights: number;
    reason: string;
  }): Promise<{
    success: boolean;
    message: string;
    credit: {
      guest_id: number;
      guest_name: string;
      room_type_id: number;
      room_type_name: string;
      nights_available: number;
      reason: string;
      notes: string | null;
    };
  }> {
    try {
      return await api.post('guests/credits', { json: data }).json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async updateGuestCredits(
    guestId: number,
    roomTypeId: number,
    data: {
      nights_available?: number;
      notes?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    credit: {
      guest_id: number;
      guest_name: string;
      room_type_id: number;
      room_type_name: string;
      nights_available: number;
      notes: string | null;
    };
  }> {
    try {
      return await api.patch(`guests/${guestId}/credits/${roomTypeId}`, { json: data }).json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async deleteGuestCredits(
    guestId: number,
    roomTypeId: number
  ): Promise<{
    success: boolean;
    message: string;
    deleted: {
      guest_id: number;
      guest_name: string;
      room_type_id: number;
      room_type_name: string;
      nights_deleted: number;
    };
  }> {
    try {
      return await api.delete(`guests/${guestId}/credits/${roomTypeId}`).json();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async reactivateBooking(bookingId: string): Promise<Booking> {
    try {
      return await api
        .post(`bookings/${bookingId}/reactivate`)
        .json<Booking>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }
}
