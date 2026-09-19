import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLASS_BLUR_PX,
  MAX_GLASS_BLUR_PX,
  applyGlassBlur,
  normalizeGlassBlur,
} from './glassBlur';

describe('normalizeGlassBlur', () => {
  it('returns the default for anything unparseable', () => {
    expect(normalizeGlassBlur(undefined)).toBe(DEFAULT_GLASS_BLUR_PX);
    expect(normalizeGlassBlur(null)).toBe(DEFAULT_GLASS_BLUR_PX);
    expect(normalizeGlassBlur('blur-me')).toBe(DEFAULT_GLASS_BLUR_PX);
    expect(normalizeGlassBlur(NaN)).toBe(DEFAULT_GLASS_BLUR_PX);
  });

  it('returns the default for blank strings (Number("") would coerce to 0)', () => {
    expect(normalizeGlassBlur('')).toBe(DEFAULT_GLASS_BLUR_PX);
    expect(normalizeGlassBlur('   ')).toBe(DEFAULT_GLASS_BLUR_PX);
  });

  it('keeps in-range values (numeric strings included)', () => {
    expect(normalizeGlassBlur(0)).toBe(0);
    expect(normalizeGlassBlur(14)).toBe(14);
    expect(normalizeGlassBlur('7')).toBe(7);
    expect(normalizeGlassBlur(MAX_GLASS_BLUR_PX)).toBe(MAX_GLASS_BLUR_PX);
  });

  it('clamps to the supported range and rounds', () => {
    expect(normalizeGlassBlur(-5)).toBe(0);
    expect(normalizeGlassBlur(999)).toBe(MAX_GLASS_BLUR_PX);
    expect(normalizeGlassBlur(12.6)).toBe(13);
  });
});

describe('applyGlassBlur', () => {
  it('writes the blur px and keeps fills translucent while blur is on', () => {
    applyGlassBlur(12);

    const { style } = document.documentElement;
    expect(style.getPropertyValue('--hotel-glass-blur')).toBe('12px');
    expect(style.getPropertyValue('--hotel-glass-alpha')).toBe('82%');
  });

  it('makes frosted fills fully opaque at 0 so nothing reads blurry', () => {
    applyGlassBlur(0);

    const { style } = document.documentElement;
    expect(style.getPropertyValue('--hotel-glass-blur')).toBe('0px');
    expect(style.getPropertyValue('--hotel-glass-alpha')).toBe('100%');
  });
});
