export type KpiFormat = 'number' | 'currency' | 'percent' | 'text';

export interface RoomBuckets {
  total: number;
  occupied: number;
  reserved: number;
  available: number;
  cleaning: number;
  maintenance: number;
}

export interface BookingKpis {
  total: number;
  checked_in: number;
  confirmed: number;
  pending: number;
  active: number;
  today_check_ins: number;
  today_check_outs: number;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
}

export interface RoomTypeLoad {
  name: string;
  total: number;
  occupied: number;
  available: number;
}

export interface InsightsOverview {
  business_date: string;
  rooms: RoomBuckets;
  occupancy_rate: number;
  bookings: BookingKpis;
  revenue_today: number;
  revenue_last_7_days: RevenuePoint[];
  guests_total: number;
  room_types: RoomTypeLoad[];
}

export type ReportDateBasis = 'stay' | 'booking' | 'accounting';

export interface ReportCatalogEntry {
  id: string;
  title: string;
  category: 'operations' | 'financial' | 'analytics' | 'accounting' | string;
  description: string;
  date_basis: ReportDateBasis;
  params: string[];
}

export interface ReportMeta {
  report_id: string;
  title: string;
  generated_at: string;
  date_basis: ReportDateBasis;
  range_start: string | null;
  range_end: string | null;
  filters: Record<string, unknown>;
}

export interface ReportKpi {
  key: string;
  label: string;
  value: unknown;
  format: KpiFormat;
}

export interface ReportColumn {
  key: string;
  label: string;
  format: KpiFormat;
}

export type ReportRow = Record<string, unknown>;

export interface ReportSection {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportEnvelope {
  meta: ReportMeta;
  kpis: ReportKpi[];
  sections: ReportSection[];
}

export interface ReportQueryParams {
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
}
