/**
 * Thin wrappers around the document Fullscreen API, with the webkit prefixes
 * Safari still needs. Used by the staff-shell fullscreen toggle so the button
 * can hide itself when the API is missing (iOS Safari, the Tauri desktop
 * webview) rather than throwing on click.
 */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** True when the page can ask the browser for document fullscreen. */
export function isDocumentFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as FullscreenElement;
  return typeof el.requestFullscreen === 'function'
    || typeof el.webkitRequestFullscreen === 'function';
}

/** The element currently in fullscreen, if any (standard or webkit). */
export function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export async function requestDocumentFullscreen(): Promise<void> {
  const el = document.documentElement as FullscreenElement;
  if (typeof el.requestFullscreen === 'function') {
    await el.requestFullscreen();
    return;
  }
  if (typeof el.webkitRequestFullscreen === 'function') {
    await el.webkitRequestFullscreen();
  }
}

export async function exitDocumentFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen();
    return;
  }
  if (typeof doc.webkitExitFullscreen === 'function') {
    await doc.webkitExitFullscreen();
  }
}

/** Subscribe to both the standard and webkit fullscreenchange events. */
export function subscribeFullscreenChange(handler: () => void): () => void {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}
