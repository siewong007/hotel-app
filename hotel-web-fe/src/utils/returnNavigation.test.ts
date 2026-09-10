import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasInAppHistory, returnToPreviousPage } from './returnNavigation';

const setReferrer = (value: string) => {
  Object.defineProperty(document, 'referrer', { configurable: true, value });
};

describe('returnNavigation', () => {
  beforeEach(() => {
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setReferrer('');
  });

  it('treats a same-origin referrer as in-app history', () => {
    setReferrer(`${window.location.origin}/portal/book`);

    expect(hasInAppHistory()).toBe(true);
  });

  it('treats a cross-origin referrer as no in-app history', () => {
    setReferrer('https://mail.google.com/');

    expect(hasInAppHistory()).toBe(false);
  });

  it('treats an unparseable referrer as no in-app history', () => {
    setReferrer('not a url');

    expect(hasInAppHistory()).toBe(false);
  });

  it('goes back through the browser when there is in-app history', () => {
    setReferrer(`${window.location.origin}/register`);
    const navigate = vi.fn();

    returnToPreviousPage(navigate);

    expect(window.history.back).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the default fallback when opened directly', () => {
    setReferrer('');
    const navigate = vi.fn();

    returnToPreviousPage(navigate);

    expect(window.history.back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('honours an explicit fallback', () => {
    setReferrer('');
    const navigate = vi.fn();

    returnToPreviousPage(navigate, '/portal');

    expect(navigate).toHaveBeenCalledWith('/portal');
  });
});
