import { describe, expect, it } from 'vitest';
import { errorMessage } from './errorMessage';

describe('errorMessage', () => {
  it('uses the message of Error instances', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('falls back when an Error has an empty message', () => {
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback');
  });

  it('accepts plain strings', () => {
    expect(errorMessage('plain failure', 'fallback')).toBe('plain failure');
  });

  it('stringifies non-Error objects to the fallback', () => {
    expect(errorMessage({ code: 500 }, 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('has a generic default fallback', () => {
    expect(errorMessage(null)).toBe('Something went wrong');
  });
});
