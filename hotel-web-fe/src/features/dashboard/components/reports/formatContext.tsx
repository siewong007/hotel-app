import React, { createContext, useContext, useMemo } from 'react';

export interface ReportsFormat {
  symbol: string;
  /** Whole-currency, e.g. "RM 12,340" */
  fmtMoney: (n: number) => string;
  /** Abbreviated currency, e.g. "RM 12.3k" */
  fmtMoneyK: (n: number) => string;
  /** Thousands-separated integer */
  fmtInt: (n: number) => string;
  /** Percentage with `d` decimals */
  fmtPct: (n: number, d?: number) => string;
}

const groupInt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function createReportsFormat(symbol: string): ReportsFormat {
  const fmtInt = (n: number) => groupInt(n);
  const fmtMoney = (n: number) => `${symbol} ${groupInt(n)}`;
  const fmtMoneyK = (n: number) =>
    n >= 1000
      ? `${symbol} ${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
      : `${symbol} ${Math.round(n)}`;
  const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;
  return { symbol, fmtMoney, fmtMoneyK, fmtInt, fmtPct };
}

const ReportsFormatContext = createContext<ReportsFormat>(createReportsFormat('RM'));

export const ReportsFormatProvider: React.FC<{ symbol: string; children: React.ReactNode }> = ({
  symbol,
  children,
}) => {
  const value = useMemo(() => createReportsFormat(symbol), [symbol]);
  return <ReportsFormatContext.Provider value={value}>{children}</ReportsFormatContext.Provider>;
};

export const useReportsFormat = () => useContext(ReportsFormatContext);
