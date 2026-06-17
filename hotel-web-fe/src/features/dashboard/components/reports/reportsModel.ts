import { useMemo } from 'react';
import { useDashboardAnalytics } from '../../hooks/useDashboardAnalytics';
import { useBookingStats } from '../../../bookings/hooks/useBookingQueries';

/* Reports & Analytics data model.
 *
 * Live operational figures and occupancy are wired to real backend data
 * (rooms, booking stats, guests). Financial breakdowns the backend does not yet
 * expose — ADR / RevPAR, booking-source mix, outstanding ageing, per-type
 * revenue, and the named arrival/departure rosters — are illustrative sample
 * data carried over from the design so the panels read as intended. Replace
 * these as the corresponding endpoints land.
 */

const DAY_MS = 86400000;

export interface DailyPoint {
  date: Date;
  label: string;
  dow: number;
  occ: number;
  occRooms: number;
  adr: number;
  room: number;
  other: number;
  total: number;
}

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function buildDaily(periodRooms: number): DailyPoint[] {
  const rnd = seeded(7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: DailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const dow = d.getDay();
    const weekend = dow === 5 || dow === 6;
    const base = weekend ? 0.9 : 0.74;
    const occ = Math.max(0.55, Math.min(0.98, base + (rnd() - 0.5) * 0.18));
    const occRooms = Math.round(occ * periodRooms);
    const adr = 195 + rnd() * 45 + (weekend ? 22 : 0);
    const room = Math.round(occRooms * adr);
    const other = Math.round(room * (0.16 + rnd() * 0.08));
    out.push({
      date: d,
      label: d.getDate() + ' ' + d.toLocaleString('en', { month: 'short' }),
      dow,
      occ: +(occ * 100).toFixed(1),
      occRooms,
      adr: Math.round(adr),
      room,
      other,
      total: room + other,
    });
  }
  return out;
}

export type Unit = '%' | 'RM' | 'int';
export interface Kpi { value: number; prev: number; unit: Unit; spark: number[] }
export type KpiKind = 'occupancy' | 'adr' | 'revpar' | 'roomRev' | 'totalRev' | 'outstanding';

export interface SourceSlice { label: string; value: number; bookings: number; color: string }
export interface RoomTypePerf { type: string; rooms: number; occ: number; adr: number; rev: number }
export interface AgeingBucket { bucket: string; value: number; color: string }
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

const SOURCES: SourceSlice[] = [
  { label: 'Direct', value: 91400, bookings: 142, color: 'var(--emerald)' },
  { label: 'Booking.com', value: 70760, bookings: 108, color: 'var(--blue)' },
  { label: 'Agoda', value: 50120, bookings: 84, color: 'var(--indigo)' },
  { label: 'Corporate', value: 41280, bookings: 38, color: 'var(--amber)' },
  { label: 'Walk-in', value: 26540, bookings: 61, color: '#5BB6A0' },
  { label: 'Expedia', value: 14740, bookings: 22, color: 'var(--rose)' },
];

const AGEING: AgeingBucket[] = [
  { bucket: 'Current', value: 21300, color: 'var(--emerald)' },
  { bucket: '1–30 days', value: 14800, color: 'var(--blue)' },
  { bucket: '31–60 days', value: 9200, color: 'var(--amber)' },
  { bucket: '61–90 days', value: 4600, color: '#E08A2B' },
  { bucket: '90+ days', value: 2240, color: 'var(--rose)' },
];

const GUEST_BAL: BalanceRow[] = [
  { name: 'Wong Kah Hoe', ref: 'FOL-2261', bal: 1200, age: 'Current', stay: 'In-house · rm 109' },
  { name: 'Chen Mei Ling', ref: 'FOL-2244', bal: 1280, age: 'Current', stay: 'Departing today · rm 118' },
  { name: 'Arjun Nair', ref: 'FOL-2238', bal: 640, age: '1–30 days', stay: 'Departing today · rm 212' },
  { name: 'Daniel Tham', ref: 'INV-1180', bal: 2950, age: '31–60 days', stay: 'Checked out 12 May' },
  { name: 'Farah Diana', ref: 'INV-1142', bal: 1810, age: '61–90 days', stay: 'Checked out 28 Apr' },
];

const COMPANY_BAL: BalanceRow[] = [
  { name: 'Petronas Dagangan Bhd', ref: 'INV-1204', bal: 18400, age: '1–30 days', terms: 'Net 30' },
  { name: 'Sime Darby Property', ref: 'INV-1198', bal: 9600, age: '31–60 days', terms: 'Net 30' },
  { name: 'Lim Construction Sdn', ref: 'INV-1176', bal: 6240, age: '61–90 days', terms: 'Net 14' },
  { name: 'Maybank Berhad', ref: 'INV-1155', bal: 4120, age: '90+ days', terms: 'Net 30' },
  { name: 'Grab Holdings', ref: 'INV-1211', bal: 3300, age: 'Current', terms: 'Net 30' },
];

const ARRIVALS: ArrivalRow[] = [
  { name: 'Nurul Izzah binti Hamid', room: '—', type: 'Deluxe King', source: 'Booking.com', nights: 3, eta: '14:00', bal: 0, vip: true },
  { name: 'Tan Wei Jie', room: '—', type: 'Standard Twin', source: 'Direct', nights: 2, eta: '15:30', bal: 0 },
  { name: 'Petronas Dagangan Bhd', room: '—', type: 'Deluxe King ×2', source: 'Corporate', nights: 4, eta: '12:00', bal: 0 },
  { name: 'Rajesh Kumar', room: '—', type: 'Family Suite', source: 'Agoda', nights: 5, eta: '16:00', bal: 240 },
  { name: 'Aisha Abdullah', room: '—', type: 'Standard King', source: 'Walk-in', nights: 1, eta: '—', bal: 0 },
  { name: 'Lim Construction Sdn', room: '—', type: 'Standard Twin ×3', source: 'Corporate', nights: 6, eta: '13:30', bal: 0 },
];

const DEPARTURES: DepartureRow[] = [
  { name: 'Mohd Faiz bin Razak', room: '204', type: 'Deluxe King', out: '11:00', bal: 0, nights: 2 },
  { name: 'Chen Mei Ling', room: '118', type: 'Standard Twin', out: '12:00', bal: 1280, nights: 4 },
  { name: 'Siti Khadijah', room: '305', type: 'Family Suite', out: '11:30', bal: 0, nights: 3 },
  { name: 'Arjun Nair', room: '212', type: 'Deluxe King', out: '10:30', bal: 640, nights: 1 },
  { name: 'Wong Kah Hoe', room: '109', type: 'Standard King', out: '12:00', bal: 1200, nights: 5 },
];

// Per-type ADR / revenue is sample data; occupancy + room counts are overridden
// with live figures where the room type exists in the live inventory.
const ROOM_TYPES_SAMPLE: RoomTypePerf[] = [
  { type: 'Standard', rooms: 28, occ: 82.4, adr: 168, rev: 116200 },
  { type: 'Deluxe King', rooms: 18, occ: 76.1, adr: 238, rev: 92600 },
  { type: 'Twin', rooms: 10, occ: 73.5, adr: 196, rev: 53100 },
  { type: 'Family Suite', rooms: 4, occ: 68.2, adr: 372, rev: 32940 },
];

function buildModel(
  occupancyRate: number,
  liveOps: LiveOps,
  realTotalRevenue: number,
  realRoomTypes: { name: string; count: number; occupied: number }[],
): ReportsModel {
  const periodRooms = Math.max(liveOps.inHouse + liveOps.ready + liveOps.toClean + liveOps.unassigned, 1);
  const periodDays = 30;
  const daily = buildDaily(periodRooms || 60);

  const roomRev = daily.reduce((a, d) => a + d.room, 0);
  const otherRev = daily.reduce((a, d) => a + d.other, 0);
  const occNights = daily.reduce((a, d) => a + d.occRooms, 0);
  const availNights = (periodRooms || 60) * periodDays;
  const adr = occNights ? roomRev / occNights : 0;
  const revpar = availNights ? roomRev / availNights : 0;
  const totalRev = realTotalRevenue > 0 ? realTotalRevenue : roomRev + otherRev;
  const outstanding = AGEING.reduce((a, b) => a + b.value, 0);

  const kpis: Record<KpiKind, Kpi> = {
    occupancy: { value: occupancyRate, prev: 71.6, unit: '%', spark: daily.map((d) => d.occ) },
    adr: { value: adr, prev: 198, unit: 'RM', spark: daily.map((d) => d.adr) },
    revpar: { value: revpar, prev: 142, unit: 'RM', spark: daily.map((d) => Math.round(d.room / (periodRooms || 60))) },
    roomRev: { value: roomRev, prev: 268400, unit: 'RM', spark: daily.map((d) => d.room) },
    totalRev: { value: totalRev, prev: 318900, unit: 'RM', spark: daily.map((d) => d.total) },
    outstanding: { value: outstanding, prev: 58320, unit: 'RM', spark: daily.map((d) => 60000 - d.total * 0.6) },
  };

  // Merge live occupancy/counts into the sample per-type revenue table.
  const roomTypes: RoomTypePerf[] = realRoomTypes.length
    ? realRoomTypes.map((rt, i) => {
        const sample = ROOM_TYPES_SAMPLE[i] || ROOM_TYPES_SAMPLE[ROOM_TYPES_SAMPLE.length - 1];
        const occ = rt.count ? (rt.occupied / rt.count) * 100 : 0;
        return { type: rt.name, rooms: rt.count, occ: +occ.toFixed(1), adr: sample.adr, rev: sample.rev };
      })
    : ROOM_TYPES_SAMPLE;

  const roomStatus: RoomStatusSlice[] = [
    { label: 'Occupied', count: liveOps.inHouse, color: 'var(--amber)' },
    { label: 'Vacant · ready', count: liveOps.ready, color: 'var(--emerald)' },
    { label: 'Vacant · clean', count: liveOps.toClean, color: 'var(--rose)' },
    { label: 'Arriving today', count: liveOps.arrivals, color: 'var(--blue)' },
  ];

  const revenueStates: RevenueState[] = [
    { label: 'Booked', desc: 'Confirmed future bookings', value: 86400, color: 'var(--blue)' },
    { label: 'Earned', desc: 'Completed room nights', value: roomRev, color: 'var(--emerald)' },
    { label: 'Collected', desc: 'Payments received', value: Math.max(roomRev - 41200, 0), color: '#5BB6A0' },
    { label: 'Outstanding', desc: 'Unpaid invoices', value: outstanding, color: 'var(--amber)' },
  ];

  const todayLabel = new Date().toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return {
    periodRooms: periodRooms || 60,
    periodDays,
    todayLabel,
    daily,
    roomRev,
    otherRev,
    kpis,
    live: liveOps,
    sources: SOURCES,
    roomTypes,
    ageing: AGEING,
    guestBalances: GUEST_BAL,
    companyBalances: COMPANY_BAL,
    roomStatus,
    revenueStates,
    arrivals: ARRIVALS,
    departures: DEPARTURES,
  };
}

/** prev value per comparison mode (sample multipliers for realism). */
export function prevOf(kpi: Kpi, kind: KpiKind, compare: 'prev' | 'month' | 'year'): number {
  const base = kpi.prev;
  const m = compare === 'month' ? 1 : compare === 'year' ? (kind === 'outstanding' ? 1.18 : 0.88) : 1.0;
  return base * m;
}

export interface UseReportsModelResult {
  model: ReportsModel;
  occupancyRate: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useReportsModel(): UseReportsModelResult {
  const { data, loading, error, refetch } = useDashboardAnalytics();
  const bookingStatsQuery = useBookingStats();

  const occupancyRate = data.roomStats.totalRooms > 0
    ? Math.round((data.roomStats.occupiedRooms / data.roomStats.totalRooms) * 100)
    : 0;

  const model = useMemo(() => {
    const rs = data.roomStats;
    const bs = data.bookingStats;
    const live: LiveOps = {
      updated: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false }),
      arrivals: bs.todayCheckIns,
      departures: bs.todayCheckOuts,
      inHouse: rs.occupiedRooms,
      occNow: occupancyRate,
      toClean: rs.cleaningRooms,
      ready: rs.availableRooms,
      unassigned: bs.pendingBookings,
    };
    return buildModel(
      occupancyRate,
      live,
      bookingStatsQuery.data?.total_revenue ?? 0,
      data.roomTypeStats,
    );
  }, [data, occupancyRate, bookingStatsQuery.data?.total_revenue]);

  return { model, occupancyRate, loading, error, refetch };
}
