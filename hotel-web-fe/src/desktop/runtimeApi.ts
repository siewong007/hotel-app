const RUNTIME_API_BASE_URL_KEY = 'hotelRuntimeApiBaseUrl';

type TauriWindow = Window & {
  __TAURI__?: unknown;
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

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriWindow = window as TauriWindow;
  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_INTERNALS__);
}

export function setRuntimeApiBaseUrl(url: string): void {
  const normalizedUrl = url.replace(/\/+$/, '');
  window.sessionStorage.setItem(RUNTIME_API_BASE_URL_KEY, normalizedUrl);
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const runtimeUrl = window.sessionStorage.getItem(RUNTIME_API_BASE_URL_KEY);
    if (runtimeUrl) {
      return runtimeUrl;
    }
  }

  return import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'http://localhost:3030' : '');
}

export function apiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export async function getDesktopStatus(): Promise<DesktopAppStatus> {
  const { invoke } = await import('@tauri-apps/api/core');
  const status = await invoke<DesktopAppStatus>('get_status');

  if (status.backend_url) {
    setRuntimeApiBaseUrl(status.backend_url);
  }

  return status;
}

export async function initializeDesktopBackendUrl(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await getDesktopStatus();
  } catch (error) {
    console.warn('Desktop status is not available during bootstrap yet:', error);
  }
}
