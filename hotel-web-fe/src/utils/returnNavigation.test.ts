import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasInAppHistory, returnToPreviousPage } from './returnNavigation';

const setHistoryIndex = (index: number | null) => {
  window.history.replaceState(index === null ? null : { __TSR_index: index }, '');
};

describe('returnNavigation', () => {
  beforeEach(() => {
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    setHistoryIndex(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setHistoryIndex(null);
  });

  it('treats a stamped in-app entry as history to go back to', () => {
    setHistoryIndex(1);

    expect(hasInAppHistory()).toBe(true);
  });

  it('treats a fresh document load as no in-app history', () => {
    // The router stamps 0 on the entry a document navigation lands on, however
    // the previous page referred to us — a `location.replace` bounce off a
    // protected route is exactly this shape, and back() into it dead-ends.
    setHistoryIndex(0);

    expect(hasInAppHistory()).toBe(false);
  });

  it('treats an unstamped entry as no in-app history', () => {
    setHistoryIndex(null);

    expect(hasInAppHistory()).toBe(false);
  });

  it('goes back through the browser when there is in-app history', () => {
    setHistoryIndex(2);
    const navigate = vi.fn();

    returnToPreviousPage(navigate);

    expect(window.history.back).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the default fallback when opened directly', () => {
    setHistoryIndex(0);
    const navigate = vi.fn();

    returnToPreviousPage(navigate);

    expect(window.history.back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('honours an explicit fallback', () => {
    setHistoryIndex(0);
    const navigate = vi.fn();

    returnToPreviousPage(navigate, '/portal');

    expect(navigate).toHaveBeenCalledWith('/portal');
  });
});
