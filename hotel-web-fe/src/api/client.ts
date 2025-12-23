// Base API client configuration
import ky from 'ky';
import { storage } from '../utils/storage';

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

// In development, use empty string to leverage the proxy in package.json
// In production, use the full API URL
export const API_BASE_URL = process.env.REACT_APP_API_URL || (process.env.NODE_ENV === 'production' ? 'http://localhost:3030' : '');

// Create ky instance with hooks for auth and error handling
export const api = ky.create({
  prefixUrl: API_BASE_URL,
  timeout: 30000, // 30 second timeout
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504]
  },
  hooks: {
    beforeRequest: [
      request => {
        const token = storage.getItem<string>('accessToken');
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        } else {
          console.warn('API Request:', request.method, request.url, 'WITHOUT TOKEN');
        }
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
