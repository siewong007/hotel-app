import { describe, it, expect } from 'vitest';
import { buildKyHttpError } from '../../../api/testSupport/httpError';
import { guestErrorMessage } from './feedback';

describe('guestErrorMessage', () => {
  it('returns the server-provided message for HTTP errors', () => {
    const err = buildKyHttpError(400, { error: 'This voucher cannot be applied to the selected stay' });
    expect(guestErrorMessage(err, 'Something went wrong'))
      .toBe('This voucher cannot be applied to the selected stay');
  });

  it('collapses transport failures to the fallback', () => {
    expect(guestErrorMessage(new TypeError('Failed to fetch'), 'We could not reach the server. Please try again.'))
      .toBe('We could not reach the server. Please try again.');
  });

  it('returns the fallback for non-Error throws', () => {
    expect(guestErrorMessage('boom', 'Please try again.')).toBe('Please try again.');
  });
});
