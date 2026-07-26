import React, { useState } from 'react';
import { Alert, Skeleton, Box } from '@mui/material';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useAuth } from '../../../../auth/AuthContext';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { Icon, IconName } from './Icon';
import { Sparkline, Delta, LineAreaChart, Donut, BarRows } from './charts';
import { ReportsFormatProvider, useReportsFormat } from './formatContext';
import { useReportsModel, prevOf, Kpi, KpiKind, Unit } from './reportsModel';
import { OutstandingDrawer, OccupancyDrawer, RevenueDrawer, FlowDrawer, DrawerState } from './drawers';
import './reports.css';

type Compare = 'prev' | 'month' | 'year';
const COMPARE_CAPTION: Record<Compare, string> = {
  prev: 'vs previous 30 days',
  month: 'vs same period last month',
  year: 'vs same period last year',
};

// ---------- small presentational atoms ----------
const Seg: React.FC<{ value: Compare; onChange: (v: Compare) => void; options: { v: Compare; l: string }[] }> = ({ value, onChange, options }) => (
  <div className="seg">
    {options.map((o) => (
      <button key={o.v} className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>
    ))}
  </div>
);

const FPill: React.FC<{ icon?: IconName; label: string; value?: string; dot?: string }> = ({ icon, label, value, dot }) => (
  <button className="fpill">
    {icon && <Icon name={icon} size={14} />}
    {dot && <span className="fdot" style={{ background: dot }} />}
    <span className="fl">{label}</span>
    {value && <span className="fv">{value}</span>}
    <Icon name="chev-down" size={13} />
  </button>
);

const Locked: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => (
  <div className="locked">
    <div className="locked-blur">{children}</div>
    <div className="locked-veil">
      <div className="locked-chip"><Icon name="lock" size={13} /> {label || 'Restricted'}</div>
    </div>
  </div>
);

const Legend: React.FC<{ items: { label: string; color: string }[] }> = ({ items }) => (
  <div className="legend">
    {items.map((it, i) => (
      <span className="legend-i" key={i}><span className="legend-d" style={{ background: it.color }} />{it.label}</span>
    ))}
  </div>
);

const Panel: React.FC<{
  title: string; icon?: IconName; sub?: string; right?: React.ReactNode;
  children: React.ReactNode; clickable?: boolean; onClick?: () => void;
}> = ({ title, icon, sub, right, children, clickable, onClick }) => (
  <section className="cpanel" data-clickable={!!clickable} onClick={clickable ? onClick : undefined}>
    <div className="cpanel-h">
      <div className="cpanel-t">
        {icon && <span className="cpanel-ico"><Icon name={icon} size={15} /></span>}
        <div className="cpanel-tt">
          <div className="cpanel-title">{title}</div>
          {sub && <div className="cpanel-sub">{sub}</div>}
        </div>
      </div>
      {right}
    </div>
    <div className="cpanel-b">{children}</div>
  </section>
);

const LiveTile: React.FC<{ icon: IconName; n: React.ReactNode; label: string; tone: string; onClick?: () => void; suffix?: string }> = ({ icon, n, label, tone, onClick, suffix }) => (
  <button className={'livetile t-' + tone} onClick={onClick} data-clickable={!!onClick}>
    <span className="lt-ico"><Icon name={icon} size={16} /></span>
    <span className="lt-n">{n}{suffix}</span>
    <span className="lt-l">{label}{onClick && <Icon name="chev-right" size={12} />}</span>
  </button>
);

interface KpiCardProps {
  icon: IconName; label: string; kpi: Kpi; kind: KpiKind; unit: Unit;
  accent: string; showDeltas: boolean; compare: Compare; onClick: () => void; locked?: boolean;
}
const KpiCard: React.FC<KpiCardProps> = ({ icon, label, kpi, kind, unit, accent, showDeltas, compare, onClick, locked }) => {
  const { fmtMoney, fmtInt, fmtPct } = useReportsFormat();
  const display = unit === '%' ? fmtPct(kpi.value) : unit === 'RM' ? fmtMoney(kpi.value) : fmtInt(kpi.value);
  const prev = prevOf(kpi, kind, compare);
  const inner = (
    <button className="kpi" onClick={locked ? undefined : onClick} data-clickable={!locked}>
      <div className="kpi-top">
        <span className="kpi-ico" style={{ color: accent }}><Icon name={icon} size={15} /></span>
        <span className="kpi-lbl">{label}</span>
        {!locked && <Icon name="arrow-up-right" size={13} style={{ color: 'var(--ink-4)', marginLeft: 'auto' }} />}
      </div>
      <div className="kpi-val">{display}</div>
      <div className="kpi-foot">
        {showDeltas
          ? <Delta cur={kpi.value} prev={prev} pp={unit === '%'} invert={kind === 'outstanding'} />
          : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>&nbsp;</span>}
        <span className="kpi-cmp">{COMPARE_CAPTION[compare]}</span>
      </div>
      <div className="kpi-spark"><Sparkline data={kpi.spark} color={accent} w={210} h={34} /></div>
    </button>
  );
  return locked ? <Locked label="Finance only">{inner}</Locked> : inner;
};

const MiniList: React.FC<{ rows: { name: string; sub: string; side: string; sideTone?: 'due' | 'ok'; sideMono?: boolean }[] }> = ({ rows }) => (
  <div className="minilist">
    {rows.map((r, i) => (
      <div className="ml-row" key={i}>
        <div className="ml-l">
          <div className="ml-name">{r.name}</div>
          <div className="ml-sub">{r.sub}</div>
        </div>
        <div className={'ml-side' + (r.sideTone === 'due' ? ' due' : r.sideTone === 'ok' ? ' ok' : '') + (r.sideMono ? ' mono' : '')}>{r.side}</div>
      </div>
    ))}
  </div>
);

// ---------- main ----------
const accent = 'var(--emerald)';

const ReportsAnalyticsInner: React.FC = () => {
  const { hasPermission, hasRole } = useAuth();
  const { fmtMoney, fmtMoneyK, fmtPct } = useReportsFormat();
  const { model, loading, error } = useReportsModel();
  const [compare, setCompare] = useState<Compare>('prev');
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const hotelName = getHotelSettings().hotel_name;

  const canViewFinancials =
    hasPermission('ledgers:read') || hasRole('admin') || hasRole('super_admin') || hasRole('manager');

  const open = (d: NonNullable<DrawerState>) => setDrawer(d);
  const close = () => setDrawer(null);

  if (error) {
    return <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>;
  }

  const sourceTotal = model.sources.reduce((a, s) => a + s.value, 0);
  const k = model.kpis;

  const headerActions = (
    <div className="ph-actions">
      <span className="role-pill">
        <Icon name="lock" size={13} />
        {canViewFinancials ? 'Full access' : 'Scoped access'}
      </span>
      <button className="btn"><Icon name="download" size={14} /> Export</button>
      <button className="btn icon" title="Print" onClick={() => window.print()}><Icon name="print" size={15} /></button>
    </div>
  );

  return (
    <div className="salim-reports" data-density="comfortable">
      <div className="ph">
        <div className="ph-left">
          <div className="crumbs">{hotelName} <span className="sep">›</span> Reports <span className="sep">›</span> Analytics</div>
          <h1>Reports &amp; Analytics</h1>
          <div className="sub">Combined operational &amp; financial overview · Main Property</div>
        </div>
        {headerActions}
      </div>

      {/* FILTERS */}
      <div className="filters">
        <FPill icon="calendar" label="Last 30 days" />
        <FPill icon="building" label="Property" value="Main" />
        <FPill icon="bed" label="Room type" value="All" />
        <FPill icon="globe" label="Source" value="All" />
        <FPill icon="filter" label="Status" value="All" />
        <div className="filters-spacer" />
        <div className="cmp">
          <span className="cmp-l">Compare</span>
          <Seg value={compare} onChange={setCompare} options={[
            { v: 'prev', l: 'Prev period' }, { v: 'month', l: 'Last month' }, { v: 'year', l: 'Last year' },
          ]} />
        </div>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* LIVE OPERATIONAL STRIP */}
          <section className="live">
            <div className="live-h">
              <span className="live-dot" data-pulse="true" />
              <span className="live-title">Today · Live</span>
              <span className="live-date">{model.todayLabel}</span>
              <span className="live-upd"><Icon name="refresh" size={12} /> Updated {model.live.updated} · auto-refresh</span>
            </div>
            <div className="live-tiles">
              <LiveTile icon="login" n={model.live.arrivals} label="Arrivals" tone="blue"
                onClick={() => open({ type: 'flow', mode: 'arrivals' })} />
              <LiveTile icon="logout" n={model.live.departures} label="Departures" tone="indigo"
                onClick={() => open({ type: 'flow', mode: 'departures' })} />
              <LiveTile icon="users" n={model.live.inHouse} label="In-house guests" tone="emerald" />
              <LiveTile icon="gauge" n={fmtPct(model.live.occNow, 0).replace('%', '')} suffix="%" label="Occupancy now" tone="amber"
                onClick={() => open({ type: 'occupancy' })} />
              <LiveTile icon="broom" n={model.live.toClean} label="Rooms to clean" tone="rose" />
              <LiveTile icon="door" n={model.live.unassigned} label="Unassigned" tone="neutral" />
            </div>
          </section>

          {/* KPI CARDS */}
          <div className="kpis">
            <KpiCard icon="percent" label="Occupancy rate" kpi={k.occupancy} kind="occupancy" unit="%"
              accent={accent} showDeltas compare={compare} onClick={() => open({ type: 'occupancy' })} />
            <KpiCard icon="gauge" label="ADR" kpi={k.adr} kind="adr" unit="RM"
              accent={accent} showDeltas compare={compare} onClick={() => open({ type: 'revenue', metric: 'adr' })} locked={!canViewFinancials} />
            <KpiCard icon="gauge" label="RevPAR" kpi={k.revpar} kind="revpar" unit="RM"
              accent={accent} showDeltas compare={compare} onClick={() => open({ type: 'revenue', metric: 'revpar' })} locked={!canViewFinancials} />
            <KpiCard icon="coins" label="Room revenue" kpi={k.roomRev} kind="roomRev" unit="RM"
              accent={accent} showDeltas compare={compare} onClick={() => open({ type: 'revenue', metric: 'roomRev' })} locked={!canViewFinancials} />
            <KpiCard icon="coins" label="Total revenue" kpi={k.totalRev} kind="totalRev" unit="RM"
              accent={accent} showDeltas compare={compare} onClick={() => open({ type: 'revenue', metric: 'totalRev' })} locked={!canViewFinancials} />
            <KpiCard icon="wallet" label="Outstanding" kpi={k.outstanding} kind="outstanding" unit="RM"
              accent={accent} showDeltas compare={compare} onClick={() => open({ type: 'outstanding' })} locked={!canViewFinancials} />
          </div>

          {/* CHARTS — revenue trend + source mix */}
          <div className="chart-row two">
            {canViewFinancials ? (
              <Panel title="Daily revenue trend" icon="chart"
                sub={`Room ${fmtMoneyK(model.roomRev)} · Other ${fmtMoneyK(model.otherRev)} · last 30 days`}
                right={<Legend items={[{ label: 'Room revenue', color: 'var(--emerald)' }, { label: 'Other revenue', color: 'var(--blue)' }]} />}>
                <LineAreaChart data={model.daily} height={250}
                  series={[{ key: 'room', color: 'var(--emerald)', fill: true }, { key: 'other', color: 'var(--blue)', fill: true }]}
                  yFmt={(v) => fmtMoneyK(v)} xEvery={5} />
              </Panel>
            ) : (
              <Panel title="Daily revenue trend" icon="chart" sub="Revenue analytics">
                <Locked label="Finance only"><div style={{ height: 250 }} /></Locked>
              </Panel>
            )}

            {canViewFinancials ? (
              <Panel title="Booking source mix" icon="globe" sub="By room revenue">
                <div className="donut-wrap">
                  <Donut data={model.sources} centerTop={fmtMoneyK(sourceTotal)} centerSub="Total" />
                  <div className="donut-leg">
                    {model.sources.map((s, i) => (
                      <div className="dl-row" key={i}>
                        <span className="dl-dot" style={{ background: s.color.startsWith('var(') ? undefined : s.color }} />
                        <span className="dl-lbl">{s.label}</span>
                        <span className="dl-pct">{((s.value / sourceTotal) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel title="Booking source mix" icon="globe">
                <Locked label="Finance only"><div style={{ height: 200 }} /></Locked>
              </Panel>
            )}
          </div>

          {/* CHARTS — occupancy trend + room type */}
          <div className="chart-row two">
            <Panel title="Occupancy trend" icon="percent"
              sub={`Avg ${fmtPct(k.occupancy.value)} · ${model.periodRooms} rooms · last 30 days`}
              right={<Legend items={[{ label: 'Daily occupancy', color: accent }]} />}>
              <LineAreaChart data={model.daily} height={230} pct
                series={[{ key: 'occ', color: accent, fill: true }]}
                yFmt={(v) => v + '%'} xEvery={5} />
            </Panel>

            {canViewFinancials ? (
              <Panel title="Room type performance" icon="bed" sub="By revenue">
                <BarRows rows={model.roomTypes.map((r) => ({
                  label: r.type, value: r.rev, color: 'var(--emerald)',
                  display: fmtMoneyK(r.rev), sub: `${fmtPct(r.occ, 0)} occ · ${fmtMoney(r.adr)} ADR`,
                }))} />
              </Panel>
            ) : (
              <Panel title="Room type performance" icon="bed">
                <Locked label="Finance only"><div style={{ height: 200 }} /></Locked>
              </Panel>
            )}
          </div>

          {/* CHARTS — ageing + arrivals + departures */}
          <div className="chart-row thirds">
            {canViewFinancials ? (
              <Panel title="Outstanding ageing" icon="wallet" clickable onClick={() => open({ type: 'outstanding' })}
                sub="Click to drill down" right={<Icon name="arrow-up-right" size={14} style={{ color: 'var(--ink-4)' }} />}>
                <BarRows rows={model.ageing.map((a) => ({
                  label: a.bucket, value: a.value, color: a.color, display: fmtMoneyK(a.value),
                }))} />
              </Panel>
            ) : (
              <Panel title="Outstanding ageing" icon="wallet">
                <Locked label="Finance only"><div style={{ height: 160 }} /></Locked>
              </Panel>
            )}

            <Panel title="Arrivals today" icon="login" sub={model.live.arrivals + ' expected'}
              right={<button className="link-btn" onClick={() => open({ type: 'flow', mode: 'arrivals' })}>View all <Icon name="chev-right" size={12} /></button>}>
              <MiniList rows={model.arrivals.slice(0, 4).map((r) => ({ name: r.name, sub: r.type + ' · ' + r.source, side: r.eta, sideMono: true }))} />
            </Panel>

            <Panel title="Departures today" icon="logout" sub={model.live.departures + ' expected'}
              right={<button className="link-btn" onClick={() => open({ type: 'flow', mode: 'departures' })}>View all <Icon name="chev-right" size={12} /></button>}>
              <MiniList rows={model.departures.slice(0, 4).map((r) => ({
                name: r.name, sub: 'Room ' + r.room + ' · ' + r.out,
                side: r.bal > 0 ? fmtMoney(r.bal) : 'Settled', sideTone: r.bal > 0 ? 'due' : 'ok',
              }))} />
            </Panel>
          </div>

          <div className="foot-note">
            <Icon name="info" size={13} />
            Operational tiles (arrivals, departures, in-house, occupancy, housekeeping) reflect live booking and room data. Financial breakdowns — ADR/RevPAR, booking-source mix, outstanding ageing and per-type revenue — are illustrative sample figures pending the analytics endpoints.
          </div>
        </>
      )}

      {/* DRAWERS */}
      <OutstandingDrawer open={drawer?.type === 'outstanding'} onClose={close} model={model} />
      <OccupancyDrawer open={drawer?.type === 'occupancy'} onClose={close} model={model} />
      <RevenueDrawer open={drawer?.type === 'revenue'} onClose={close} metric={drawer?.type === 'revenue' ? drawer.metric : undefined} model={model} />
      <FlowDrawer open={drawer?.type === 'flow'} onClose={close} mode={drawer?.type === 'flow' ? drawer.mode : undefined} model={model} />
    </div>
  );
};

const DashboardSkeleton: React.FC = () => (
  <Box>
    <Skeleton variant="rectangular" height={96} sx={{ borderRadius: '14px', mb: 2 }} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(6, 1fr)' }, gap: 1.5, mb: 2 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={148} sx={{ borderRadius: '13px' }} />
      ))}
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2 }}>
      <Skeleton variant="rectangular" height={300} sx={{ borderRadius: '14px' }} />
      <Skeleton variant="rectangular" height={300} sx={{ borderRadius: '14px' }} />
    </Box>
  </Box>
);

const ReportsAnalytics: React.FC = () => {
  const { symbol } = useCurrency();
  return (
    <ReportsFormatProvider symbol={symbol}>
      <ReportsAnalyticsInner />
    </ReportsFormatProvider>
  );
};

export default ReportsAnalytics;
