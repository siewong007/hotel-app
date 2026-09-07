import { afterEach, describe, expect, it } from 'vitest';
import {
  captureBookingAccessToken,
  clearBookingAccessToken,
  getBookingAccessToken,
  setBookingAccessToken,
} from './bookingAccessTokenStore';

describe('bookingAccessTokenStore', () => {
  afterEach(() => {
    clearBookingAccessToken();
  });

  it('round-trips a token through sessionStorage', () => {
    setBookingAccessToken('tok_abc');
    expect(getBookingAccessToken()).toBe('tok_abc');
  });

  it('captures a legacy query token and remembers it without the query later', () => {
    const captured = captureBookingAccessToken(new URLSearchParams('token=legacy-tok'));
    expect(captured).toBe('legacy-tok');
    expect(getBookingAccessToken()).toBe('legacy-tok');
    expect(captureBookingAccessToken(new URLSearchParams())).toBe('legacy-tok');
  });
});
