/** Mirrors `modules/revenue/models.rs`. Decimals arrive as strings. */
export interface RevenueKpis {
  room_revenue: string;
  room_nights_sold: number;
  occupancy_rate: string;
  adr: string;
  revpar: string;
  alos_nights: string;
  bookings_created: number;
  void_rate: string;
  no_show_rate: string;
  direct_share: string;
}

export interface RevenueRangeInfo {
  from: string;
  to: string;
}

export interface RevenueDailyPoint {
  date: string;
  room_revenue: string;
  room_nights_sold: number;
  occupancy_rate: string;
  adr: string;
}

export interface RevenueChannelMix {
  channel_id: number | null;
  channel_name: string;
  channel_type: string;
  bookings: number;
  net_revenue: string;
  share_pct: string;
}

/** KPI name → percent change; `null` means no previous-period baseline. */
export type RevenueDeltas = Record<keyof RevenueKpis, number | null>;

export interface RevenueOverview {
  range: RevenueRangeInfo;
  currency: string;
  kpis: RevenueKpis;
  previous_period: RevenueRangeInfo;
  previous_kpis: RevenueKpis;
  deltas_pct: RevenueDeltas;
  daily: RevenueDailyPoint[];
  channels: RevenueChannelMix[];
}

export interface RevenueOverviewParams {
  from?: string;
  to?: string;
  room_type_id?: number;
  channel_id?: number;
}
