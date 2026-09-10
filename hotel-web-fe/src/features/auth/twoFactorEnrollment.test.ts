import { describe, expect, it } from 'vitest';
import { APIError } from '../../api/client';
import { buildKyHttpError } from '../../api/testSupport/httpError';
import {
  isTwoFactorEnrollmentRequired,
  parseEnrollmentDeadline,
  TWO_FACTOR_ENROLLMENT_REQUIRED_CODE,
} from './twoFactorEnrollment';

describe('isTwoFactorEnrollmentRequired', () => {
  it('detects the code on an APIError, which is how AuthContext.login rethrows it', () => {
    const error = new APIError('nope', 403, { code: TWO_FACTOR_ENROLLMENT_REQUIRED_CODE });
    expect(isTwoFactorEnrollmentRequired(error)).toBe(true);
  });

  it('detects the code on a raw ky HTTPError body', () => {
    const error = buildKyHttpError(403, { code: TWO_FACTOR_ENROLLMENT_REQUIRED_CODE });
    expect(isTwoFactorEnrollmentRequired(error)).toBe(true);
  });

  it('ignores a different structured code', () => {
    const error = new APIError('nope', 409, { code: 'guest_name_taken' });
    expect(isTwoFactorEnrollmentRequired(error)).toBe(false);
  });

  // The whole point of matching a code: the prose is translated, so an English
  // message must never be what drives the branch.
  it('does not match on message text alone', () => {
    const error = new APIError('Your role requires two-factor authentication.', 403);
    expect(isTwoFactorEnrollmentRequired(error)).toBe(false);
  });

  it('tolerates non-error values without throwing', () => {
    expect(isTwoFactorEnrollmentRequired(null)).toBe(false);
    expect(isTwoFactorEnrollmentRequired(undefined)).toBe(false);
    expect(isTwoFactorEnrollmentRequired('two_factor_enrollment_required')).toBe(false);
    expect(isTwoFactorEnrollmentRequired(new Error('boom'))).toBe(false);
  });
});

describe('parseEnrollmentDeadline', () => {
  it('parses an RFC 3339 timestamp of the shape the backend serializes', () => {
    const parsed = parseEnrollmentDeadline('2026-10-01T09:30:00Z');
    expect(parsed?.toISOString()).toBe('2026-10-01T09:30:00.000Z');
  });

  it('returns null for missing or unparseable values rather than throwing', () => {
    expect(parseEnrollmentDeadline(null)).toBeNull();
    expect(parseEnrollmentDeadline(undefined)).toBeNull();
    expect(parseEnrollmentDeadline('')).toBeNull();
    expect(parseEnrollmentDeadline('not a date')).toBeNull();
  });
});
