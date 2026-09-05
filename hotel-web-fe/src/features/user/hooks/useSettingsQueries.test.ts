import { describe, expect, it } from 'vitest';
import { parseNonNegativeNumberSetting } from './useSettingsQueries';

describe('parseNonNegativeNumberSetting', () => {
  it('keeps a server value of 0 instead of falling back', () => {
    // The dangerous path: the hotel turns auto-release off, the server returns
    // "0", and the local fallback still holds the old window. The general
    // `parseNumberSetting` treats <= 0 as absent and would answer 48 here,
    // silently leaving the sweep enabled after it was switched off.
    expect(parseNonNegativeNumberSetting('0', 48)).toBe(0);
  });

  it('falls back only when the value is absent or unusable', () => {
    expect(parseNonNegativeNumberSetting(undefined, 48)).toBe(48);
    expect(parseNonNegativeNumberSetting('', 48)).toBe(0); // Number('') === 0
    expect(parseNonNegativeNumberSetting('soon', 48)).toBe(48);
    expect(parseNonNegativeNumberSetting('-12', 48)).toBe(48);
  });

  it('accepts a positive window and truncates fractions', () => {
    expect(parseNonNegativeNumberSetting('24', 0)).toBe(24);
    expect(parseNonNegativeNumberSetting('24.9', 0)).toBe(24);
  });
});
