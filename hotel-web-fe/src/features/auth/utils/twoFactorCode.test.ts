import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_NOTIFICATION_EVENT, type ApiNotificationDetail } from '../../../utils/apiNotifications';
import {
  BACKUP_CODE_LENGTH,
  formatBackupCode,
  isCompleteBackupCode,
  isCompleteTotpCode,
  notifyBackupCodeUsed,
  sanitizeTotpCode,
} from './twoFactorCode';

describe('sanitizeTotpCode', () => {
  it('keeps a 6-digit authenticator code intact', () => {
    expect(sanitizeTotpCode('123456')).toBe('123456');
  });

  it('drops everything an authenticator code cannot contain', () => {
    // A pasted "123 456" or "123-456" is still the code.
    expect(sanitizeTotpCode('1a2-3 4b5!6')).toBe('123456');
  });

  it('caps an authenticator code at six digits', () => {
    expect(sanitizeTotpCode('1234567890')).toBe('123456');
  });
});

describe('formatBackupCode', () => {
  it('keeps a printed code as printed, uppercased', () => {
    expect(formatBackupCode('a1b2c-3d4e5-f6a7b-8c9d0')).toBe('A1B2C-3D4E5-F6A7B-8C9D0');
  });

  it('inserts the group dashes for a code typed or pasted without them', () => {
    expect(formatBackupCode('a1b2c3d4e5f6a7b8c9d0')).toBe('A1B2C-3D4E5-F6A7B-8C9D0');
    expect(formatBackupCode('A1B2C 3D4E5 F6A7B 8C9D0')).toBe('A1B2C-3D4E5-F6A7B-8C9D0');
  });

  it('formats a partial code as it is typed', () => {
    expect(formatBackupCode('a1b2c3')).toBe('A1B2C-3');
    expect(formatBackupCode('A1B2C-')).toBe('A1B2C');
  });

  it('drops characters a backup code cannot contain and caps the length', () => {
    expect(formatBackupCode(' 12 34g!z56 ')).toBe('12345-6');
    expect(formatBackupCode('A1B2C-3D4E5-F6A7B-8C9D0-EXTRA-TAIL')).toHaveLength(
      BACKUP_CODE_LENGTH
    );
  });
});

describe('code completeness', () => {
  it('accepts exactly six digits for an authenticator code', () => {
    expect(isCompleteTotpCode('123456')).toBe(true);
    expect(isCompleteTotpCode('12345')).toBe(false);
    expect(isCompleteTotpCode('12345a')).toBe(false);
  });

  it('accepts only a full backup code', () => {
    expect(isCompleteBackupCode('A1B2C-3D4E5-F6A7B-8C9D0')).toBe(true);
    expect(isCompleteBackupCode('A1B2C-3D4E5-F6A7B-8C9D')).toBe(false);
    expect(isCompleteBackupCode('123456')).toBe(false);
  });
});

describe('notifyBackupCodeUsed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const captureNotification = (
    remaining: number,
    isGuest = false
  ): ApiNotificationDetail | null => {
    vi.useFakeTimers();
    let captured: ApiNotificationDetail | null = null;
    const listener = (event: Event) => {
      captured = (event as CustomEvent<ApiNotificationDetail>).detail;
    };
    window.addEventListener(API_NOTIFICATION_EVENT, listener);
    try {
      notifyBackupCodeUsed(remaining, isGuest);
      vi.runAllTimers();
    } finally {
      window.removeEventListener(API_NOTIFICATION_EVENT, listener);
    }
    return captured;
  };

  it('tells staff how many codes remain and where to make new ones', () => {
    const detail = captureNotification(2);

    expect(detail?.severity).toBe('warning');
    expect(detail?.message).toContain('2 backup codes remaining');
    expect(detail?.message).toContain('Profile → Security');
  });

  it('points a guest at their own account page, not the staff profile', () => {
    const message = captureNotification(2, true)?.message ?? '';
    expect(message).toContain('2 backup codes remaining');
    expect(message).toContain('Sign-in & security');
    expect(message).not.toContain('Profile → Security');
  });

  it('uses the singular form for the last remaining code', () => {
    expect(captureNotification(1)?.message).toContain('1 backup code remaining');
  });

  it('still warns when no codes remain', () => {
    expect(captureNotification(0)?.message).toContain('0 backup codes remaining');
  });
});
