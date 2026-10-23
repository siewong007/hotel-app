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

/**
 * Guest variant: keep the static splash up until the first real page has
 * painted, instead of crossfading into a second (theme-coloured) loader. The
 * splash is released once #root has content, no LogoLoader mark is on screen
 * and nothing asks to hold it (`[data-boot-hold]`, e.g. the booking page
 * while a landing-page prefill search runs). `maxMs` is a hard cap so a stuck
 * request can never trap the guest behind the splash.
 */
export function dismissBootSplashWhenSettled(root: HTMLElement, maxMs = 8000): void {
  if (!document.getElementById('boot-splash')) return;
  let done = false;
  let frame = 0;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(cap);
    if (frame) window.cancelAnimationFrame(frame);
    dismissBootSplash();
  };
  const settled = () =>
    root.childElementCount > 0
    && !root.querySelector('.hotel-loader__mark, [data-boot-hold]');
  const check = () => {
    if (frame) window.cancelAnimationFrame(frame);
    // Re-check on the next frame so a fallback swapped for content in the
    // same tick doesn't release early.
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (settled()) finish();
    });
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-boot-hold', 'class'] });
  const cap = window.setTimeout(finish, maxMs);
  check();
}
