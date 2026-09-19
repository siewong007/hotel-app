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
  /** Uploads tarball filename paired with the dump, when present. */
  uploads_filename: string | null;
  /** Combined size of the dump plus its uploads tarball, in bytes. */
  size_bytes: number;
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
  restored_uploads?: string | null;
  retired_data_dir: string;
  from_version: string;
  to_version: string;
}

export async function upgradeDatabaseFromBackup(): Promise<DesktopUpgradeSummary> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopUpgradeSummary>('upgrade_database_from_backup');
}

/** One managed backup pair as returned by the `list_backups` command —
 * mirrors `postgres::BackupInfo` (filenames only; paths stay internal). */
export interface DesktopBackupInfo {
  filename: string;
  /** RFC3339 UTC timestamp; render in local time via `new Date(...)`. */
  timestamp: string;
  /** Combined size of the dump plus its uploads tarball, in bytes. */
  size_bytes: number;
  /** Uploads tarball filename restored alongside the dump, when paired. */
  uploads_filename: string | null;
}

/** Mirrors `postgres::RestoreSummary` — returned by `restore_database`. */
export interface DesktopRestoreSummary {
  restored_backup: string;
  restored_uploads: string | null;
  /** Pre-restore safety dump filename — appears in the backups list. */
  safety_backup: string;
}

export async function listBackups(): Promise<DesktopBackupInfo[]> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopBackupInfo[]>('list_backups');
}

/** Run a managed backup into the default backups dir; resolves to its path. */
export async function backupNow(): Promise<string> {
  const { invoke } = await getTauriCoreApi();
  return invoke<string>('backup_database', { destination: null });
}

/**
 * Restore a managed backup into the live database. The command stops the
 * backend sidecar first, so the app drops into the `DesktopServiceGate`
 * restart screen while this is in flight — the promise usually settles after
 * the calling component has already unmounted.
 */
export async function restoreDatabase(filename: string): Promise<DesktopRestoreSummary> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopRestoreSummary>('restore_database', { filename });
}

export async function openBackupsFolder(): Promise<void> {
  const { invoke } = await getTauriCoreApi();
  return invoke<void>('open_backups_folder');
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
// Updater commands — armed only when the desktop runtime is present AND the
// bundle was built with VITE_DESKTOP_UPDATER_ENABLED=true (the CI bundle
// steps set it; plain binary builds and web builds leave it off).
// ---------------------------------------------------------------------------

export interface DesktopUpdateInfo {
  available: boolean;
  version: string;
  current_version: string;
  notes: string | null;
}

export function isDesktopUpdaterEnabled(): boolean {
  return shouldUseDesktopRuntime() && import.meta.env.VITE_DESKTOP_UPDATER_ENABLED === 'true';
}

export async function checkForUpdates(): Promise<DesktopUpdateInfo> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopUpdateInfo>('check_for_updates');
}

/**
 * Download + install the pending update. On Windows the promise never
 * resolves: `install_inner` exits the process and the NSIS installer
 * relaunches the app, so a dropped promise is success-in-progress, not a
 * failure. Callers must leave the "installing" UI up rather than error out.
 */
export async function installUpdate(): Promise<{ installed: boolean; version: string }> {
  const { invoke } = await getTauriCoreApi();
  return invoke('install_update');
}

/**
 * Relaunch the app via `request_restart`. Returns immediately and the app
 * exits — like `installUpdate`, a dropped promise is expected, not an error.
 */
export async function restartApp(): Promise<void> {
  const { invoke } = await getTauriCoreApi();
  return invoke('restart_app');
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
  const normalizedUrl = url.trim().replace(/\/+$/, '');
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

  // Web deployments default to same-origin requests at runtime. The reverse
  // proxy can therefore serve the same build from any domain without baking a
  // hostname into the bundle, while an explicit override remains available for
  // deployments that intentionally host the API elsewhere.
  return (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
}

// Domain API endpoints are served under `/api` on the backend so that frontend
// navigation paths (e.g. `/bookings/123`) don't collide with the API. These
// root-level prefixes are NOT namespaced (infra healthchecks + static assets),
// so they must be left untouched. `hotel.` covers the Connect/gRPC-Web service
// paths (e.g. /hotel.rooms.v1.RoomService/ListRooms) — an entry ending in '.'
// matches by prefix since the whole service name is the path's first segment.
// KEEP IN SYNC: vite.config.ts PROXY_PREFIXES — parity enforced by
// hotel-desktop/scripts/origin-parity.test.mjs.
const ROOT_API_PREFIXES = ['api', 'health', 'ws', 'uploads', 'hotel.'];

function withApiPrefix(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, '');
  const firstSegment = trimmed.split('/')[0];
  const isRootLevel = ROOT_API_PREFIXES.some((prefix) =>
    prefix.endsWith('.') ? firstSegment.startsWith(prefix) : firstSegment === prefix,
  );
  if (isRootLevel) {
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
