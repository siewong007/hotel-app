import { describe, expect, it } from 'vitest';

import { priceErrorOf } from './useCellEditorDraft';

describe('priceErrorOf', () => {
  it('accepts a blank (standard rate) and plain prices with up to 2 decimals', () => {
    for (const ok of [null, '150', '149.5', '149.50', '0.01']) expect(priceErrorOf(ok)).toBeNull();
  });

  it('flags a third decimal and exponent notation as a decimals problem', () => {
    expect(priceErrorOf('199.999')).toBe('decimals');
    expect(priceErrorOf('1e3')).toBe('decimals');
  });

  it('flags zero, negative and non-numeric input as needing a positive price', () => {
    for (const bad of ['0', '-5', 'abc', '']) expect(priceErrorOf(bad)).toBe('positive');
  });
});
