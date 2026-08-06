import { describe, expect, it } from 'vitest';

import { createIdempotencyKey, getIdempotencyAttempt } from './idempotency';

describe('createIdempotencyKey', () => {
  it('creates non-empty distinct keys for separate payment attempts', () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();

    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
  });
});

describe('getIdempotencyAttempt', () => {
  it('retains the same key after an error when the material payment fingerprint is unchanged', () => {
    const firstAttempt = getIdempotencyAttempt(null, 'booking:42|amount:100.00|method:Cash');
    const retryAttempt = getIdempotencyAttempt(firstAttempt, 'booking:42|amount:100.00|method:Cash');

    expect(retryAttempt).toEqual(firstAttempt);
  });

  it('rotates the key when material payment data changes', () => {
    const firstAttempt = getIdempotencyAttempt(null, 'ledger:9|amount:100.00|method:Cash');
    const changedAttempt = getIdempotencyAttempt(firstAttempt, 'ledger:9|amount:125.00|method:Cash');

    expect(changedAttempt.fingerprint).toBe('ledger:9|amount:125.00|method:Cash');
    expect(changedAttempt.key).not.toBe(firstAttempt.key);
  });
});
