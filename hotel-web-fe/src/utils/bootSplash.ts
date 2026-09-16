/**
 * Fade out and remove the static pre-React splash rendered by index.html /
 * guest.html (`#boot-splash`). Called right after the first React render —
 * the 160ms crossfade hands off to the fullScreen LogoLoader, which draws
 * the identical monogram in the identical position already settled
 * (`skipEntrance`), so the handoff is a plain opacity crossfade rather than
 * a visible re-draw.
 *
 * `transitionend` can be skipped entirely (reduced-motion disables the
 * transition, bfcache restores can skip events), so a timeout removes the
 * node unconditionally — `classList` already hid it at that point.
 */

/**
 * True when the bundle evaluated with `#boot-splash` still in the DOM — i.e.
 * this session started behind the static splash. Captured at module init:
 * module scripts run after the HTML is parsed but before React renders, and
 * `dismissBootSplash` removes the node before later readers could check.
 */
export const bootSplashPresent =
  typeof document !== 'undefined' && document.getElementById('boot-splash') !== null;
export function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.add('boot-splash--exit');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  window.setTimeout(() => splash.remove(), 400);
}
