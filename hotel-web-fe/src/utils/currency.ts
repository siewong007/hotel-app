// Currency utility functions
import { getHotelSettings } from './hotelSettings';
import { toMoneyNumber } from './money';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  format: (amount: number | string | null | undefined) => string;
}

// Helper to safely convert to number - exported for use in components
export const toNumber = (value: number | string | null | undefined): number => {
  return toMoneyNumber(value);
};

// Grouping is pinned to en-US on purpose: money follows the *currency's*
// convention (see i18n/format.ts — money is deliberately excluded from
// locale-driven formatting), so 'RM 6,927.57' renders identically in every
// interface language.
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'IDR']);

const groupAmount = (amount: number | string | null | undefined, code: string): string => {
  const decimals = ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toMoneyNumber(amount));
};

const spaced = (symbol: string, code: string) => (amount: number | string | null | undefined) =>
  `${symbol} ${groupAmount(amount, code)}`;

const tight = (symbol: string, code: string) => (amount: number | string | null | undefined) =>
  `${symbol}${groupAmount(amount, code)}`;

export const SUPPORTED_CURRENCIES: Record<string, CurrencyInfo> = {
  USD: {
    code: 'USD',
    symbol: '$',
    name: 'US Dollar',
    format: tight('$', 'USD'),
  },
  MYR: {
    code: 'MYR',
    symbol: 'RM',
    name: 'Malaysian Ringgit',
    format: spaced('RM', 'MYR'),
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    format: tight('€', 'EUR'),
  },
  GBP: {
    code: 'GBP',
    symbol: '£',
    name: 'British Pound',
    format: tight('£', 'GBP'),
  },
  SGD: {
    code: 'SGD',
    symbol: 'S$',
    name: 'Singapore Dollar',
    format: tight('S$', 'SGD'),
  },
  JPY: {
    code: 'JPY',
    symbol: '¥',
    name: 'Japanese Yen',
    format: tight('¥', 'JPY'), // JPY doesn't use decimals
  },
  CNY: {
    code: 'CNY',
    symbol: '¥',
    name: 'Chinese Yuan',
    format: tight('¥', 'CNY'),
  },
  AUD: {
    code: 'AUD',
    symbol: 'A$',
    name: 'Australian Dollar',
    format: tight('A$', 'AUD'),
  },
  THB: {
    code: 'THB',
    symbol: '฿',
    name: 'Thai Baht',
    format: tight('฿', 'THB'),
  },
  IDR: {
    code: 'IDR',
    symbol: 'Rp',
    name: 'Indonesian Rupiah',
    format: spaced('Rp', 'IDR'), // IDR doesn't use decimals
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
export const formatCurrency = (amount: number | string | null | undefined, currencyCode?: string): string => {
  const currency = getCurrencyInfo(currencyCode);
  return currency.format(amount);
};

// Format amount with custom decimals
export const formatCurrencyCustom = (
  amount: number | string | null | undefined,
  decimals: number = 2,
  currencyCode?: string
): string => {
  const code = currencyCode || getCurrentCurrency();
  const symbol = getCurrencySymbol(code);
  const numAmount = toMoneyNumber(amount);
  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(numAmount);

  // For currencies that use space after symbol
  if (code === 'MYR' || code === 'IDR') {
    return `${symbol} ${formattedAmount}`;
  }

  return `${symbol}${formattedAmount}`;
};
