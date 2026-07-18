import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiUrl, getApiBaseUrl, resolveApiRequestUrl } from './runtimeApi';

describe('runtime API base resolution', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
  });

  it('uses the browser origin dynamically for a production web build without an override', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('PROD', true);
    window.history.replaceState({}, '', '/admin');

    expect(getApiBaseUrl()).toBe('');
    expect(apiUrl('auth/refresh')).toBe('/api/auth/refresh');

    const resolvedUrl = new URL(resolveApiRequestUrl('/auth/refresh'));
    expect(resolvedUrl.origin).toBe(window.location.origin);
    expect(resolvedUrl.pathname).toBe('/api/auth/refresh');
  });

  it('keeps a normalized explicit API override', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_API_URL', ' https://api.example.com/// ');

    expect(getApiBaseUrl()).toBe('https://api.example.com');
    expect(apiUrl('health')).toBe('https://api.example.com/health');
  });
});
