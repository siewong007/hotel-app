import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_NOTIFICATION_EVENT, type ApiNotificationDetail } from '../../../utils/apiNotifications';
import {
  isCompleteTwoFactorCode,
  notifyRecoveryCodeUsed,
  sanitizeTwoFactorCode,
} from './twoFactorCode';

describe('sanitizeTwoFactorCode', () => {
  it('keeps a 6-digit authenticator code intact', () => {
    expect(sanitizeTwoFactorCode('123456', 'totp')).toBe('123456');
  });

  it('drops everything a TOTP code cannot contain', () => {
    // The hex letters and dashes belong to the recovery shape; once the user
    // has said "authenticator app", they are typos.
    expect(sanitizeTwoFactorCode('1a2-3 4b5!6', 'totp')).toBe('123456');
  });

  it('caps an authenticator code at six digits', () => {
    expect(sanitizeTwoFactorCode('1234567890', 'totp')).toBe('123456');
  });

  it('keeps hex and dashes, and uppercases a recovery code', () => {
    expect(sanitizeTwoFactorCode('a1b2c-3d4e5-f6a7b-8c9d0', 'recovery')).toBe(
      'A1B2C-3D4E5-F6A7B-8C9D0'
    );
  });

  it('drops whitespace and characters a recovery code cannot contain', () => {
    // g and z are outside hex; the spaces come from pasting a printed code.
    expect(sanitizeTwoFactorCode(' 12 34g!z56 ', 'recovery')).toBe('123456');
  });

  it('caps a recovery code at its full printed length', () => {
    const pasted = 'A1B2C-3D4E5-F6A7B-8C9D0-EXTRA-TAIL';
    expect(sanitizeTwoFactorCode(pasted, 'recovery')).toHaveLength(23);
  });
});

describe('isCompleteTwoFactorCode', () => {
  it('accepts a 6-character authenticator code', () => {
    expect(isCompleteTwoFactorCode('123456', 'totp')).toBe(true);
  });

  it('accepts a 23-character recovery code', () => {
    expect(isCompleteTwoFactorCode('A1B2C-3D4E5-F6A7B-8C9D0', 'recovery')).toBe(true);
  });

  it('rejects partial input for either method', () => {
    expect(isCompleteTwoFactorCode('', 'totp')).toBe(false);
    expect(isCompleteTwoFactorCode('12345', 'totp')).toBe(false);
    expect(isCompleteTwoFactorCode('A1B2C-3D4E5-F6A7B-8C9D', 'recovery')).toBe(false);
  });

  it('holds each method to its own length', () => {
    // The old single-field form accepted either length in one box; now a
    // recovery code typed on the authenticator step is not "complete".
    expect(isCompleteTwoFactorCode('A1B2C-3D4E5-F6A7B-8C9D0', 'totp')).toBe(false);
    expect(isCompleteTwoFactorCode('123456', 'recovery')).toBe(false);
  });
});

describe('notifyRecoveryCodeUsed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const captureNotification = (remaining: number): ApiNotificationDetail | null => {
    vi.useFakeTimers();
    let captured: ApiNotificationDetail | null = null;
    const listener = (event: Event) => {
      captured = (event as CustomEvent<ApiNotificationDetail>).detail;
    };
    window.addEventListener(API_NOTIFICATION_EVENT, listener);
    try {
      notifyRecoveryCodeUsed(remaining);
      vi.runAllTimers();
    } finally {
      window.removeEventListener(API_NOTIFICATION_EVENT, listener);
    }
    return captured;
  };

  it('warns how many codes remain and where to regenerate them', () => {
    const detail = captureNotification(2);

    expect(detail?.severity).toBe('warning');
    expect(detail?.message).toContain('2 recovery codes remaining');
    expect(detail?.message).toContain('Profile → Security');
  });

  it('uses the singular form for the last remaining code', () => {
    expect(captureNotification(1)?.message).toContain('1 recovery code remaining');
  });

  it('still warns when no codes remain', () => {
    expect(captureNotification(0)?.message).toContain('0 recovery codes remaining');
  });
});
