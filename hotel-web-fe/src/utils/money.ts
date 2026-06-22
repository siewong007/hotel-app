export type MoneyInput = number | string | null | undefined;

const MINOR_UNITS_PER_MAJOR = 100;

const parseDecimalStringToMinorUnits = (value: string): number => {
  const sanitized = value.trim().replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!sanitized) return 0;

  const sign = sanitized.startsWith('-') ? -1 : 1;
  const unsigned = sanitized.replace(/^-/, '');
  const [wholePart = '0', fractionPart = ''] = unsigned.split('.');
  const whole = Number.parseInt(wholePart || '0', 10);
  if (!Number.isFinite(whole)) return 0;

  const fractionDigits = fractionPart.replace(/\D/g, '');
  const cents = Number.parseInt(fractionDigits.padEnd(2, '0').slice(0, 2), 10) || 0;
  const roundUp = Number.parseInt(fractionDigits[2] || '0', 10) >= 5;

  return sign * (whole * MINOR_UNITS_PER_MAJOR + cents + (roundUp ? 1 : 0));
};

export const toMinorUnits = (value: MoneyInput): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return parseDecimalStringToMinorUnits(value);
  if (!Number.isFinite(value)) return 0;
  return parseDecimalStringToMinorUnits(value.toFixed(6));
};

export const fromMinorUnits = (minorUnits: number): number => minorUnits / MINOR_UNITS_PER_MAJOR;

export const toMoneyNumber = (value: MoneyInput): number => fromMinorUnits(toMinorUnits(value));

export const addMoney = (...values: MoneyInput[]): number =>
  fromMinorUnits(values.reduce<number>((sum, value) => sum + toMinorUnits(value), 0));

export const subtractMoney = (left: MoneyInput, right: MoneyInput): number =>
  fromMinorUnits(toMinorUnits(left) - toMinorUnits(right));

export const sumMoney = (values: MoneyInput[]): number => addMoney(...values);

export const multiplyMoney = (value: MoneyInput, multiplier: number): number =>
  fromMinorUnits(Math.round(toMinorUnits(value) * multiplier));

export const divideMoney = (value: MoneyInput, divisor: number): number =>
  divisor === 0 ? 0 : fromMinorUnits(Math.round(toMinorUnits(value) / divisor));

export const minMoney = (...values: MoneyInput[]): number =>
  fromMinorUnits(Math.min(...values.map(toMinorUnits)));

export const compareMoney = (left: MoneyInput, right: MoneyInput): number =>
  toMinorUnits(left) - toMinorUnits(right);

export const isPositiveMoney = (value: MoneyInput): boolean => toMinorUnits(value) > 0;

export const isGreaterMoney = (left: MoneyInput, right: MoneyInput): boolean =>
  compareMoney(left, right) > 0;

export const isLessMoney = (left: MoneyInput, right: MoneyInput): boolean =>
  compareMoney(left, right) < 0;
