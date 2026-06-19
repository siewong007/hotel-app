import { api } from './client';
import { withRetry } from '../utils/retry';

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
    return await api.get('booking-channels').json<BookingChannel[]>();
  }

  static async createBookingChannel(input: BookingChannelInput): Promise<BookingChannel> {
    return await api.post('booking-channels', { json: input }).json<BookingChannel>();
  }

  static async updateBookingChannel(id: number, input: BookingChannelUpdate): Promise<BookingChannel> {
    return await api.put(`booking-channels/${id}`, { json: input }).json<BookingChannel>();
  }

  static async downloadReportPDF(params: {
    reportType: string;
    startDate: string;
    endDate: string;
    shift?: string;
    drawer?: string;
    companyName?: string;
  }): Promise<Blob> {
    const searchParams = new URLSearchParams({
      report_type: params.reportType,
      start_date: params.startDate,
      end_date: params.endDate,
    });

    if (params.shift) searchParams.append('shift', params.shift);
    if (params.drawer) searchParams.append('drawer', params.drawer);
    if (params.companyName) searchParams.append('company_name', params.companyName);

    return await api.get('reports/pdf', { searchParams }).blob();
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
}

export interface BookingChannelUpdate {
  name?: string;
  channel_type?: string;
  default_commission_type?: string;
  default_commission_value?: number;
  default_commission_scope?: string;
  is_active?: boolean;
}
