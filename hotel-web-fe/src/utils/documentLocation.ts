let leavingDocument = false;

/**
 * Hand the top-level document to another URL, replacing this history entry so
 * Back does not return to the page being left. A module of its own so tests can
 * observe it: jsdom's `location.replace` is unforgeable and cannot be spied on.
 */
export function replaceDocumentLocation(href: string): void {
  // Flag first: Safari aborts this page's in-flight module loads the moment the
  // navigation starts, and lazyRoute must not answer that with a reload.
  leavingDocument = true;
  window.location.replace(href);
}

/** True once replaceDocumentLocation has sent this page elsewhere. */
export function isLeavingDocument(): boolean {
  return leavingDocument;
}
