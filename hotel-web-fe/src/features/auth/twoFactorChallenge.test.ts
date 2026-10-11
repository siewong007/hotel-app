import { describe, expect, it } from 'vitest';
import {
  isTwoFactorExpired,
  isTwoFactorInvalid,
  readTwoFactorAttemptsRemaining,
  readTwoFactorChallenge,
} from './twoFactorChallenge';

const apiError = (details: unknown, message = 'failed') =>
  Object.assign(new Error(message), { details });

describe('readTwoFactorChallenge', () => {
  it('reads the token and the methods the account can use', () => {
    expect(
      readTwoFactorChallenge(
        apiError({
          code: 'two_factor_required',
          mfa_token: 'tok',
          available_methods: ['totp', 'passkey', 'backup_code'],
        })
      )
    ).toEqual({ mfaToken: 'tok', methods: ['totp', 'passkey', 'backup_code'] });
  });

  it('reads a raw ky error body too', () => {
    const error = Object.assign(new Error('x'), {
      data: { code: 'two_factor_required', mfa_token: 't', available_methods: ['passkey'] },
    });
    expect(readTwoFactorChallenge(error)?.methods).toEqual(['passkey']);
  });

  it('ignores unknown methods and never returns nothing to offer', () => {
    expect(
      readTwoFactorChallenge(
        apiError({ code: 'two_factor_required', available_methods: ['sms', 'backup_code'] })
      )
    ).toEqual({ mfaToken: '', methods: ['totp', 'backup_code'] });
  });

  it('falls back to the historical message from an older backend', () => {
    expect(
      readTwoFactorChallenge(new Error('2FA required. Please provide a TOTP code or recovery code.'))
    ).toEqual({ mfaToken: '', methods: ['totp', 'backup_code'] });
  });

  it('is null for any other failure', () => {
    expect(readTwoFactorChallenge(apiError({ code: 'unauthorized' }, 'Invalid credentials'))).toBeNull();
    expect(readTwoFactorChallenge(null)).toBeNull();
  });
});

describe('wrong and expired codes', () => {
  it('reads the attempts left after a wrong code', () => {
    const error = apiError({ code: 'two_factor_invalid', attempts_remaining: 3 });
    expect(isTwoFactorInvalid(error)).toBe(true);
    expect(readTwoFactorAttemptsRemaining(error)).toBe(3);
  });

  it('has no attempt count for other failures', () => {
    expect(readTwoFactorAttemptsRemaining(apiError({ code: 'rate_limited' }))).toBeNull();
    expect(readTwoFactorAttemptsRemaining(apiError({ code: 'two_factor_invalid' }))).toBeNull();
  });

  it('recognises an expired second-factor token', () => {
    expect(isTwoFactorExpired(apiError({ code: 'two_factor_expired' }))).toBe(true);
    expect(isTwoFactorExpired(apiError({ code: 'two_factor_invalid' }))).toBe(false);
  });
});
