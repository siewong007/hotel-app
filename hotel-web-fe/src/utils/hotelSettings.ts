// Hotel settings utility functions

export interface BookingChannel {
  name: string;
  abbreviation: string;
}

export interface HotelSettings {
  hotel_name: string;
  hotel_address: string;
  hotel_phone: string;
  hotel_email: string;
  check_in_time: string;
  check_out_time: string;
  night_shift_time: string; // Time when night audit runs and data gets posted for reporting
  currency: string;
  timezone: string;
  deposit_amount: number; // Default deposit amount for check-in
  service_tax_rate: number; // Percentage (e.g., 8 for 8%)
  tourism_tax_rate: number; // Per night tourism tax
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
  currency: 'MYR',
  timezone: 'Asia/Kuala_Lumpur',
  deposit_amount: 50,
  service_tax_rate: 8, // 8% service tax
  tourism_tax_rate: 10, // RM 10 per night for tourists (Malaysia standard)
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
    'American Express',
    'Bank Transfer',
    'E-Wallet',
    'Other',
  ],
};

const STORAGE_KEY = 'hotelSettings';

// Migrate legacy string[] booking_channels (or anything malformed) to {name, abbreviation}[].
const normalizeBookingChannels = (raw: unknown): BookingChannel[] => {
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

// Get hotel settings from localStorage or return defaults
export const getHotelSettings = (): HotelSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // Ensure numeric fields are properly typed (localStorage may store them as strings)
      return {
        ...merged,
        deposit_amount: Number(merged.deposit_amount) || DEFAULT_SETTINGS.deposit_amount,
        service_tax_rate: Number(merged.service_tax_rate) || DEFAULT_SETTINGS.service_tax_rate,
        tourism_tax_rate: Number(merged.tourism_tax_rate) || DEFAULT_SETTINGS.tourism_tax_rate,
        booking_channels: normalizeBookingChannels(merged.booking_channels),
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
