import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  divideMoney,
  isGreaterMoney,
  isLessMoney,
  isPositiveMoney,
  multiplyMoney,
  subtractMoney,
  toMinorUnits,
  toMoneyNumber,
} from './money';

describe('money utilities', () => {
  it('stores decimal amounts as integer minor units', () => {
    expect(toMinorUnits('86.40')).toBe(8640);
    expect(toMinorUnits('RM 1,234.56')).toBe(123456);
  });

  it('rounds floating point arithmetic to cents', () => {
    const total = 86.4 * 3;

    expect(total).toBe(259.20000000000005);
    expect(toMinorUnits(total)).toBe(25920);
    expect(subtractMoney(total, 259.2)).toBe(0);
  });

  it('rounds half cents consistently', () => {
    expect(toMinorUnits('1.005')).toBe(101);
    expect(toMoneyNumber(1.005)).toBe(1.01);
  });

  it('compares values at cent precision', () => {
    expect(isPositiveMoney(0.004)).toBe(false);
    expect(isGreaterMoney(259.20000000000005, 259.2)).toBe(false);
    expect(isLessMoney(259.19, 259.2)).toBe(true);
    expect(compareMoney(259.2, '259.20')).toBe(0);
  });

  it('performs common money arithmetic through minor units', () => {
    expect(addMoney(100.1, '0.20')).toBe(100.3);
    expect(multiplyMoney('86.40', 3)).toBe(259.2);
    expect(divideMoney('285.00', 1.08)).toBe(263.89);
  });
});
