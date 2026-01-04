// Hotel settings utility functions

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
  room_card_deposit: number;
  late_checkout_penalty: number;
  service_tax_rate: number; // Percentage (e.g., 8 for 8%)
  tourism_tax_rate: number; // Per night tourism tax
  booking_channels: string[]; // Configurable online booking channels
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
  room_card_deposit: 50,
  late_checkout_penalty: 50,
  service_tax_rate: 8, // 8% service tax
  tourism_tax_rate: 10, // RM 10 per night for tourists (Malaysia standard)
  booking_channels: [
    'Agoda',
    'Booking.com',
    'Traveloka',
    'Expedia',
    'Hotels.com',
    'Airbnb',
    'Trip.com',
    'Direct Website',
    'Other OTA',
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

// Get hotel settings from localStorage or return defaults
export const getHotelSettings = (): HotelSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      return { ...DEFAULT_SETTINGS, ...parsed };
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
