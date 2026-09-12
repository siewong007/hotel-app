import { describe, expect, it } from 'vitest';
import { formatStatusLabel, formatDateRange } from './formatters';

describe('formatStatusLabel', () => {
  it('humanizes snake_case enum values', () => {
    expect(formatStatusLabel('pending_payment')).toBe('Pending Payment');
    expect(formatStatusLabel('checked_out')).toBe('Checked Out');
    expect(formatStatusLabel('no_show')).toBe('No Show');
  });

  it('handles kebab-case, camelCase and spaced input', () => {
    expect(formatStatusLabel('awaiting-payment')).toBe('Awaiting Payment');
    expect(formatStatusLabel('creditCard')).toBe('Credit Card');
    expect(formatStatusLabel('on hold')).toBe('On Hold');
  });

  it('normalizes uppercase input', () => {
    expect(formatStatusLabel('VOIDED')).toBe('Voided');
    expect(formatStatusLabel('FULLY_COMPLIMENTARY')).toBe('Fully Complimentary');
  });

  it('renders the fallback for empty input', () => {
    expect(formatStatusLabel('')).toBe('—');
    expect(formatStatusLabel(null)).toBe('—');
    expect(formatStatusLabel(undefined)).toBe('—');
    expect(formatStatusLabel('', 'Unknown')).toBe('Unknown');
  });
});

describe('formatDateRange', () => {
  it('collapses the year on same-month ranges', () => {
    expect(formatDateRange('2026-09-13', '2026-09-15')).toBe('Sep 13 – Sep 15, 2026');
  });

  it('keeps both dates fully formed across months', () => {
    expect(formatDateRange('2026-09-30', '2026-10-02')).toBe('Sep 30, 2026 – Oct 2, 2026');
  });

  it('collapses a single-night stay to one date', () => {
    expect(formatDateRange('2026-09-13', '2026-09-13')).toBe('Sep 13, 2026');
  });

  it('renders the fallback when an end is unparseable', () => {
    expect(formatDateRange('not-a-date', '2026-09-15')).toBe('—');
    expect(formatDateRange('2026-09-13', null)).toBe('—');
  });
});
