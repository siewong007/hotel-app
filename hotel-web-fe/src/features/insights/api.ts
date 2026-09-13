import { api } from '../../api/client';
import type {
  InsightsOverview,
  ReportCatalogEntry,
  ReportEnvelope,
  ReportQueryParams,
} from './types';

export const InsightsApi = {
  getOverview(): Promise<InsightsOverview> {
    return api.get('insights/overview').json<InsightsOverview>();
  },

  listReports(): Promise<ReportCatalogEntry[]> {
    return api.get('insights/reports').json<ReportCatalogEntry[]>();
  },

  runReport(reportId: string, params: ReportQueryParams): Promise<ReportEnvelope> {
    const searchParams = new URLSearchParams({
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
    return api.get(`insights/reports/${reportId}`, { searchParams }).json<ReportEnvelope>();
  },
};
