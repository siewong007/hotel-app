// Base API client configuration
import ky from 'ky';
import { storage } from '../utils/storage';
import { getAccessToken, setAccessToken, clearAccessToken } from '../auth/tokenStore';
import { apiUrl, getApiBaseUrl, resolveApiRequestUrl } from '../desktop/runtimeApi';
import {
  emitApiNotification,
  getExplicitApiNotificationMessage,
  getApiNotificationMessage,
  getApiNotificationSeverity,
} from '../utils/apiNotifications';

// API Error class for better error handling
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
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
      timeout: 30000,
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

// Create ky instance with hooks for auth and error handling
export const api = ky.create({
  timeout: 30000, // 30 second timeout
  // Send the HttpOnly refresh cookie on auth requests (same-origin in prod and
  // through the Vite dev proxy). Regular API calls still authenticate via the
  // in-memory bearer token injected in `beforeRequest`.
  credentials: 'include',
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504]
  },
  hooks: {
    beforeRequest: [
      async request => {
        const nextUrl = resolveApiRequestUrl(request.url);
        const apiRequest = nextUrl === request.url ? request : await createRequestWithUrl(request, nextUrl);
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
      async (request, options, response) => {
        if (response.status === 401) {
          console.error('401 Unauthorized response for:', request.method, request.url);

          // Only refresh/logout for 401s on protected STAFF endpoints — auth
          // endpoints and guest-portal requests (separate session, handled by
          // the portal's own hooks) must not clear the staff session.
          if (!isAuthEndpoint(request.url) && !isGuestPortalRequest(request.url)) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
              return retryWithFreshAccessToken(request, options);
            }

            console.warn('Auto-logout triggered due to 401 on protected endpoint');
            // Token expired or invalid - clear only auth data, preserve language preferences.
            clearStoredAuth();

            // Use React Router navigation instead of hard redirect
            // Dispatch a custom event that AuthContext can listen to
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
        }
        return response;
      }
    ],
    beforeError: [
      async error => {
        const response = error.response;
        if (!response) return error;

        const payload = await response.clone().json().catch(() => undefined);
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

// Helper to parse API errors
export async function parseAPIError(error: unknown): Promise<APIError> {
  if (error instanceof Response) {
    try {
      const body = await error.json();
      return new APIError(
        body.error || body.message || 'Request failed',
        error.status,
        body
      );
    } catch {
      return new APIError('Request failed', error.status);
    }
  }

  if (error instanceof Error) {
    return new APIError(error.message);
  }

  return new APIError('Unknown error occurred');
}
