import { useCallback, useEffect, useState } from 'react';
import {
  exitDocumentFullscreen,
  getFullscreenElement,
  isDocumentFullscreenSupported,
  requestDocumentFullscreen,
  subscribeFullscreenChange,
} from '../utils/fullscreen';

/**
 * Document-level fullscreen state for the staff shell. Keeps the toggle in
 * sync when the user presses Esc (or the browser's own exit control) by
 * listening to fullscreenchange. Returns `supported: false` when the API is
 * absent so the button can hide itself.
 */
export function useDocumentFullscreen() {
  const [supported] = useState(() => isDocumentFullscreenSupported());
  const [active, setActive] = useState(() => Boolean(getFullscreenElement()));

  useEffect(() => {
    if (!supported) return undefined;
    return subscribeFullscreenChange(() => {
      setActive(Boolean(getFullscreenElement()));
    });
  }, [supported]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (getFullscreenElement()) {
      await exitDocumentFullscreen();
    } else {
      await requestDocumentFullscreen();
    }
  }, [supported]);

  return { supported, active, toggle };
}
