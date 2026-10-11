import { useEffect, useState } from 'react';

/**
 * How much of the layout viewport the on-screen keyboard currently covers, in
 * px (0 when there is no keyboard, or no `visualViewport` API).
 *
 * Mobile browsers shrink only the *visual* viewport when the keyboard opens,
 * so a `position: sticky; bottom: 0` action bar ends up hidden behind it. Using
 * this as the bar's `bottom` keeps the primary action above the keyboard. One
 * passive listener, coalesced to a frame; it re-renders only when the inset
 * actually changes.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!viewport) {
      return undefined;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
        const next = covered > 0 ? covered : 0;
        setInset((previous) => (previous === next ? previous : next));
      });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
