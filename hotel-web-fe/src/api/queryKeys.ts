import type { AuditLogQuery } from '../types/audit.types';

type KeyParams = Record<string, unknown>;

const bookings = ['bookings'] as const;
const guests = ['guests'] as const;
const rooms = ['rooms'] as const;
const roomTypes = ['room-types'] as const;
const audit = ['audit'] as const;
const nightAudit = ['night-audit'] as const;
const dataTransfer = ['data-transfer'] as const;
const settings = ['settings'] as const;
const companies = ['companies'] as const;
const rates = ['rates'] as const;

const paramsOrEmpty = <T extends KeyParams | AuditLogQuery | undefined>(params: T) => params ?? {};

export const queryKeys = {
  bookings: {
    all: bookings,
    list: (params?: KeyParams) => [...bookings, 'list', paramsOrEmpty(params)] as const,
    page: (params?: KeyParams) => [...bookings, 'page', paramsOrEmpty(params)] as const,
    withDetails: (filters?: KeyParams) => [...bookings, 'with-details', paramsOrEmpty(filters)] as const,
    mine: () => [...bookings, 'mine'] as const,
    stats: () => [...bookings, 'stats'] as const,
    detail: (id: string | number) => [...bookings, 'detail', String(id)] as const,
    timeline: (id: string | number) => [...bookings, 'timeline', String(id)] as const,
    paymentWorkflow: (id: string | number) => [...bookings, 'payment-workflow', String(id)] as const,
  },
  guests: {
    all: guests,
    list: (params?: KeyParams) => [...guests, 'list', paramsOrEmpty(params)] as const,
    page: (params?: KeyParams) => [...guests, 'page', paramsOrEmpty(params)] as const,
    detail: (id: string | number) => [...guests, 'detail', String(id)] as const,
    bookings: (id: string | number) => [...guests, 'bookings', String(id)] as const,
    credits: (id: string | number) => [...guests, 'credits', String(id)] as const,
    mine: () => [...guests, 'mine'] as const,
    mineWithCredits: () => [...guests, 'mine-with-credits'] as const,
  },
  rooms: {
    all: rooms,
    list: (params?: KeyParams) => [...rooms, 'list', paramsOrEmpty(params)] as const,
    available: (checkInDate: string, checkOutDate: string, excludeBookingId?: number) =>
      [...rooms, 'available', checkInDate, checkOutDate, excludeBookingId ?? null] as const,
    detail: (id: string | number) => [...rooms, 'detail', String(id)] as const,
    detailedStatus: (id: string | number) => [...rooms, 'detailed-status', String(id)] as const,
    history: (id: string | number) => [...rooms, 'history', String(id)] as const,
    occupancy: () => [...rooms, 'occupancy'] as const,
    occupancySummary: () => [...rooms, 'occupancy-summary'] as const,
    occupancyByType: () => [...rooms, 'occupancy-by-type'] as const,
    withOccupancy: () => [...rooms, 'with-occupancy'] as const,
  },
  roomTypes: {
    all: roomTypes,
    active: () => [...roomTypes, 'active'] as const,
    list: () => [...roomTypes, 'list'] as const,
    detail: (id: string | number) => [...roomTypes, 'detail', String(id)] as const,
  },
  audit: {
    all: audit,
    logs: (params?: AuditLogQuery) => [...audit, 'logs', paramsOrEmpty(params)] as const,
    counts: (params?: AuditLogQuery) => [...audit, 'counts', paramsOrEmpty(params)] as const,
    actions: () => [...audit, 'actions'] as const,
    resourceTypes: () => [...audit, 'resource-types'] as const,
    users: () => [...audit, 'users'] as const,
  },
  nightAudit: {
    all: nightAudit,
    preview: (date: string) => [...nightAudit, 'preview', date] as const,
    runs: (page: number, pageSize: number) => [...nightAudit, 'runs', page, pageSize] as const,
    detail: (id: string | number) => [...nightAudit, 'detail', String(id)] as const,
    details: (id: string | number) => [...nightAudit, 'details', String(id)] as const,
    bookingPosted: (bookingId: string | number) => [...nightAudit, 'booking-posted', String(bookingId)] as const,
  },
  dataTransfer: {
    all: dataTransfer,
    export: () => [...dataTransfer, 'export'] as const,
  },
  settings: {
    all: settings,
    hotel: () => [...settings, 'hotel'] as const,
  },
  companies: {
    all: companies,
    list: (params?: KeyParams) => [...companies, 'list', paramsOrEmpty(params)] as const,
  },
  rates: {
    all: rates,
    rateCodes: () => [...rates, 'rate-codes'] as const,
    marketCodes: () => [...rates, 'market-codes'] as const,
  },
} as const;
