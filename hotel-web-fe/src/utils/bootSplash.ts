/**
 * Fade out and remove the static pre-React splash rendered by index.html /
 * guest.html (`#boot-splash`). Called right after the first React render —
 * the 160ms crossfade covers the handoff to the fullScreen LogoLoader, which
 * draws the identical monogram in the identical position.
 *
 * `transitionend` can be skipped entirely (reduced-motion disables the
 * transition, bfcache restores can skip events), so a timeout removes the
 * node unconditionally — `classList` already hid it at that point.
 */
export function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.add('boot-splash--exit');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  window.setTimeout(() => splash.remove(), 400);
}
