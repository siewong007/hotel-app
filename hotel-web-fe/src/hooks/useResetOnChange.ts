import { useState } from 'react';

/**
 * Run `onChange` during render on mount and whenever any of `deps` changes
 * (compared with Object.is, like effect deps). This is React's "adjusting
 * state when a prop changes" pattern: use it to reset or re-seed local state
 * from props (e.g. when a dialog opens) without a set-state-in-effect pass
 * that would first paint the stale values. `onChange` must only set state of
 * the calling component — no side effects.
 */
export function useResetOnChange(deps: readonly unknown[], onChange: () => void): void {
  const [prev, setPrev] = useState<readonly unknown[] | null>(null);
  if (
    prev === null
    || prev.length !== deps.length
    || deps.some((dep, index) => !Object.is(dep, prev[index]))
  ) {
    setPrev(deps);
    onChange();
  }
}
