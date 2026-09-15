import { api } from './client';
import { withRetry } from '../utils/retry';
import { syncBookingChannelsSetting } from '../utils/hotelSettings';

export class ReportsService {
  static async generateReport(params: {
    reportType: string;
    startDate: string;
    endDate: string;
    shift?: string;
    drawer?: string;
    companyName?: string;
    bookingChannelId?: number | string;
    bookingChannel?: string;
    platformName?: string;
    bookingStatus?: string;
    postedStatus?: string;
    roomType?: string;
  }): Promise<any> {
    const searchParams = new URLSearchParams({
      report_type: params.reportType,
      start_date: params.startDate,
      end_date: params.endDate,
    });

    if (params.shift) searchParams.append('shift', params.shift);
    if (params.drawer) searchParams.append('drawer', params.drawer);
    if (params.companyName) searchParams.append('company_name', params.companyName);
    if (params.bookingChannelId) searchParams.append('booking_channel_id', String(params.bookingChannelId));
    if (params.bookingChannel) searchParams.append('booking_channel', params.bookingChannel);
    if (params.platformName) searchParams.append('platform_name', params.platformName);
    if (params.bookingStatus) searchParams.append('booking_status', params.bookingStatus);
    if (params.postedStatus) searchParams.append('posted_status', params.postedStatus);
    if (params.roomType) searchParams.append('room_type', params.roomType);

    return await withRetry(
      () => api.get('reports/generate', { searchParams }).json(),
      { maxAttempts: 3, initialDelay: 1500 }
    );
  }

  static async listBookingChannels(): Promise<BookingChannel[]> {
    const channels = await api.get('booking-channels').json<BookingChannel[]>();
    // The table is the source of truth — keep the local display mirror (used
    // by channel chips in bookings/night-audit views) in step with it.
    syncBookingChannelsSetting(channels);
    return channels;
  }

  static async createBookingChannel(input: BookingChannelInput): Promise<BookingChannel> {
    return await api.post('booking-channels', { json: input }).json<BookingChannel>();
  }

  static async updateBookingChannel(id: number, input: BookingChannelUpdate): Promise<BookingChannel> {
    return await api.put(`booking-channels/${id}`, { json: input }).json<BookingChannel>();
  }

}

export interface BookingChannel {
  id: number;
  name: string;
  channel_type: string;
  default_commission_type: 'none' | 'percentage' | 'fixed_amount';
  default_commission_value: number | string;
  default_commission_scope: 'per_booking' | 'per_night';
  is_active: boolean;
  abbreviation?: string | null;
  code?: string | null;
  integration_mode?: string;
  created_at: string;
  updated_at: string;
}

export interface BookingChannelInput {
  name: string;
  channel_type?: string;
  default_commission_type?: string;
  default_commission_value?: number;
  default_commission_scope?: string;
  is_active?: boolean;
  abbreviation?: string | null;
  code?: string | null;
  integration_mode?: string;
}

export interface BookingChannelUpdate {
  name?: string;
  channel_type?: string;
  default_commission_type?: string;
  default_commission_value?: number;
  default_commission_scope?: string;
  is_active?: boolean;
  abbreviation?: string | null;
  code?: string | null;
  integration_mode?: string;
}
