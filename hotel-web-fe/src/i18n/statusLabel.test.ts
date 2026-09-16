import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetLocaleStoreForTests, setActiveLocale } from './localeStore';
// Non-English bundles are lazy chunks (see src/i18n/resources/index.ts). The app
// awaits them at boot; a test that asserts translated copy must do the same, or
// it reads the English fallback and fails on a difference that is not a bug.
import { ensureLocaleLoaded } from './resources';
import { statusLabel } from './statusLabel';
import { t } from './translate';
import { resetMissingKeyReportsForTests } from './translate';

afterEach(() => {
  resetLocaleStoreForTests();
  resetMissingKeyReportsForTests();
});

beforeAll(async () => {
  await ensureLocaleLoaded('zh');
});

describe('statusLabel', () => {
  it('renders the localized label for a known status value', () => {
    expect(statusLabel(t, 'booking', 'confirmed')).toBe('Confirmed');
    expect(statusLabel(t, 'booking', 'checked_in')).toBe('Checked in');
  });

  it('humanizes a value the bundle does not map', () => {
    // `checked_in` is a booking status, not a room status — the missing key
    // falls back to a readable label rather than the raw enum.
    expect(statusLabel(t, 'room', 'checked_in')).toBe('Checked In');
    expect(statusLabel(t, 'booking', 'some_new_state')).toBe('Some New State');
  });

  it('renders generic.unknown for null and undefined', () => {
    expect(statusLabel(t, 'booking', null)).toBe('Unknown');
    expect(statusLabel(t, 'booking', undefined)).toBe('Unknown');
    expect(statusLabel(t, 'booking', '')).toBe('Unknown');
  });

  it('labels the restored night_audit.failed value', () => {
    expect(statusLabel(t, 'night_audit', 'failed')).toBe('Failed');
  });

  it('renders the Chinese label when zh is the active locale', () => {
    setActiveLocale('zh');
    expect(statusLabel(t, 'booking', 'confirmed')).toBe('已确认');
    expect(statusLabel(t, 'booking', null)).toBe('未知');
    expect(statusLabel(t, 'night_audit', 'failed')).toBe('失败');
  });
});
