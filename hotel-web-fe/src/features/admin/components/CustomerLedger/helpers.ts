// Helper / utility functions for the Customer Ledger feature

import type { CustomerLedger } from '../../../../types';
import type { LedgerUiStatus, ToneName } from './types';

// Date-only ISO 8601 (YYYY-MM-DD): date columns from the backend arrive
// without a time/offset. Plain `new Date("YYYY-MM-DD")` parses as UTC midnight,
// which shifts the date by one day in UTC-negative timezones; build the Date
// in local time instead.
export const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const formatDateForInput = (dateString: string | null | undefined): string => {
  if (!dateString) return '';
  if (DATE_ONLY_RE.test(dateString)) return dateString;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

export const formatDateForDisplay = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const m = DATE_ONLY_RE.exec(dateString);
    const date = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '-';
  }
};

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
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
};

// Initials for company avatars (e.g. "Farley Sibu" -> "FS")
export const companyInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export const isLedgerVoided = (ledger: CustomerLedger) => Boolean(ledger.void_at) || ledger.status === 'void';

export const isDateOverdue = (dateString: string | null | undefined) => {
  if (!dateString) return false;
  const due = new Date(`${formatDateForInput(dateString)}T23:59:59`);
  return !isNaN(due.getTime()) && due.getTime() < Date.now();
};

export const getLedgerUiStatus = (ledger: CustomerLedger): LedgerUiStatus => {
  const balance = asMoney(ledger.balance_due);
  const paid = asMoney(ledger.paid_amount);
  if (isLedgerVoided(ledger)) return 'voided';
  if (ledger.status === 'paid' || balance <= 0) return 'paid';
  if (ledger.status === 'overdue' || isDateOverdue(ledger.due_date)) return 'overdue';
  if (paid > 0) return 'partial';
  if (ledger.invoice_number) return 'invoiced';
  if (balance > 0) return 'ready_to_invoice';
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
