import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus a form-level error alert when it appears so keyboard and
 * screen-reader users land on the failure instead of hunting for it.
 * Attach the ref to an element with `tabIndex={-1}` (MUI `Alert` forwards
 * refs to its root div). Only use on submit-driven errors — focusing a
 * background-load failure would yank the user away from what they are doing.
 */
export function useAutoFocusError(error: unknown): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return ref;
}
