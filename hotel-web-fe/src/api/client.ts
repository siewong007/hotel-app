// Base API client configuration
import ky from 'ky';
import { storage } from '../utils/storage';
import { getApiBaseUrl, resolveApiRequestUrl } from '../desktop/runtimeApi';

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
        const token = storage.getItem<string>('accessToken');
        if (token) {
          apiRequest.headers.set('Authorization', `Bearer ${token}`);
        } else {
          console.warn('API Request:', apiRequest.method, apiRequest.url, 'WITHOUT TOKEN');
        }

        return apiRequest;
      }
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status === 401) {
          console.error('401 Unauthorized response for:', request.method, request.url);

          // Check if this is a login or auth endpoint - don't auto-logout for these
          const url = request.url;
          const isAuthEndpoint = url.includes('/auth/login') ||
                                 url.includes('/auth/passkey') ||
                                 url.includes('/auth/register');

          // Only auto-logout for 401s on protected endpoints, not auth endpoints
          if (!isAuthEndpoint) {
            console.warn('Auto-logout triggered due to 401 on protected endpoint');
            // Token expired or invalid - clear only auth data, preserve language preferences
            storage.removeItem('accessToken');
            storage.removeItem('refreshToken');
            storage.removeItem('user');
            storage.removeItem('roles');
            storage.removeItem('permissions');

            // Use React Router navigation instead of hard redirect
            // Dispatch a custom event that AuthContext can listen to
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
        }
        return response;
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
