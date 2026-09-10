/**
 * Where a "Back" control goes on a page that can be reached from anywhere.
 *
 * The legal documents, the sign-in page and the registration page are all
 * entered from many directions: an in-app link, a consent checkbox, a bookmark,
 * an email link, or a session-expiry redirect that replaced the history entry.
 * `history.back()` on its own is wrong for the last three — there is nothing to
 * go back to, and the control either does nothing or throws the reader out of
 * the app entirely.
 *
 * `document.referrer` is the signal that distinguishes the two cases. It is the
 * document that linked here, so a same-origin value means the reader arrived
 * from inside the app and the browser's own history is the most faithful
 * destination. Anything else — empty, cross-origin, or unparseable — means
 * there is no in-app history worth returning to, and an explicit fallback path
 * is the honest answer.
 */
export function hasInAppHistory(): boolean {
  try {
    const referrer = document.referrer;
    return Boolean(referrer) && new URL(referrer).origin === window.location.origin;
  } catch {
    // Malformed referrer — treat as no in-app history.
    return false;
  }
}

/**
 * Returns the reader to where they came from, or to `fallback` when they
 * arrived with no in-app history.
 */
export function returnToPreviousPage(
  navigate: (to: string) => void,
  fallback = '/'
): void {
  if (hasInAppHistory()) {
    window.history.back();
    return;
  }
  navigate(fallback);
}
