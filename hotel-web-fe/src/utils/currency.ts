// Currency utility functions
import { getHotelSettings } from './hotelSettings';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  format: (amount: number) => string;
}

export const SUPPORTED_CURRENCIES: Record<string, CurrencyInfo> = {
  USD: {
    code: 'USD',
    symbol: '$',
    name: 'US Dollar',
    format: (amount: number) => `$${amount.toFixed(2)}`,
  },
  MYR: {
    code: 'MYR',
    symbol: 'RM',
    name: 'Malaysian Ringgit',
    format: (amount: number) => `RM ${amount.toFixed(2)}`,
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    format: (amount: number) => `€${amount.toFixed(2)}`,
  },
  GBP: {
    code: 'GBP',
    symbol: '£',
    name: 'British Pound',
    format: (amount: number) => `£${amount.toFixed(2)}`,
  },
  SGD: {
    code: 'SGD',
    symbol: 'S$',
    name: 'Singapore Dollar',
    format: (amount: number) => `S$${amount.toFixed(2)}`,
  },
  JPY: {
    code: 'JPY',
    symbol: '¥',
    name: 'Japanese Yen',
    format: (amount: number) => `¥${Math.round(amount)}`, // JPY doesn't use decimals
  },
  CNY: {
    code: 'CNY',
    symbol: '¥',
    name: 'Chinese Yuan',
    format: (amount: number) => `¥${amount.toFixed(2)}`,
  },
  AUD: {
    code: 'AUD',
    symbol: 'A$',
    name: 'Australian Dollar',
    format: (amount: number) => `A$${amount.toFixed(2)}`,
  },
  THB: {
    code: 'THB',
    symbol: '฿',
    name: 'Thai Baht',
    format: (amount: number) => `฿${amount.toFixed(2)}`,
  },
  IDR: {
    code: 'IDR',
    symbol: 'Rp',
    name: 'Indonesian Rupiah',
    format: (amount: number) => `Rp ${Math.round(amount)}`, // IDR doesn't use decimals
  },
};

// Default currency
const DEFAULT_CURRENCY = 'USD';

// Get currency from localStorage or hotel settings or default
export const getCurrentCurrency = (): string => {
  try {
    // First check specific currency setting
    const currencyOverride = localStorage.getItem('hotelCurrency');
    if (currencyOverride) {
      return currencyOverride;
    }
    // Fall back to hotel settings
    const settings = getHotelSettings();
    return settings.currency || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
};

// Set currency in localStorage
export const setCurrentCurrency = (currencyCode: string): void => {
  try {
    localStorage.setItem('hotelCurrency', currencyCode);
  } catch (error) {
    console.error('Failed to save currency preference:', error);
  }
};

// Get currency info
export const getCurrencyInfo = (currencyCode?: string): CurrencyInfo => {
  const code = currencyCode || getCurrentCurrency();
  return SUPPORTED_CURRENCIES[code] || SUPPORTED_CURRENCIES[DEFAULT_CURRENCY];
};

// Get currency symbol
export const getCurrencySymbol = (currencyCode?: string): string => {
  return getCurrencyInfo(currencyCode).symbol;
};

// Format amount with current currency
export const formatCurrency = (amount: number, currencyCode?: string): string => {
  const currency = getCurrencyInfo(currencyCode);
  return currency.format(amount);
};

// Format amount with custom decimals
export const formatCurrencyCustom = (
  amount: number,
  decimals: number = 2,
  currencyCode?: string
): string => {
  const symbol = getCurrencySymbol(currencyCode);
  const formattedAmount = amount.toFixed(decimals);

  // For currencies that use space after symbol
  if (currencyCode === 'MYR' || currencyCode === 'IDR') {
    return `${symbol} ${formattedAmount}`;
  }

  return `${symbol}${formattedAmount}`;
};
