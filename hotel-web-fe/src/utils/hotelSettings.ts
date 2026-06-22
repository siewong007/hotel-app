// Hotel settings utility functions

import { toMoneyNumber } from './money';

export interface BookingChannel {
  name: string;
  abbreviation: string;
}

export const REPORT_FONT_SIZE_MIN = 10;
export const REPORT_FONT_SIZE_MAX = 24;
export const REPORT_DISPLAY_FONT_SIZE_MIN = 12;
export const REPORT_DISPLAY_FONT_SIZE_MAX = 40;

export const REPORT_FONT_FAMILY_OPTIONS = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
] as const;

export const DEFAULT_REPORT_FONT_FAMILY = REPORT_FONT_FAMILY_OPTIONS[0].value;

export interface HotelSettings {
  hotel_name: string;
  hotel_address: string;
  hotel_phone: string;
  hotel_email: string;
  check_in_time: string;
  check_out_time: string;
  night_shift_time: string; // Time when night audit runs and data gets posted for reporting
  night_audit_auto_enabled: boolean; // When true, backend auto-runs the night audit at night_shift_time
  currency: string;
  timezone: string;
  deposit_amount: number; // Default deposit amount for check-in
  service_tax_rate: number; // Percentage (e.g., 8 for 8%)
  tourism_tax_rate: number; // Per night tourism tax
  default_payment_terms_days: number; // Default ledger due-date offset
  report_font_size: number; // Base report preview/print font size in pixels
  report_font_family: string; // Font family for generated report previews and print output
  report_heading_font_size: number; // Large report headings and KPI values in pixels
  report_section_heading_font_size: number; // Section heading size in pixels
  report_table_font_size: number; // Report table text size in pixels
  report_caption_font_size: number; // Report captions and secondary labels in pixels
  report_chip_font_size: number; // Report status chip text size in pixels
  max_login_attempts: number; // Failed login attempts before lockout
  totp_issuer_name: string; // Issuer shown in authenticator apps
  passkey_relying_party_name: string; // Display name shown by passkey authenticators
  rate_codes: string[]; // Available booking rate codes
  market_codes: string[]; // Available market segment codes
  booking_channels: BookingChannel[]; // Configurable online booking channels (name + abbreviation)
  payment_methods: string[]; // Configurable payment methods for walk-in
}

const DEFAULT_SETTINGS: HotelSettings = {
  hotel_name: 'Grand Hotel',
  hotel_address: '123 Main Street, City',
  hotel_phone: '+60-3-1234-5678',
  hotel_email: 'info@grandhotel.com',
  check_in_time: '15:00',
  check_out_time: '11:00',
  night_shift_time: '23:00', // Default night audit time at 11 PM
  night_audit_auto_enabled: false, // Opt-in; manual night audit by default
  currency: 'MYR',
  timezone: 'Asia/Kuala_Lumpur',
  deposit_amount: 50,
  service_tax_rate: 8, // 8% service tax
  tourism_tax_rate: 10, // RM 10 per night for tourists (Malaysia standard)
  default_payment_terms_days: 30,
  report_font_size: 14,
  report_font_family: DEFAULT_REPORT_FONT_FAMILY,
  report_heading_font_size: 24,
  report_section_heading_font_size: 18,
  report_table_font_size: 14,
  report_caption_font_size: 13,
  report_chip_font_size: 12,
  max_login_attempts: 5,
  totp_issuer_name: 'Hotel Management System',
  passkey_relying_party_name: 'Hotel Management System',
  rate_codes: ['RACK', 'OVR', 'CORP', 'GOVT', 'WKII', 'PKG', 'GRP', 'AAA', 'PROMO'],
  market_codes: ['WKII', 'CORP', 'GOVT', 'OTA', 'DIRECT', 'GROUP', 'EVENTS', 'LEISURE'],
  booking_channels: [
    { name: 'Booking.com', abbreviation: 'B.C' },
    { name: 'Agoda', abbreviation: 'A.C' },
    { name: 'Traveloka', abbreviation: 'T.C' },
    { name: 'Expedia', abbreviation: 'E.C' },
    { name: 'Hotels.com', abbreviation: 'H.C' },
    { name: 'Airbnb', abbreviation: 'AB' },
    { name: 'Trip.com', abbreviation: 'TR' },
    { name: 'Direct Website', abbreviation: 'DW' },
    { name: 'Other OTA', abbreviation: 'OT' },
  ],
  payment_methods: [
    'Cash',
    'Visa Card',
    'Master Card',
    'Debit Card',
    'Sarawak Pay',
    'American Express',
    'Bank Transfer',
    'E-Wallet',
    'Other',
  ],
};

const STORAGE_KEY = 'hotelSettings';

export const normalizeStringList = (raw: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(raw)) return fallback;
  const values = raw
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
  return values.length > 0 ? Array.from(new Set(values)) : fallback;
};

// Migrate legacy string[] booking_channels (or anything malformed) to {name, abbreviation}[].
export const normalizeBookingChannels = (raw: unknown): BookingChannel[] => {
  if (!Array.isArray(raw)) return DEFAULT_SETTINGS.booking_channels;
  const lookup = new Map(DEFAULT_SETTINGS.booking_channels.map(c => [c.name.toLowerCase(), c.abbreviation]));
  const result: BookingChannel[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (!name) continue;
      result.push({ name, abbreviation: lookup.get(name.toLowerCase()) ?? '' });
    } else if (item && typeof item === 'object') {
      const name = typeof (item as any).name === 'string' ? (item as any).name.trim() : '';
      if (!name) continue;
      const abbreviation = typeof (item as any).abbreviation === 'string' ? (item as any).abbreviation.trim() : '';
      result.push({ name, abbreviation });
    }
  }
  return result.length > 0 ? result : DEFAULT_SETTINGS.booking_channels;
};

export const normalizeReportFontSize = (
  raw: unknown,
  fallback = DEFAULT_SETTINGS.report_font_size,
  options: { min?: number; max?: number } = {}
): number => {
  const parsed = Number(raw);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  const min = options.min ?? REPORT_FONT_SIZE_MIN;
  const max = options.max ?? REPORT_FONT_SIZE_MAX;
  return Math.min(max, Math.max(min, Math.round(base)));
};

export const normalizeReportFontFamily = (raw: unknown): string => {
  if (typeof raw !== 'string') return DEFAULT_REPORT_FONT_FAMILY;
  const trimmed = raw.trim();
  return REPORT_FONT_FAMILY_OPTIONS.some(option => option.value === trimmed)
    ? trimmed
    : DEFAULT_REPORT_FONT_FAMILY;
};

// Get hotel settings from localStorage or return defaults
export const getHotelSettings = (): HotelSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      const reportBaseFontSize = normalizeReportFontSize(merged.report_font_size);
      // Ensure numeric fields are properly typed (localStorage may store them as strings)
      return {
        ...merged,
        deposit_amount: toMoneyNumber(merged.deposit_amount) || DEFAULT_SETTINGS.deposit_amount,
        service_tax_rate: Number(merged.service_tax_rate) || DEFAULT_SETTINGS.service_tax_rate,
        tourism_tax_rate: toMoneyNumber(merged.tourism_tax_rate) || DEFAULT_SETTINGS.tourism_tax_rate,
        default_payment_terms_days: Number(merged.default_payment_terms_days) || DEFAULT_SETTINGS.default_payment_terms_days,
        report_font_size: reportBaseFontSize,
        report_font_family: normalizeReportFontFamily(merged.report_font_family),
        report_heading_font_size: normalizeReportFontSize(
          merged.report_heading_font_size,
          Math.max(reportBaseFontSize + 10, 20),
          { min: REPORT_DISPLAY_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
        ),
        report_section_heading_font_size: normalizeReportFontSize(
          merged.report_section_heading_font_size,
          Math.max(reportBaseFontSize + 4, 14),
          { min: REPORT_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
        ),
        report_table_font_size: normalizeReportFontSize(
          merged.report_table_font_size,
          reportBaseFontSize
        ),
        report_caption_font_size: normalizeReportFontSize(
          merged.report_caption_font_size,
          Math.max(reportBaseFontSize - 1, REPORT_FONT_SIZE_MIN)
        ),
        report_chip_font_size: normalizeReportFontSize(
          merged.report_chip_font_size,
          Math.max(reportBaseFontSize - 2, REPORT_FONT_SIZE_MIN)
        ),
        max_login_attempts: Number(merged.max_login_attempts) || DEFAULT_SETTINGS.max_login_attempts,
        rate_codes: normalizeStringList(merged.rate_codes, DEFAULT_SETTINGS.rate_codes),
        market_codes: normalizeStringList(merged.market_codes, DEFAULT_SETTINGS.market_codes),
        booking_channels: normalizeBookingChannels(merged.booking_channels),
        payment_methods: normalizeStringList(merged.payment_methods, DEFAULT_SETTINGS.payment_methods),
      };
    }
  } catch (error) {
    console.error('Failed to load hotel settings:', error);
  }
  return DEFAULT_SETTINGS;
};

// Save hotel settings to localStorage
export const saveHotelSettings = (settings: HotelSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save hotel settings:', error);
  }
};

// Get specific setting value
export const getHotelSetting = <K extends keyof HotelSettings>(
  key: K
): HotelSettings[K] => {
  const settings = getHotelSettings();
  return settings[key];
};

// Update specific setting
export const updateHotelSetting = <K extends keyof HotelSettings>(
  key: K,
  value: HotelSettings[K]
): void => {
  const settings = getHotelSettings();
  settings[key] = value;
  saveHotelSettings(settings);
};
