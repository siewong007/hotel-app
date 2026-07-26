import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REPORT_FONT_FAMILY,
  REPORT_FONT_SIZE_MAX,
  REPORT_FONT_SIZE_MIN,
  getHotelSetting,
  getHotelSettings,
  normalizeBookingChannels,
  normalizeReportFontFamily,
  normalizeReportFontSize,
  normalizeStringList,
  saveHotelSettings,
  updateHotelSetting,
} from './hotelSettings';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('normalizeStringList', () => {
  it('returns the fallback when raw is not an array', () => {
    expect(normalizeStringList('nope', ['a'])).toEqual(['a']);
    expect(normalizeStringList(undefined, ['a'])).toEqual(['a']);
  });

  it('trims, drops non-strings/blanks, and de-dupes', () => {
    expect(normalizeStringList([' Cash ', 'Cash', '', 42, 'Card'], ['fallback'])).toEqual([
      'Cash',
      'Card',
    ]);
  });

  it('returns the fallback when nothing survives filtering', () => {
    expect(normalizeStringList(['', '   ', 7], ['fallback'])).toEqual(['fallback']);
  });
});

describe('normalizeBookingChannels', () => {
  it('returns the default channel list when raw is not an array', () => {
    const result = normalizeBookingChannels('nope');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('abbreviation');
  });

  it('migrates legacy string[] channels, matching known abbreviations', () => {
    const result = normalizeBookingChannels(['Booking.com', 'A New OTA']);
    expect(result).toEqual([
      { name: 'Booking.com', abbreviation: 'B.C' },
      { name: 'A New OTA', abbreviation: '' },
    ]);
  });

  it('passes through well-formed {name, abbreviation} objects', () => {
    const result = normalizeBookingChannels([{ name: ' Direct ', abbreviation: ' DW ' }]);
    expect(result).toEqual([{ name: 'Direct', abbreviation: 'DW' }]);
  });

  it('drops malformed entries and falls back to defaults if nothing remains', () => {
    const result = normalizeBookingChannels([{ abbreviation: 'X' }, 42, null]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('name');
  });
});

describe('normalizeReportFontSize', () => {
  it('uses the fallback when raw is not a finite number', () => {
    expect(normalizeReportFontSize('not-a-number', 14)).toBe(14);
    expect(normalizeReportFontSize(undefined, 14)).toBe(14);
  });

  it('rounds a valid numeric value', () => {
    expect(normalizeReportFontSize(14.6, 14)).toBe(15);
  });

  it('clamps to the default min/max bounds', () => {
    expect(normalizeReportFontSize(1, 14)).toBe(REPORT_FONT_SIZE_MIN);
    expect(normalizeReportFontSize(999, 14)).toBe(REPORT_FONT_SIZE_MAX);
  });

  it('clamps to custom min/max bounds when provided', () => {
    expect(normalizeReportFontSize(5, 14, { min: 10, max: 20 })).toBe(10);
    expect(normalizeReportFontSize(50, 14, { min: 10, max: 20 })).toBe(20);
  });
});

describe('normalizeReportFontFamily', () => {
  it('falls back to the default when raw is not a string', () => {
    expect(normalizeReportFontFamily(undefined)).toBe(DEFAULT_REPORT_FONT_FAMILY);
    expect(normalizeReportFontFamily(42)).toBe(DEFAULT_REPORT_FONT_FAMILY);
  });

  it('falls back to the default when raw is not one of the known options', () => {
    expect(normalizeReportFontFamily('Comic Sans')).toBe(DEFAULT_REPORT_FONT_FAMILY);
  });

  it('passes through a known font family value', () => {
    expect(normalizeReportFontFamily('Georgia, "Times New Roman", serif')).toBe(
      'Georgia, "Times New Roman", serif'
    );
  });
});

describe('getHotelSettings / saveHotelSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns built-in defaults when nothing is stored', () => {
    const settings = getHotelSettings();
    expect(settings.hotel_name).toBe('Grand Hotel');
    expect(settings.timezone).toBe('Asia/Kuala_Lumpur');
    expect(settings.currency).toBe('MYR');
  });

  it('merges a partial stored object on top of defaults, keeping unspecified defaults', () => {
    localStorage.setItem('hotelSettings', JSON.stringify({ hotel_name: 'Salim Inn' }));
    const settings = getHotelSettings();

    expect(settings.hotel_name).toBe('Salim Inn');
    expect(settings.currency).toBe('MYR'); // untouched default
    expect(settings.deposit_amount).toBe(50); // untouched default
  });

  it('coerces numeric fields that localStorage may have stored as strings', () => {
    localStorage.setItem(
      'hotelSettings',
      JSON.stringify({ deposit_amount: '75.5', service_tax_rate: '6', max_login_attempts: '10' })
    );

    const settings = getHotelSettings();
    expect(settings.deposit_amount).toBe(75.5);
    expect(settings.service_tax_rate).toBe(6);
    expect(settings.max_login_attempts).toBe(10);
  });

  it('falls back to defaults for invalid numeric fields', () => {
    localStorage.setItem('hotelSettings', JSON.stringify({ service_tax_rate: 'garbage' }));
    const settings = getHotelSettings();
    expect(settings.service_tax_rate).toBe(8);
  });

  it('falls back to built-in defaults when the stored JSON is corrupt', () => {
    localStorage.setItem('hotelSettings', '{not valid json');
    const settings = getHotelSettings();
    expect(settings.hotel_name).toBe('Grand Hotel');
  });

  it('normalizes support_categories, rate_codes and booking_channels through their helpers', () => {
    localStorage.setItem(
      'hotelSettings',
      JSON.stringify({
        support_categories: ['booking', 'booking', ''],
        rate_codes: 'not-an-array',
        booking_channels: ['Agoda'],
      })
    );

    const settings = getHotelSettings();
    expect(settings.support_categories).toEqual(['booking']);
    expect(settings.rate_codes.length).toBeGreaterThan(0);
    expect(settings.booking_channels).toEqual([{ name: 'Agoda', abbreviation: 'A.C' }]);
  });

  it('logs and returns defaults when localStorage.getItem throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    });

    const settings = getHotelSettings();
    expect(settings.hotel_name).toBe('Grand Hotel');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('saveHotelSettings writes JSON and swallows storage errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });

    expect(() => saveHotelSettings(getHotelSettings())).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('getHotelSetting / updateHotelSetting', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getHotelSetting reads a single key from the merged settings', () => {
    expect(getHotelSetting('currency')).toBe('MYR');
  });

  it('updateHotelSetting persists a single key and leaves the rest untouched', () => {
    updateHotelSetting('hotel_name', 'Salim Inn');

    expect(getHotelSetting('hotel_name')).toBe('Salim Inn');
    expect(getHotelSetting('currency')).toBe('MYR');
  });
});
