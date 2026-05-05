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

type TauriWindow = Window & {
  __TAURI__?: {
    core?: TauriCoreApi;
    event?: TauriEventApi;
  };
  __TAURI_INTERNALS__?: unknown;
};

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
  };
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
  return Boolean(tauriWindow.__TAURI__?.core);
}

export function shouldUseDesktopRuntime(): boolean {
  return isTauriBuildTarget() || isTauriRuntime();
}

export function getTauriCoreApi(): TauriCoreApi {
  const tauriWindow = window as TauriWindow;
  const core = tauriWindow.__TAURI__?.core;

  if (!core) {
    throw new Error('Tauri core API is not available');
  }

  return core;
}

export function getTauriEventApi(): TauriEventApi {
  const tauriWindow = window as TauriWindow;
  const event = tauriWindow.__TAURI__?.event;

  if (!event) {
    throw new Error('Tauri event API is not available');
  }

  return event;
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

export function apiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export function resolveApiRequestUrl(requestUrl: string): string {
  const baseUrl = getApiBaseUrl();

  if (!baseUrl || typeof window === 'undefined') {
    return requestUrl;
  }

  const currentUrl = new URL(requestUrl, window.location.origin);
  if (currentUrl.origin !== window.location.origin) {
    return requestUrl;
  }

  const base = new URL(`${baseUrl.replace(/\/+$/, '')}/`);
  const path = `${currentUrl.pathname.replace(/^\/+/, '')}${currentUrl.search}${currentUrl.hash}`;
  return new URL(path, base).toString();
}

export async function getDesktopStatus(): Promise<DesktopAppStatus> {
  const { invoke } = getTauriCoreApi();
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
