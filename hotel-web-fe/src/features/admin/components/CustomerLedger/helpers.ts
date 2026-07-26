// Helper / utility functions for the Customer Ledger feature

import type { CustomerLedger } from '../../../../types';
import type { LedgerUiStatus, ToneName } from './types';
import { formatHotelDate, isHotelDatePast, toHotelDateString } from '../../../../utils/date';
import { isPositiveMoney, toMoneyNumber } from '../../../../utils/money';

// Ledger business dates are derived in the hotel's timezone (utils/date.ts):
// timestamptz columns (payment_date, created_at, void_at) arrive as Z-suffixed
// instants whose calendar date shifts by a day for viewers outside the hotel's
// zone if read in the viewer's zone; date-only columns (due_date, posting_date,
// ...) pass through as-is.

export const formatDateForInput = (dateString: string | null | undefined): string =>
  toHotelDateString(dateString);

export const formatDateForDisplay = (dateString: string | null | undefined): string =>
  formatHotelDate(dateString);

export const getStatusColor = (status: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
  switch (status) {
    case 'paid':
      return 'success';
    case 'partial':
      return 'warning';
    case 'pending':
      return 'info';
    case 'overdue':
      return 'error';
    default:
      return 'default';
  }
};

export const getStatusText = (status: string): string => {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'partial':
      return 'Partial';
    case 'pending':
      return 'Pending';
    case 'overdue':
      return 'Overdue';
    default:
      return status;
  }
};

export const asMoney = (value: number | string | null | undefined): number => {
  return toMoneyNumber(value);
};

// Initials for company avatars (e.g. "Farley Sibu" -> "FS")
export const companyInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export const isLedgerVoided = (ledger: CustomerLedger) => Boolean(ledger.void_at) || ledger.status === 'void';

// Overdue = the hotel calendar has moved past the due date (the due day itself
// is not overdue), so the badge agrees for every viewer regardless of zone.
export const isDateOverdue = (dateString: string | null | undefined) =>
  isHotelDatePast(dateString);

export const getLedgerUiStatus = (ledger: CustomerLedger): LedgerUiStatus => {
  const balance = asMoney(ledger.balance_due);
  const paid = asMoney(ledger.paid_amount);
  if (isLedgerVoided(ledger)) return 'voided';
  // Balance-first: an entry is only "paid" when nothing is outstanding. If a
  // charge later increases the amount (balance > 0 again), the entry reopens to
  // partial/pending even if the stored status column still says 'paid'.
  if (!isPositiveMoney(balance)) return 'paid';
  if (ledger.status === 'overdue' || isDateOverdue(ledger.due_date)) return 'overdue';
  if (isPositiveMoney(paid)) return 'partial';
  if (ledger.invoice_number) return 'invoiced';
  if (isPositiveMoney(balance)) return 'ready_to_invoice';
  return 'draft';
};

export const TONE: Record<ToneName, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: '#F0F3F7', fg: '#475569', dot: '#94A3B8' },
  blue:    { bg: '#E5F0FB', fg: '#1F66C9', dot: '#2F7DE1' },
  indigo:  { bg: '#ECEAFB', fg: '#5743C8', dot: '#7A6BE2' },
  amber:   { bg: '#FBF1DC', fg: '#9A6A0E', dot: '#C8941D' },
  green:   { bg: '#E1F4EA', fg: '#0E7A48', dot: '#16A364' },
  red:     { bg: '#FCE5E9', fg: '#B53047', dot: '#D14256' },
  muted:   { bg: '#EFF1F4', fg: '#94A3B8', dot: '#B0B8C2' },
};

export const STATUS_TONE: Record<LedgerUiStatus, { label: string; tone: ToneName }> = {
  draft:            { label: 'Draft',          tone: 'neutral' },
  ready_to_invoice: { label: 'Ready',          tone: 'blue' },
  invoiced:         { label: 'Invoiced',       tone: 'indigo' },
  partial:          { label: 'Partially Paid', tone: 'amber' },
  paid:             { label: 'Paid',           tone: 'green' },
  overdue:          { label: 'Overdue',        tone: 'red' },
  voided:           { label: 'Voided',         tone: 'muted' },
};
