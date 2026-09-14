import React from 'react';
import { Icon } from './Icon';

// The reports subsystem's short var names (`--emerald`, `--ink`…) alias onto
// the global --hotel-* design tokens in reports.css.
const TOKEN_ALIAS: Record<string, string> = {
  bg: '--hotel-bg', surface: '--hotel-surface', 'surface-2': '--hotel-surface-raised',
  'surface-3': '--hotel-surface-sunken', border: '--hotel-border', 'border-hi': '--hotel-border-strong',
  ink: '--hotel-text', 'ink-2': '--hotel-text-secondary', 'ink-3': '--hotel-text-muted',
  'ink-4': '--hotel-text-disabled',
  emerald: '--hotel-primary', 'emerald-deep': '--hotel-primary-hover', 'emerald-soft': '--hotel-primary-subtle',
  blue: '--hotel-info', 'blue-soft': '--hotel-info-bg',
  indigo: '--hotel-chart-4', 'indigo-soft': '--hotel-neutral-bg',
  amber: '--hotel-warning', 'amber-soft': '--hotel-warning-bg',
  rose: '--hotel-danger', 'rose-soft': '--hotel-danger-bg',
  good: '--hotel-success', bad: '--hotel-danger',
};

/** Receivables ageing bucket key → semantic status color. */
export const AGEING_TONE: Record<string, string> = {
  current: 'var(--hotel-success)',
  '1_30': 'var(--hotel-info)',
  '31_60': 'var(--hotel-warning)',
  '61_90': 'var(--hotel-orange)',
  '90_plus': 'var(--hotel-danger)',
};

/** Resolve a `var(--token)` string to the aliased `var(--hotel-*)` reference;
 *  pass through literal colors and `--hotel-*` vars untouched. */
export function cssVar(v: string): string {
  if (!v || v.slice(0, 4) !== 'var(') return v;
  const name = v.slice(4, -1).trim().replace(/^--/, '');
  if (name.startsWith('hotel-')) return `var(--${name})`;
  const alias = TOKEN_ALIAS[name];
  return alias ? `var(${alias})` : 'var(--hotel-text-muted)';
}

// ---------- Money / Delta / Pill atoms ----------
type MoneyTone = 'due' | 'paid' | 'muted' | undefined;
export const Money: React.FC<{ value: number; dp?: number; prefix: string; tone?: MoneyTone }> = ({
  value, dp = 0, prefix, tone,
}) => {
  const n = (value || 0).toFixed(dp).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const color = tone === 'due' ? 'var(--rose)' : tone === 'paid' ? 'var(--emerald)'
    : tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)';
  return (
    <span className="mono" style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: '0.74em', fontWeight: 600, color: 'var(--ink-3)', marginRight: 3 }}>{prefix}</span>{n}
    </span>
  );
};

export const Delta: React.FC<{ cur: number; prev: number | null; pp?: boolean; invert?: boolean; suffix?: string }> = ({
  cur, prev, pp = false, invert = false, suffix = '',
}) => {
  if (prev == null) {
    return <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>· no prior</span>;
  }
  const diff = cur - prev;
  const up = diff >= 0;
  const good = invert ? !up : up;
  const txt = pp
    ? `${up ? '+' : '−'}${Math.abs(diff).toFixed(1)} pp`
    : `${up ? '+' : '−'}${Math.abs((diff / (prev || 1)) * 100).toFixed(1)}%`;
  return (
    <span className="delta" data-good={good}>
      <Icon name={up ? 'trend-up' : 'trend-down'} size={13} />
      {txt}{suffix}
    </span>
  );
};

type PillTone = 'neutral' | 'blue' | 'indigo' | 'amber' | 'green' | 'red' | 'muted';
export const Pill: React.FC<{ tone?: PillTone; children: React.ReactNode; dot?: boolean; sm?: boolean }> = ({
  tone = 'neutral', children, dot = true, sm,
}) => {
  const T = ({
    neutral: ['var(--hotel-neutral-bg)', 'var(--hotel-text-secondary)', 'var(--hotel-text-muted)'],
    blue: ['var(--hotel-info-bg)', 'var(--hotel-info)', 'var(--hotel-info)'],
    indigo: ['var(--hotel-neutral-bg)', 'var(--hotel-chart-4)', 'var(--hotel-chart-4)'],
    amber: ['var(--hotel-warning-bg)', 'var(--hotel-warning)', 'var(--hotel-warning)'],
    green: ['var(--hotel-success-bg)', 'var(--hotel-success)', 'var(--hotel-success)'],
    red: ['var(--hotel-danger-bg)', 'var(--hotel-danger)', 'var(--hotel-danger)'],
    muted: ['var(--hotel-neutral-bg)', 'var(--hotel-neutral)', 'var(--hotel-neutral)'],
  } as Record<PillTone, string[]>)[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, background: T[0], color: T[1],
      padding: sm ? '1px 7px' : '2px 9px', fontSize: sm ? 10 : 10.5, fontWeight: 700,
      letterSpacing: 0.3, textTransform: 'uppercase', borderRadius: 100, whiteSpace: 'nowrap',
    }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: T[2] }} />}
      {children}
    </span>
  );
};
