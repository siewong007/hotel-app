// Base API client configuration
import ky, { isHTTPError, type HTTPError } from 'ky';
import { storage } from '../utils/storage';
import { getActiveLocale } from '../i18n/localeStore';
import { getAccessToken, setAccessToken, clearAccessToken } from '../auth/tokenStore';
import { apiUrl, getApiBaseUrl, resolveApiRequestUrl } from '../desktop/runtimeApi';
import {
  emitApiNotification,
  getExplicitApiNotificationMessage,
  getApiNotificationMessage,
  getApiNotificationSeverity,
} from '../utils/apiNotifications';
import { queryClient } from './queryClient';
import { domainForApiPath, invalidateDomain } from './queryInvalidation';

// API Error class for better error handling
export class APIError extends Error {
  statusCode?: number;
  details?: unknown;

  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * The JSON body the backend returns alongside a failed request. Only `error`
 * and `message` are contractual; the rest is passed through to `APIError.details`.
 */
export type ApiErrorBody = {
  error?: string;
  message?: string;
  [key: string]: unknown;
};

/**
 * Read the parsed body of a failed request.
 *
 * ky 2 pre-parses the error body into `error.data` and CONSUMES the response
 * stream doing it, so `error.response.json()` always rejects with "Body is
 * unusable". Call sites that wrapped that read in `.catch(() => ({}))` therefore
 * swallowed the rejection and always got `{}` — discarding every server-supplied
 * message in favour of their generic fallback. Read `error.data` instead.
 *
 * Returns `{}` when the body was empty, unparseable, or not a JSON object (ky
 * sets `data` to a plain string for non-JSON content types), which keeps the
 * "always an object" shape callers pass to `APIError.details`.
 *
 * See ky's HTTPError doc comment, src/api/client.ts's `beforeError` hook, and
 * lessons theme 13.
 */
export function readErrorData(error: HTTPError): ApiErrorBody {
  const body: unknown = error.data;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as ApiErrorBody)
    : {};
}

// Legacy snapshot for code that only needs to display/debug the current startup base URL.
// Requests resolve the API base dynamically so Tauri can update it after boot.
export const API_BASE_URL = getApiBaseUrl();

// The refresh endpoint now returns only the access token in the body; the rotated
// refresh token is delivered via the HttpOnly cookie and is not visible to JS.
type RefreshTokenResponse = {
  access_token: string;
};

let refreshPromise: Promise<RefreshTokenResponse | null> | null = null;
// The initial auth check gates the entire application shell. Keep its failure
// bounded so an unreachable local API or a stale Safari connection cannot
// leave the page on its loading screen for the normal request timeout.
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * ky 1 called `beforeRequest(request, options)`. ky 2 calls
 * `beforeRequest({ request, options, retryCount })`. Destructuring
 * `{ request }` from a Request yields `undefined`, then `request.url`
 * throws "Cannot read properties of undefined (reading 'url')" on login.
 */
/**
 * The browser's IANA timezone, or `undefined` where it cannot be read.
 *
 * `Intl` is present in every supported browser but not in every environment
 * this module is imported into (tests, SSR-style tooling), and a locked-down
 * browser can throw rather than return, so the whole read is guarded.
 */
function resolveClientTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function requestFromKyHook(input: unknown): Request {
  if (input instanceof Request) {
    return input;
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'request' in input &&
    (input as { request: unknown }).request instanceof Request
  ) {
    return (input as { request: Request }).request;
  }
  throw new TypeError('API client hook received no request');
}

function kyHookResponse(input: unknown, positionalResponse?: Response): Response | undefined {
  if (positionalResponse instanceof Response) {
    return positionalResponse;
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'response' in input &&
    (input as { response: unknown }).response instanceof Response
  ) {
    return (input as { response: Response }).response;
  }
  return undefined;
}

function kyHookError(input: unknown): Error {
  if (input instanceof Error) {
    return input;
  }
  if (typeof input === 'object' && input !== null && 'error' in input) {
    const nested = (input as { error: unknown }).error;
    if (nested instanceof Error) {
      return nested;
    }
  }
  return new Error(typeof input === 'string' ? input : 'API request failed');
}

function kyHookOptions(input: unknown, positionalOptions?: unknown): Parameters<typeof ky>[1] {
  if (
    typeof input === 'object' &&
    input !== null &&
    'options' in input &&
    (input as { options?: unknown }).options
  ) {
    return (input as { options: Parameters<typeof ky>[1] }).options;
  }
  return positionalOptions as Parameters<typeof ky>[1];
}

function requestOriginPrefix(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost/';
  }

  return new URL('/', window.location.href).toString();
}

function isAuthEndpoint(url: string): boolean {
  const pathname = new URL(
    url,
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  ).pathname;

  return [
    '/auth/login',
    '/auth/logout',
    '/auth/passkey',
    '/auth/refresh',
    '/auth/register',
  ].some(endpoint => pathname.includes(endpoint));
}

// Guest-portal endpoints use their own bearer token (sessionStorage-backed,
// see src/features/guestPortal/api/portalTokenStore.ts) — a 401 there says
// nothing about the staff session.
function isGuestPortalRequest(url: string): boolean {
  const pathname = new URL(
    url,
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  ).pathname;

  return pathname.includes('/guest-portal/');
}

function clearStoredAuth(): void {
  clearAccessToken();
  storage.removeItem('user');
  storage.removeItem('roles');
  storage.removeItem('permissions');
  storage.removeItem('routePolicies');
}

/**
 * Silently re-mints an access token using the HttpOnly refresh cookie (sent
 * automatically because the instance uses `credentials: 'include'`). No refresh
 * token is read from or written to storage — the new access token is kept in the
 * in-memory token store only. Concurrent callers share a single in-flight request.
 */
export async function refreshAccessToken(): Promise<RefreshTokenResponse | null> {
  if (!refreshPromise) {
    refreshPromise = ky.post(apiUrl('auth/refresh'), {
      credentials: 'include',
      timeout: REFRESH_TIMEOUT_MS,
    })
      .json<RefreshTokenResponse>()
      .then(tokens => {
        setAccessToken(tokens.access_token);
        window.dispatchEvent(new CustomEvent('auth:tokens-refreshed', {
          detail: { accessToken: tokens.access_token },
        }));
        return tokens;
      })
      .catch(error => {
        console.warn('Unable to refresh access token:', error);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

async function retryWithFreshAccessToken(
  request: Request,
  options: Parameters<typeof ky>[1],
): Promise<Response> {
  const retryHeaders = new Headers(request.headers);
  const accessToken = getAccessToken();
  if (accessToken) {
    retryHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  const retryRequest = new Request(request, { headers: retryHeaders });

  return ky(retryRequest, {
    ...options,
    throwHttpErrors: false,
    hooks: {
      ...options?.hooks,
      afterResponse: [],
    },
  });
}

async function createRequestWithUrl(request: Request, url: string): Promise<Request> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  const body = hasBody ? await request.clone().blob() : undefined;

  return new Request(url, {
    method: request.method,
    headers: new Headers(request.headers),
    body,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  });
}

// Successful mutations refresh their data domain automatically — call sites
// no longer need to remember which queries to invalidate. GETs and unmapped
// paths (auth, guest-portal, settings) skip this entirely. Best-effort: a URL
// parse hiccup must not fail the request.
function invalidateMutationDomain(request: Request, response: Response) {
  if (!response.ok) return;
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  try {
    const domain = domainForApiPath(new URL(request.url).pathname);
    if (domain) invalidateDomain(queryClient, domain);
  } catch {
    // ignore
  }
}

// Create ky instance with hooks for auth and error handling
export const api = ky.create({
  // Resolve service paths from the application root. Without this, a relative
  // path requested from `/portal/book` becomes `/portal/<service-path>` before
  // the API hook can add `/api`, producing routes such as
  // `/api/portal/guest-portal/...`.
  prefix: requestOriginPrefix(),
  timeout: 30000, // 30 second timeout
  // Send the HttpOnly refresh cookie on auth requests (same-origin in prod and
  // through the Vite dev proxy). Regular API calls still authenticate via the
  // in-memory bearer token injected in `beforeRequest`.
  credentials: 'include',
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
    // Ky uses this list to prefer the server-provided Retry-After delay over
    // its exponential fallback. Cap it so a malformed response cannot stall
    // the interface indefinitely.
    afterStatusCodes: [413, 429, 503],
    maxRetryAfter: 30_000,
    jitter: true,
  },
  hooks: {
    beforeRequest: [
      async (input: unknown) => {
        const request = requestFromKyHook(input);
        const nextUrl = resolveApiRequestUrl(request.url);
        const apiRequest = nextUrl === request.url ? request : await createRequestWithUrl(request, nextUrl);
        // Tell the API which language this client is showing, so server-rendered
        // output that leaves the browser — booking confirmation emails, receipts —
        // is written in the language the guest is actually reading. A caller that
        // set the header itself (a staff member acting on a guest's behalf) wins.
        if (!apiRequest.headers.has('Accept-Language')) {
          apiRequest.headers.set('Accept-Language', getActiveLocale());
        }
        // Approximate sign-in location for the "signed-in devices" list. The
        // backend reads this only on the sign-in routes, where it is stored
        // against the new session; nothing geolocates the IP. Sent on every
        // request for the same reason Accept-Language is: one place to set it,
        // and no per-endpoint list to keep in step.
        if (!apiRequest.headers.has('X-Client-Timezone')) {
          const timeZone = resolveClientTimezone();
          if (timeZone) {
            apiRequest.headers.set('X-Client-Timezone', timeZone);
          }
        }
        // Requests that set their own Authorization header (e.g. the guest
        // portal's session token) must not be overwritten with the staff token.
        if (apiRequest.headers.has('Authorization')) {
          return apiRequest;
        }
        const token = getAccessToken();
        if (token) {
          apiRequest.headers.set('Authorization', `Bearer ${token}`);
        } else if (!isGuestPortalRequest(apiRequest.url)) {
          console.warn('API Request:', apiRequest.method, apiRequest.url, 'WITHOUT TOKEN');
        }

        return apiRequest;
      }
    ],
    afterResponse: [
      async (input: unknown, positionalOptions?: unknown, positionalResponse?: Response) => {
        const request = requestFromKyHook(input);
        const options = kyHookOptions(input, positionalOptions);
        const response = kyHookResponse(input, positionalResponse);
        if (!response) {
          return response;
        }
        if (response.status === 401) {
          console.error('401 Unauthorized response for:', request.method, request.url);

          // Only refresh/logout for 401s on protected STAFF endpoints — auth
          // endpoints and guest-portal requests (separate session, handled by
          // the portal's own hooks) must not clear the staff session.
          if (!isAuthEndpoint(request.url) && !isGuestPortalRequest(request.url)) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
              const retryResponse = await retryWithFreshAccessToken(request, options);
              invalidateMutationDomain(request, retryResponse);
              return retryResponse;
            }

            console.warn('Auto-logout triggered due to 401 on protected endpoint');
            // Token expired or invalid - clear only auth data, preserve language preferences.
            clearStoredAuth();

            // Use React Router navigation instead of hard redirect
            // Dispatch a custom event that AuthContext can listen to
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
        }
        invalidateMutationDomain(request, response);
        return response;
      }
    ],
    beforeError: [
      async (input: unknown) => {
        const error = kyHookError(input);
        if (!isHTTPError(error)) return error;
        const { response } = error;

        if (response.status === 423 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('api:resource-locked'));
        }

        // ky 2 pre-consumes the response body into `error.data`, so the
        // stream is already used and `response.json()` would throw here.
        const payload = error.data;
        const explicitMessage = getExplicitApiNotificationMessage(payload);
        if (!explicitMessage) return error;

        const message = getApiNotificationMessage(payload, response.status);
        error.message = message;

        emitApiNotification({
          message,
          severity: getApiNotificationSeverity(payload, response.status),
          statusCode: response.status,
        });

        return error;
      }
    ]
  }
});

/**
 * Convert a thrown request error into an `APIError`. Replaces the repeated
 * `if (error instanceof HTTPError) { ... }` catch-block boilerplate in
 * services. For HTTP errors the server's `{"error": ...}`/`message`/`detail`
 * payload wins; transport failures (timeout, offline, socket close) collapse
 * to the caller's user-safe fallback — the service tests codify that contract.
 */
export function toApiError(error: unknown, fallback: string): APIError {
  // Already wrapped — pass through so an outer catch can't downgrade it to
  // the generic fallback or lose statusCode/details.
  if (error instanceof APIError) return error;
  if (isHTTPError(error)) {
    const details = readErrorData(error);
    return new APIError(
      getExplicitApiNotificationMessage(details) ?? fallback,
      error.response.status,
      details,
    );
  }
  return new APIError(fallback);
}
