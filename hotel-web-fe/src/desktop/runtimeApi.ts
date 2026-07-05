const RUNTIME_API_BASE_URL_KEY = 'hotelRuntimeApiBaseUrl';
const TAURI_MODES = new Set(['tauri', 'desktop']);
let runtimeApiBaseUrl: string | null = null;

type TauriCoreApi = {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

type TauriEventApi = {
  listen: <T = unknown>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
};

// ---------------------------------------------------------------------------
// Tauri IPC bridge types – always injected into a Tauri 2 webview regardless
// of the `withGlobalTauri` setting.
// ---------------------------------------------------------------------------

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  transformCallback: (callback: (...args: unknown[]) => void, once?: boolean) => number;
}

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
};

export interface DesktopLatestBackup {
  path: string;
  filename: string;
  /** RFC3339 UTC timestamp; render in local time via `new Date(...)`. */
  timestamp: string;
}

export interface DesktopAppStatus {
  backend_running: boolean;
  backend_starting: boolean;
  backend_url: string;
  data_directory: string;
  version: string;
  postgres?: {
    running?: boolean;
    initialized?: boolean;
    port?: number;
    database?: string;
    data_directory?: string;
    version_compatible?: boolean;
    needs_upgrade?: boolean;
    data_dir_major?: string | null;
    bundled_major?: string | null;
    latest_backup?: DesktopLatestBackup | null;
  };
}

export interface DesktopUpgradeSummary {
  restored_backup: string;
  retired_data_dir: string;
  from_version: string;
  to_version: string;
}

export async function upgradeDatabaseFromBackup(): Promise<DesktopUpgradeSummary> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopUpgradeSummary>('upgrade_database_from_backup');
}

export function isTauriBuildTarget(): boolean {
  const target = import.meta.env.VITE_APP_TARGET || import.meta.env.MODE;
  return TAURI_MODES.has(String(target).toLowerCase());
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriWindow = window as TauriWindow;
  return Boolean(tauriWindow.__TAURI_INTERNALS__);
}

export function shouldUseDesktopRuntime(): boolean {
  return isTauriBuildTarget() || isTauriRuntime();
}

// ---------------------------------------------------------------------------
// Internal helper – returns the Tauri IPC bridge or throws.
// ---------------------------------------------------------------------------

function getTauriInternals(): TauriInternals {
  const w = window as TauriWindow;
  if (!w.__TAURI_INTERNALS__) {
    throw new Error('Tauri internals are not available');
  }
  return w.__TAURI_INTERNALS__;
}

// ---------------------------------------------------------------------------
// Public API wrappers – same signatures as before, but backed by
// __TAURI_INTERNALS__ instead of dynamic imports of @tauri-apps/api.
// ---------------------------------------------------------------------------

export async function getTauriCoreApi(): Promise<TauriCoreApi> {
  if (!shouldUseDesktopRuntime()) {
    throw new Error('Tauri core API is not available');
  }

  const internals = getTauriInternals();
  return {
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) =>
      internals.invoke<T>(cmd, args),
  };
}

export async function getTauriEventApi(): Promise<TauriEventApi> {
  if (!shouldUseDesktopRuntime()) {
    throw new Error('Tauri event API is not available');
  }

  const internals = getTauriInternals();

  return {
    listen: async <T = unknown>(
      event: string,
      handler: (event: { payload: T }) => void,
    ): Promise<() => void> => {
      const callbackId = internals.transformCallback(handler as (...args: unknown[]) => void);

      const eventId = await internals.invoke<number>('plugin:event|listen', {
        event,
        target: { kind: 'Any' },
        handler: callbackId,
      });

      return async () => {
        await internals.invoke('plugin:event|unlisten', { event, eventId });
      };
    },
  };
}

export function setRuntimeApiBaseUrl(url: string): void {
  const normalizedUrl = url.replace(/\/+$/, '');
  runtimeApiBaseUrl = normalizedUrl;

  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(RUNTIME_API_BASE_URL_KEY, normalizedUrl);
  }
}

export function getApiBaseUrl(): string {
  if (runtimeApiBaseUrl) {
    return runtimeApiBaseUrl;
  }

  if (typeof window !== 'undefined') {
    const runtimeUrl = window.sessionStorage.getItem(RUNTIME_API_BASE_URL_KEY);
    if (runtimeUrl) {
      runtimeApiBaseUrl = runtimeUrl;
      return runtimeUrl;
    }
  }

  if (isTauriBuildTarget()) {
    return '';
  }

  return import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'http://localhost:3030' : '');
}

// Domain API endpoints are served under `/api` on the backend so that frontend
// navigation paths (e.g. `/bookings/123`) don't collide with the API. These
// root-level prefixes are NOT namespaced (infra healthchecks + static assets),
// so they must be left untouched.
const ROOT_API_PREFIXES = ['api', 'health', 'ws', 'uploads'];

function withApiPrefix(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, '');
  const firstSegment = trimmed.split('/')[0];
  if (ROOT_API_PREFIXES.includes(firstSegment)) {
    return `/${trimmed}`;
  }
  return `/api/${trimmed}`;
}

export function apiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = withApiPrefix(path);
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export function resolveApiRequestUrl(requestUrl: string): string {
  if (typeof window === 'undefined') {
    return requestUrl;
  }

  const currentUrl = new URL(requestUrl, window.location.origin);
  // Only rewrite same-origin requests; absolute URLs to other hosts pass through.
  if (currentUrl.origin !== window.location.origin) {
    return requestUrl;
  }

  const prefixedPath = withApiPrefix(currentUrl.pathname);
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) {
    // Web dev / same-origin prod: keep the request on the current origin so the
    // dev proxy (or same-origin deploy) forwards `/api/...` to the backend.
    return `${currentUrl.origin}${prefixedPath}${currentUrl.search}${currentUrl.hash}`;
  }

  const base = new URL(`${baseUrl.replace(/\/+$/, '')}/`);
  const path = `${prefixedPath.replace(/^\/+/, '')}${currentUrl.search}${currentUrl.hash}`;
  return new URL(path, base).toString();
}

export async function getDesktopStatus(): Promise<DesktopAppStatus> {
  const { invoke } = await getTauriCoreApi();
  const status = await invoke<DesktopAppStatus>('get_status');

  if (status.backend_url) {
    setRuntimeApiBaseUrl(status.backend_url);
  }

  return status;
}

export async function initializeDesktopBackendUrl(): Promise<void> {
  if (!shouldUseDesktopRuntime()) {
    return;
  }

  try {
    await getDesktopStatus();
  } catch (error) {
    console.warn('Desktop status is not available during bootstrap yet:', error);
  }
}
