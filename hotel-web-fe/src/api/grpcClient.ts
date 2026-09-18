// Connect/gRPC-Web client for the Phase 2 tonic services.
//
// Mirrors src/api/client.ts's semantics on the Connect transport:
//   - bearer token from the in-memory tokenStore (never storage)
//   - Accept-Language + X-Client-Timezone on every call
//   - Code.Unauthenticated → single-flight refreshAccessToken() + ONE retry,
//     then clearStoredAuth + `auth:unauthorized` (same event AuthContext
//     listens for) — the gRPC twin of the ky 401 hook.
//   - successful mutating RPCs invalidate the same TanStack Query domain the
//     REST mutation hook derives from the path.
//
// baseUrl resolves through getApiBaseUrl() exactly like REST: empty in web
// builds means same-origin (Vite dev proxy / production reverse proxy both
// forward the root-level /hotel.* RPC paths); desktop uses the probed
// sidecar URL.

import { Code, ConnectError, createClient, type Interceptor, type Transport } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';

import { getAccessToken, clearAccessToken } from '../auth/tokenStore';
import { getActiveLocale } from '../i18n/localeStore';
import { getApiBaseUrl } from '../desktop/runtimeApi';
import { refreshAccessToken } from './client';
import { queryClient } from './queryClient';
import { invalidateDomain, type ApiDomain } from './queryInvalidation';
import { storage } from '../utils/storage';

import { GuestService } from '../gen/hotel/guests/v1/guest_service_pb';
import { HousekeepingService } from '../gen/hotel/housekeeping/v1/housekeeping_service_pb';
import { MaintenanceService } from '../gen/hotel/housekeeping/v1/maintenance_service_pb';
import { RoomService } from '../gen/hotel/rooms/v1/room_service_pb';
import { RoomTypeService } from '../gen/hotel/rooms/v1/room_type_service_pb';

function resolveClientTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function clearStoredAuth(): void {
  clearAccessToken();
  storage.removeItem('user');
  storage.removeItem('roles');
  storage.removeItem('permissions');
  storage.removeItem('routePolicies');
}

/**
 * The TanStack domain a successful mutation of `service` invalidates — the
 * same answer `domainForApiPath` gives for the REST path the RPC replaces.
 * MaintenanceService maps to null for parity: `/api/maintenance/*` is
 * unmapped in domainForApiPath, so REST maintenance mutations invalidate
 * nothing today either.
 */
function domainForService(serviceTypeName: string): ApiDomain | null {
  switch (serviceTypeName) {
    case 'hotel.rooms.v1.RoomService':
    case 'hotel.rooms.v1.RoomTypeService':
      return 'rooms';
    case 'hotel.housekeeping.v1.HousekeepingService':
      return 'housekeeping';
    case 'hotel.guests.v1.GuestService':
      return 'guests';
    default:
      return null;
  }
}

// Read-only methods never invalidate; everything else is a mutation. Matches
// REST's invalidateMutationDomain, which only fires for non-GET success.
const READ_PREFIXES = ['List', 'Get', 'Search'];

function invalidateOnSuccess(req: { stream: boolean; method: { name: string }; service: { typeName: string } }): void {
  if (req.stream) return;
  if (READ_PREFIXES.some(p => req.method.name.startsWith(p))) return;
  const domain = domainForService(req.service.typeName);
  if (domain) {
    invalidateDomain(queryClient, domain);
  }
}

// Exported for tests; production clients consume it via grpcTransport().
export const grpcInterceptor: Interceptor = next => async req => {
  const token = getAccessToken();
  if (token) {
    req.header.set('authorization', `Bearer ${token}`);
  }
  if (!req.header.has('accept-language')) {
    req.header.set('accept-language', getActiveLocale());
  }
  if (!req.header.has('x-client-timezone')) {
    const timeZone = resolveClientTimezone();
    if (timeZone) {
      req.header.set('x-client-timezone', timeZone);
    }
  }

  try {
    const res = await next(req);
    invalidateOnSuccess(req);
    return res;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Auth rejected the call before the handler ran, so the retry cannot
        // double-execute the mutation.
        req.header.set('authorization', `Bearer ${getAccessToken() ?? ''}`);
        const res = await next(req);
        invalidateOnSuccess(req);
        return res;
      }
      clearStoredAuth();
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    throw error;
  }
};

let transport: Transport | null = null;

export function grpcTransport(): Transport {
  if (!transport) {
    transport = createGrpcWebTransport({
      baseUrl: getApiBaseUrl() || '/',
      useBinaryFormat: true,
      defaultTimeoutMs: 30_000,
      interceptors: [grpcInterceptor],
    });
  }
  return transport;
}

// Clients are lazy singletons built on first call, not at module eval: on
// desktop the backend URL is only known after initializeDesktopBackendUrl()
// resolves during bootstrap, and any call happens after that.
export function resetGrpcTransportForTests(): void {
  transport = null;
  room = roomType = housekeeping = maintenance = guest = null;
}

let room: ReturnType<typeof createClient<typeof RoomService>> | null = null;
let roomType: ReturnType<typeof createClient<typeof RoomTypeService>> | null = null;
let housekeeping: ReturnType<typeof createClient<typeof HousekeepingService>> | null = null;
let maintenance: ReturnType<typeof createClient<typeof MaintenanceService>> | null = null;
let guest: ReturnType<typeof createClient<typeof GuestService>> | null = null;

export const roomClient = () => (room ??= createClient(RoomService, grpcTransport()));
export const roomTypeClient = () =>
  (roomType ??= createClient(RoomTypeService, grpcTransport()));
export const housekeepingClient = () =>
  (housekeeping ??= createClient(HousekeepingService, grpcTransport()));
export const maintenanceClient = () =>
  (maintenance ??= createClient(MaintenanceService, grpcTransport()));
export const guestClient = () => (guest ??= createClient(GuestService, grpcTransport()));
