import { useState, useEffect } from 'react';
import {
  getCurrentCurrency,
  setCurrentCurrency,
  getCurrencySymbol,
  getCurrencyInfo,
  formatCurrency,
  CurrencyInfo,
} from '../utils/currency';
import { useResetOnChange } from './useResetOnChange';

export const useCurrency = () => {
  const [currency, setCurrency] = useState<string>(getCurrentCurrency());
  const [currencyInfo, setCurrencyInfo] = useState<CurrencyInfo>(getCurrencyInfo());

  useResetOnChange([currency], () => {
    // Update currency info when currency changes
    setCurrencyInfo(getCurrencyInfo(currency));
  });

  const updateCurrency = (newCurrency: string) => {
    setCurrency(newCurrency);
    setCurrentCurrency(newCurrency);

    // Trigger a custom event to notify other components
    window.dispatchEvent(new CustomEvent('currencyChange', { detail: newCurrency }));
  };

  // Listen for currency changes from other components
  useEffect(() => {
    const handleCurrencyChange = (event: CustomEvent) => {
      setCurrency(event.detail);
    };

    window.addEventListener('currencyChange', handleCurrencyChange as EventListener);
    return () => {
      window.removeEventListener('currencyChange', handleCurrencyChange as EventListener);
    };
  }, []);

  const format = (amount: number): string => {
    return formatCurrency(amount, currency);
  };

  const symbol = getCurrencySymbol(currency);

  return {
    currency,
    currencyInfo,
    symbol,
    format,
    updateCurrency,
  };
};
