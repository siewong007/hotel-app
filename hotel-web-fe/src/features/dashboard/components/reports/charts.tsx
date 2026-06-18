import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

// Palette mirrors the CSS custom properties in reports.css so SVG fills can use
// the same `var(--x)` tokens the design data is authored with.
const PALETTE: Record<string, string> = {
  bg: '#F4F6F8', surface: '#FFFFFF', 'surface-2': '#F8FAFB', 'surface-3': '#EFF2F5',
  border: '#E2E6EC', 'border-hi': '#CBD2DA',
  ink: '#0F172A', 'ink-2': '#475569', 'ink-3': '#7B8794', 'ink-4': '#B0B8C2',
  emerald: '#10A47C', 'emerald-deep': '#0E8C6A', 'emerald-soft': '#E7F5EF',
  blue: '#2F7DE1', 'blue-soft': '#E8F1FB',
  indigo: '#7A6BE2', 'indigo-soft': '#ECEAFB',
  amber: '#C8941D', 'amber-soft': '#FBF1DC',
  rose: '#D14256', 'rose-soft': '#FCE8EC',
  good: '#0E7A48', bad: '#B53047',
};

/** Resolve a `var(--token)` string to a real color; pass through literal colors. */
export function cssVar(v: string): string {
  if (!v || v.slice(0, 4) !== 'var(') return v;
  const name = v.slice(4, -1).trim().replace(/^--/, '');
  return PALETTE[name] || '#888';
}

/** Measure container width so SVGs render at true pixel size (no stroke distortion). */
export function useMeasure(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
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

export const Delta: React.FC<{ cur: number; prev: number; pp?: boolean; invert?: boolean; suffix?: string }> = ({
  cur, prev, pp = false, invert = false, suffix = '',
}) => {
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
    neutral: ['#F0F3F7', '#475569', '#94A3B8'], blue: ['#E5F0FB', '#1F66C9', '#2F7DE1'],
    indigo: ['#ECEAFB', '#5743C8', '#7A6BE2'], amber: ['#FBF1DC', '#9A6A0E', '#C8941D'],
    green: ['#E1F4EA', '#0E7A48', '#16A364'], red: ['#FCE5E9', '#B53047', '#D14256'],
    muted: ['#EFF1F4', '#94A3B8', '#B0B8C2'],
  } as Record<PillTone, string[]>)[tone] || ['#F0F3F7', '#475569', '#94A3B8'];
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

// ---------- Sparkline (KPI cards) ----------
export const Sparkline: React.FC<{ data: number[]; color?: string; w?: number; h?: number; fill?: boolean }> = ({
  data, color = 'var(--emerald)', w = 96, h = 30, fill = true,
}) => {
  const id = useMemo(() => 'sp' + Math.random().toString(36).slice(2, 8), []);
  if (!data || data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - 3 - ((v - min) / rng) * (h - 6),
  ]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={cssVar(color)} stopOpacity="0.22" />
        <stop offset="1" stopColor={cssVar(color)} stopOpacity="0" />
      </linearGradient></defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={cssVar(color)} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={cssVar(color)} />
    </svg>
  );
};

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag * Math.ceil(v / (step * mag));
}

// ---------- Line / area chart (revenue & occupancy trends) ----------
export interface ChartSeries { key: string; color: string; fill?: boolean }
export const LineAreaChart: React.FC<{
  data: Record<string, any>[];
  series: ChartSeries[];
  height?: number;
  yFmt?: (v: number) => string;
  yTicks?: number;
  xEvery?: number;
  pct?: boolean;
}> = ({ data, series, height = 230, yFmt = (v) => String(v), yTicks = 4, xEvery = 5, pct = false }) => {
  const [ref, w] = useMeasure();
  const padL = 52, padR = 14, padT = 14, padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;

  let maxV = 0;
  series.forEach((s) => data.forEach((d) => { if (d[s.key] > maxV) maxV = d[s.key]; }));
  const top = pct ? 100 : niceMax(maxV);
  const x = (i: number) => padL + (i / (data.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / top) * ih;

  const ticks: number[] = [];
  for (let i = 0; i <= yTicks; i++) ticks.push((top / yTicks) * i);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={'g_' + s.key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={cssVar(s.color)} stopOpacity={s.fill ? 0.2 : 0.12} />
                <stop offset="1" stopColor={cssVar(s.color)} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={y(t)} x2={w - padR} y2={y(t)} stroke="#E2E6EC" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '3 4'} />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="ch-axis">{yFmt(t)}</text>
            </g>
          ))}
          {data.map((d, i) => (i % xEvery === 0 || i === data.length - 1) ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="ch-axis">{d.label}</text>
          ) : null)}
          {series.map((s) => {
            const line = data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[s.key]).toFixed(1)).join(' ');
            const area = line + ` L ${x(data.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;
            return <path key={'a' + s.key} d={area} fill={`url(#g_${s.key})`} />;
          })}
          {series.map((s) => {
            const line = data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[s.key]).toFixed(1)).join(' ');
            return <path key={'l' + s.key} d={line} fill="none" stroke={cssVar(s.color)} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />;
          })}
          {series.map((s) => (
            <circle key={'d' + s.key} cx={x(data.length - 1)} cy={y(data[data.length - 1][s.key])} r="3.2" fill="#fff" stroke={cssVar(s.color)} strokeWidth="2.2" />
          ))}
        </svg>
      )}
    </div>
  );
};

// ---------- Donut (booking source mix) ----------
export const Donut: React.FC<{
  data: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerSub?: string;
}> = ({ data, size = 168, thickness = 26, centerTop, centerSub }) => {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <g transform={`rotate(-90 ${c} ${c})`}>
        {data.map((d, i) => {
          const frac = d.value / total;
          const len = frac * circ;
          // Offset = cumulative length of all preceding segments (no render-time mutation).
          const off = data.slice(0, i).reduce((a, x) => a + (x.value / total) * circ, 0);
          return (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={cssVar(d.color)}
              strokeWidth={thickness} strokeDasharray={`${len - 2} ${circ - len + 2}`}
              strokeDashoffset={-off} strokeLinecap="butt" />
          );
        })}
      </g>
      {centerTop && <text x={c} y={c - 2} textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: '#0F172A', fontFamily: '"JetBrains Mono", monospace' }}>{centerTop}</text>}
      {centerSub && <text x={c} y={c + 16} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: '#7B8794', letterSpacing: 0.5, textTransform: 'uppercase' }}>{centerSub}</text>}
    </svg>
  );
};

// ---------- Horizontal bar rows (room types, ageing) ----------
export interface BarRow { label: string; value: number; color: string; display: string; sub?: string; onClick?: () => void }
export const BarRows: React.FC<{ rows: BarRow[] }> = ({ rows }) => {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="barrows">
      {rows.map((r, i) => (
        <div className="barrow" key={i} onClick={r.onClick} style={{ cursor: r.onClick ? 'pointer' : 'default' }}>
          <div className="barrow-l">
            <span className="barrow-lbl">{r.label}</span>
            {r.sub && <span className="barrow-sub">{r.sub}</span>}
          </div>
          <div className="barrow-track">
            <span className="barrow-fill" style={{ width: (r.value / max) * 100 + '%', background: cssVar(r.color) }} />
          </div>
          <div className="barrow-v">{r.display}</div>
        </div>
      ))}
    </div>
  );
};
