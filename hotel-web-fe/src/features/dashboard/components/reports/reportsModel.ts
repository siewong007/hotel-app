import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { addLocalDays, formatLocalDate, parseLocalDate } from '../../../../utils/date';
import { getQueryErrorMessage, queryGcTime, queryStaleTime } from '../../../../api/queryConfig';
import { useInsightsOverview } from '../../../insights/hooks';
import { RevenueApi } from '../../../revenue/api';
import { useRevenueOverview } from '../../../revenue/hooks/useRevenueOverview';
import type { DebtorRow, Receivables, RevenueKpis } from '../../../revenue/types';
import { intlTag, useTranslation, type UseTranslationResult } from '../../../../i18n';

type T = UseTranslationResult['t'];

/* Reports & Analytics data model.
 *
 * Everything on this page is real backend data:
 *  - live operational tiles + arrival/departure rosters: `insights/overview`
 *  - KPIs, daily trends, channel mix, per-type performance, pipeline:
 *    `revenue/overview` (stay-date basis; channels use booking-date basis)
 *  - outstanding ageing + debtor rows: `revenue/receivables`
 * Revenue endpoints are gated on `revenue:read` — callers pass
 * `revenueEnabled` so scoped users don't fan out 403s.
 */

export type CompareMode = 'prev' | 'month' | 'year';
export type RangeDays = 7 | 30 | 90;

export interface ReportsQuery {
  rangeDays: RangeDays;
  roomTypeId?: number;
  channelId?: number;
  compare: CompareMode;
}

export interface DailyPoint {
  date: string;
  label: string;
  occ: number;
  occRooms: number;
  adr: number;
  room: number;
  other: number;
  total: number;
}

export type Unit = '%' | 'RM' | 'int';
export interface Kpi { value: number; prev: number | null; unit: Unit; spark: number[] }
export type KpiKind = 'occupancy' | 'adr' | 'revpar' | 'roomRev' | 'totalRev' | 'outstanding';

export interface SourceSlice { label: string; value: number; bookings: number; channelId: number | null }
export interface RoomTypePerf { id: number; type: string; rooms: number; occ: number; adr: number; rev: number }
export interface AgeingBucket { key: string; bucket: string; value: number; count: number }
export interface BalanceRow { name: string; ref: string; bal: number; age: string; stay?: string; terms?: string }
export interface RoomStatusSlice { label: string; count: number; color: string }
export interface RevenueState { label: string; desc: string; value: number; color: string }
export interface ArrivalRow { name: string; room: string; type: string; source: string; nights: number; eta: string; bal: number; vip?: boolean }
export interface DepartureRow { name: string; room: string; type: string; out: string; bal: number; nights: number }

export interface LiveOps {
  updated: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  occNow: number;
  toClean: number;
  ready: number;
  unassigned: number;
}

export interface ReportsModel {
  periodRooms: number;
  periodDays: number;
  todayLabel: string;
  daily: DailyPoint[];
  roomRev: number;
  otherRev: number;
  kpis: Record<KpiKind, Kpi>;
  live: LiveOps;
  sources: SourceSlice[];
  roomTypes: RoomTypePerf[];
  ageing: AgeingBucket[];
  guestBalances: BalanceRow[];
  companyBalances: BalanceRow[];
  roomStatus: RoomStatusSlice[];
  revenueStates: RevenueState[];
  arrivals: ArrivalRow[];
  departures: DepartureRow[];
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Comparison baseline: the overview's previous-period KPIs, or a second
 *  overview fetched on a month/year-shifted window. */
function baselineKpis(
  compare: CompareMode,
  overviewKpis: RevenueKpis | undefined,
  previousKpis: RevenueKpis | undefined,
  shiftedKpis: RevenueKpis | undefined,
): RevenueKpis | undefined {
  if (compare === 'prev') return previousKpis;
  return shiftedKpis;
}

const prevNum = (base: RevenueKpis | undefined, key: keyof RevenueKpis): number | null =>
  base ? num(base[key]) : null;

function shiftRange(from: string, to: string, compare: CompareMode): { from: string; to: string } {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  if (compare === 'month') {
    f.setMonth(f.getMonth() - 1);
    t.setMonth(t.getMonth() - 1);
  } else {
    f.setFullYear(f.getFullYear() - 1);
    t.setFullYear(t.getFullYear() - 1);
  }
  return { from: formatLocalDate(f), to: formatLocalDate(t) };
}

function buildModel(
  t: T,
  query: ReportsQuery,
  overview: ReturnType<typeof useRevenueOverview>['data'],
  baseline: RevenueKpis | undefined,
  insights: ReturnType<typeof useInsightsOverview>['data'],
  receivables: Receivables | undefined,
): ReportsModel {
  const periodDays = query.rangeDays;
  const periodRooms = insights?.rooms.total ?? 0;

  const daily: DailyPoint[] = (overview?.daily ?? []).map((d) => {
    const room = num(d.room_revenue);
    const other = num(d.other_revenue);
    const date = parseLocalDate(d.date);
    return {
      date: d.date,
      label: `${date.getDate()} ${date.toLocaleString(intlTag(), { month: 'short' })}`,
      occ: num(d.occupancy_rate),
      occRooms: d.room_nights_sold,
      adr: num(d.adr),
      room,
      other,
      total: room + other,
    };
  });

  const roomRev = num(overview?.kpis.room_revenue);
  const otherRev = num(overview?.kpis.service_revenue);
  const receivablesTotal = receivables ? num(receivables.total) : 0;

  // Sellable rooms per day derived from the range aggregate — RevPAR's
  // denominator (nights_sold ÷ occupancy ÷ days). Zero when unknowable.
  const nightsSold = overview?.kpis.room_nights_sold ?? 0;
  const occPct = num(overview?.kpis.occupancy_rate);
  const sellablePerDay =
    occPct > 0 && periodDays > 0 ? nightsSold / (occPct / 100) / periodDays : 0;
  const revparSpark =
    sellablePerDay > 0 ? daily.map((d) => d.room / sellablePerDay) : [];

  const kpis: Record<KpiKind, Kpi> = {
    occupancy: {
      value: overview ? num(overview.kpis.occupancy_rate) : num(insights?.occupancy_rate),
      prev: prevNum(baseline, 'occupancy_rate'),
      unit: '%',
      spark: daily.map((d) => d.occ),
    },
    adr: {
      value: num(overview?.kpis.adr),
      prev: prevNum(baseline, 'adr'),
      unit: 'RM',
      spark: daily.map((d) => d.adr),
    },
    revpar: {
      value: num(overview?.kpis.revpar),
      prev: prevNum(baseline, 'revpar'),
      unit: 'RM',
      spark: revparSpark,
    },
    roomRev: {
      value: roomRev,
      prev: prevNum(baseline, 'room_revenue'),
      unit: 'RM',
      spark: daily.map((d) => d.room),
    },
    totalRev: {
      value: num(overview?.kpis.total_revenue) || roomRev + otherRev,
      prev: prevNum(baseline, 'total_revenue'),
      unit: 'RM',
      spark: daily.map((d) => d.total),
    },
    // Outstanding is point-in-time — no history exists, so no sparkline and
    // no period comparison (Delta renders "· no prior" for null prev).
    outstanding: {
      value: receivablesTotal,
      prev: null,
      unit: 'RM',
      spark: [],
    },
  };

  const live: LiveOps = {
    updated: new Date().toLocaleTimeString(intlTag(), { hour: '2-digit', minute: '2-digit', hour12: false }),
    arrivals: insights?.bookings.today_check_ins ?? 0,
    departures: insights?.bookings.today_check_outs ?? 0,
    inHouse: insights?.rooms.occupied ?? 0,
    occNow: num(insights?.occupancy_rate),
    toClean: insights?.rooms.cleaning ?? 0,
    ready: insights?.rooms.available ?? 0,
    unassigned: insights?.bookings.pending ?? 0,
  };

  const sources: SourceSlice[] = (overview?.channels ?? [])
    .map((c) => ({ label: c.channel_name, value: num(c.net_revenue), bookings: c.bookings, channelId: c.channel_id }))
    .filter((c) => c.value > 0 || c.bookings > 0)
    .sort((a, b) => b.value - a.value);

  const roomTypes: RoomTypePerf[] = (overview?.room_types ?? []).map((rt) => ({
    id: rt.room_type_id,
    type: rt.name,
    rooms: rt.rooms,
    occ: num(rt.occupancy_rate),
    adr: num(rt.adr),
    rev: num(rt.room_revenue),
  }));

  const ageing: AgeingBucket[] = (receivables?.buckets ?? []).map((b) => ({
    key: b.key,
    bucket: b.label,
    value: num(b.total),
    count: b.count,
  }));

  const toBalanceRow = (d: DebtorRow): BalanceRow => ({
    name: d.name,
    ref: d.invoice_number,
    bal: num(d.balance),
    age: d.bucket,
    stay: d.room ? t('bookings:details.roomNumber', { number: d.room }) : undefined,
    terms: d.due_date ? t('reports.drawers.dueDate', { date: d.due_date }) : undefined,
  });

  const roomStatus: RoomStatusSlice[] = [
    { label: t('reports.roomStatus.occupied'), count: live.inHouse, color: 'var(--amber)' },
    { label: t('reports.roomStatus.vacantReady'), count: live.ready, color: 'var(--emerald)' },
    { label: t('reports.roomStatus.vacantClean'), count: live.toClean, color: 'var(--rose)' },
    { label: t('reports.roomStatus.arrivingToday'), count: live.arrivals, color: 'var(--blue)' },
  ];

  const p = overview?.pipeline;
  const revenueStates: RevenueState[] = [
    { label: t('reports.revenueStates.booked.label'), desc: t('reports.revenueStates.booked.desc'), value: num(p?.booked), color: 'var(--hotel-info)' },
    { label: t('reports.revenueStates.earned.label'), desc: t('reports.revenueStates.earned.desc'), value: num(p?.earned), color: 'var(--hotel-primary)' },
    { label: t('reports.revenueStates.collected.label'), desc: t('reports.revenueStates.collected.desc'), value: num(p?.collected), color: 'var(--hotel-chart-3)' },
    { label: t('reports.revenueStates.outstanding.label'), desc: t('reports.revenueStates.outstanding.desc'), value: num(p?.outstanding), color: 'var(--hotel-warning)' },
  ];

  const todayLabel = new Date().toLocaleDateString(intlTag(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return {
    periodRooms,
    periodDays,
    todayLabel,
    daily,
    roomRev,
    otherRev,
    kpis,
    live,
    sources,
    roomTypes,
    ageing,
    guestBalances: (receivables?.guests ?? []).map(toBalanceRow),
    companyBalances: (receivables?.companies ?? []).map(toBalanceRow),
    roomStatus,
    revenueStates,
    arrivals: (insights?.arrivals ?? []).map((a) => ({
      name: a.guest_name,
      room: a.room_number,
      type: a.room_type,
      source: a.source,
      nights: a.nights,
      eta: a.eta,
      bal: a.balance,
      vip: a.vip,
    })),
    departures: (insights?.departures ?? []).map((d) => ({
      name: d.guest_name,
      room: d.room_number,
      type: d.room_type,
      out: d.out,
      bal: d.balance,
      nights: d.nights,
    })),
  };
}

export interface UseReportsModelResult {
  model: ReportsModel;
  /** True while the revenue queries are fetching — occupancy-only data may
   *  still render from insights. */
  loading: boolean;
  liveLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useReportsModel(query: ReportsQuery, revenueEnabled: boolean): UseReportsModelResult {
  const { t } = useTranslation('dashboard');
  const to = formatLocalDate(new Date());
  const from = formatLocalDate(addLocalDays(new Date(), -(query.rangeDays - 1)));
  const overviewParams = useMemo(
    () => ({ from, to, room_type_id: query.roomTypeId, channel_id: query.channelId }),
    [from, to, query.roomTypeId, query.channelId],
  );

  const insights = useInsightsOverview();
  const overview = useRevenueOverview(overviewParams, revenueEnabled);
  const receivables = useQuery({
    queryKey: ['revenue', 'receivables'],
    queryFn: RevenueApi.receivables,
    enabled: revenueEnabled,
    staleTime: queryStaleTime.short,
    gcTime: queryGcTime.standard,
  });

  // 'month'/'year' comparisons need a second overview on the shifted window;
  // 'prev' uses the previous_kpis already embedded in the main response.
  const shifted = useMemo(
    () => (query.compare === 'prev' ? null : shiftRange(from, to, query.compare)),
    [from, to, query.compare],
  );
  const shiftedOverview = useQuery({
    queryKey: ['revenue', 'overview', shifted, query.roomTypeId, query.channelId],
    queryFn: () =>
      RevenueApi.overview({
        ...shifted!,
        room_type_id: query.roomTypeId,
        channel_id: query.channelId,
      }),
    enabled: revenueEnabled && shifted != null,
    staleTime: queryStaleTime.short,
    gcTime: queryGcTime.standard,
  });

  const baseline = baselineKpis(
    query.compare,
    overview.data?.kpis,
    overview.data?.previous_kpis,
    shiftedOverview.data?.kpis,
  );

  const model = useMemo(
    () => buildModel(t, query, overview.data, baseline, insights.data, receivables.data),
    [t, query, overview.data, baseline, insights.data, receivables.data],
  );

  const revenuePending =
    revenueEnabled &&
    (overview.isPending || receivables.isPending || (shifted != null && shiftedOverview.isPending));

  return {
    model,
    loading: revenuePending,
    liveLoading: insights.isPending,
    error:
      getQueryErrorMessage(insights.error, t('reports.errors.loadFailed')) ||
      (revenueEnabled ? getQueryErrorMessage(overview.error, t('reports.errors.loadFailed')) : '') ||
      null,
    refetch: () => {
      insights.refetch();
      if (revenueEnabled) {
        overview.refetch();
        receivables.refetch();
      }
    },
  };
}
