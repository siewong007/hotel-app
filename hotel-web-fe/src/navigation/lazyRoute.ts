import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { isLeavingDocument } from '../utils/documentLocation';

const MODULE_RELOAD_KEY = 'hotelModuleReload';
const MODULE_RELOAD_GUARD_MS = 15_000;

function isModuleImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module/i.test(message);
}

function reloadOnceForModuleError(): boolean {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  const page = window.location.href;

  try {
    const previous = JSON.parse(window.sessionStorage.getItem(MODULE_RELOAD_KEY) ?? 'null') as {
      page?: string;
      at?: number;
    } | null;

    if (previous?.page === page && typeof previous.at === 'number' && now - previous.at < MODULE_RELOAD_GUARD_MS) {
      return false;
    }

    window.sessionStorage.setItem(MODULE_RELOAD_KEY, JSON.stringify({ page, at: now }));
  } catch {
    // Safari private-browsing/storage restrictions must not prevent recovery.
  }

  window.location.reload();
  return true;
}

export type PreloadableRouteComponent<T extends ComponentType<any> = ComponentType<any>> =
  LazyExoticComponent<T> & {
    preload: () => Promise<unknown>;
  };

export function lazyRoute<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>
): PreloadableRouteComponent<T> {
  const resilientLoader = async () => {
    try {
      return await loader();
    } catch (error) {
      // Safari aborts a page's module loads as soon as a navigation away
      // starts. That is not a stale chunk, and reloading would cancel the
      // navigation — after sign-out, landing the user on /login instead.
      if (isModuleImportError(error) && (isLeavingDocument() || reloadOnceForModuleError())) {
        // Keep Suspense active while the page is replaced (by the reload or by
        // the navigation already under way); surfacing the rejected promise
        // would cache the failure.
        return await new Promise<{ default: T }>(() => undefined);
      }
      throw error;
    }
  };

  const Component = lazy(resilientLoader) as PreloadableRouteComponent<T>;
  // Preloading is only an optimization. A transient stale chunk must not
  // produce an unhandled rejection or reload a page the user did not open.
  Component.preload = () => loader().catch(() => undefined);
  return Component;
}
