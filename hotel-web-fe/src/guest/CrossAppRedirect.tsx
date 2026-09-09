import { Navigate } from '@tanstack/react-router';
import { hrefFromAppPath, shouldUseDocumentNavigation } from './guestDocumentPaths';

/**
 * In-app Navigate when both URLs share a Vite HTML document; a full load when
 * they do not (guest.html ↔ index.html). The host is always the current origin.
 */
export function CrossAppRedirect({
  to,
  replace = true,
}: {
  to: string;
  replace?: boolean;
}) {
  const targetPath = new URL(to, 'https://guest.invalid').pathname;
  const fromPath = typeof window === 'undefined' ? '/' : window.location.pathname;
  if (shouldUseDocumentNavigation(targetPath, fromPath)) {
    const href = hrefFromAppPath(to);
    if (replace) {
      window.location.replace(href);
    } else {
      window.location.assign(href);
    }
    return null;
  }
  return <Navigate to={to as never} replace={replace} />;
}
