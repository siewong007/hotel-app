import React, { useMemo, useState } from 'react';
import { Alert, Skeleton, Box } from '@mui/material';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { CollapsibleSection } from '../../../../components/common/CollapsibleSection';
import { useAuth } from '../../../../auth/AuthContext';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import {
  ChartStateGate,
  HotelBarChart,
  HotelLineChart,
  HotelPieChart,
  HotelSparkline,
  fmtShortDate,
  thinTicks,
  useTickBudget,
  useChartTheme,
} from '../../../../components/charts';
import { Icon, IconName } from './Icon';
import { AGEING_TONE, Delta } from './charts';
import { ReportsFormatProvider, useReportsFormat } from './formatContext';
import { useReportsModel, Kpi, KpiKind, Unit, CompareMode, RangeDays, ReportsQuery } from './reportsModel';
import { OutstandingDrawer, OccupancyDrawer, RevenueDrawer, FlowDrawer, DrawerState } from './drawers';
import './reports.css';

const RANGE_OPTIONS: { v: RangeDays; l: string }[] = [
  { v: 7, l: '7 days' }, { v: 30, l: '30 days' }, { v: 90, l: '90 days' },
];

const compareCaption = (compare: CompareMode, rangeDays: RangeDays): string =>
  compare === 'month'
    ? 'vs same period last month'
    : compare === 'year'
      ? 'vs same period last year'
      : `vs previous ${rangeDays} days`;

// ---------- small presentational atoms ----------
function Seg<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

/** A real filter control in the old fpill shape: icon + label + <select>. */
const FSelect: React.FC<{
  icon: IconName;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}> = ({ icon, label, value, onChange, options }) => (
  <label className="fpill fpill-select">
    <Icon name={icon} size={14} />
    <span className="fl">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
    <Icon name="chev-down" size={13} />
  </label>
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
  /** On phones, render the panel headless inside a CollapsibleSection whose
      header carries the title — progressive disclosure for the stacked
      chart panels. Desktop markup is untouched. */
  phoneCollapsible?: boolean;
  /** With `phoneCollapsible`: start collapsed on phone viewports. */
  collapseOnPhone?: boolean;
}> = ({ title, icon, sub, right, children, clickable, onClick, phoneCollapsible, collapseOnPhone }) => {
  const isPhone = useIsPhone();
  if (isPhone && phoneCollapsible) {
    return (
      <CollapsibleSection
        title={
          <span className="cpanel-ptitle">
            {icon && <Icon name={icon} size={14} />}
            {title}
          </span>
        }
        subtitle={sub}
        collapseOnPhone={collapseOnPhone}
      >
        <section className="cpanel" data-clickable={!!clickable} onClick={clickable ? onClick : undefined}>
          <div className="cpanel-b">
            {/* header extras (legends, drill-in arrows) move into the body so
                the collapse header stays a single tap target */}
            {right && <div className="cpanel-tools">{right}</div>}
            {children}
          </div>
        </section>
      </CollapsibleSection>
    );
  }
  return (
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
};

const LiveTile: React.FC<{ icon: IconName; n: React.ReactNode; label: string; tone: string; onClick?: () => void; suffix?: string }> = ({ icon, n, label, tone, onClick, suffix }) => (
  <button className={'livetile t-' + tone} onClick={onClick} data-clickable={!!onClick}>
    <span className="lt-ico"><Icon name={icon} size={16} /></span>
    <span className="lt-n">{n}{suffix}</span>
    <span className="lt-l">{label}{onClick && <Icon name="chev-right" size={12} />}</span>
  </button>
);

interface KpiCardProps {
  icon: IconName; label: string; kpi: Kpi; kind: KpiKind; unit: Unit;
  accent: string; showDeltas: boolean; compareCaption: string; onClick: () => void; locked?: boolean;
}
const KpiCard: React.FC<KpiCardProps> = ({ icon, label, kpi, kind, unit, accent, showDeltas, compareCaption, onClick, locked }) => {
  const { fmtMoney, fmtInt, fmtPct } = useReportsFormat();
  const display = unit === '%' ? fmtPct(kpi.value) : unit === 'RM' ? fmtMoney(kpi.value) : fmtInt(kpi.value);
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
          ? <Delta cur={kpi.value} prev={kpi.prev} pp={unit === '%'} invert={kind === 'outstanding'} />
          : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>&nbsp;</span>}
        <span className="kpi-cmp">{compareCaption}</span>
      </div>
      <div className="kpi-spark">
        <HotelSparkline values={kpi.spark} color={accent} height={34} ariaLabel={`${label} trend`} />
      </div>
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
const ReportsAnalyticsInner: React.FC = () => {
  const { hasPermission, hasRole } = useAuth();
  const { fmtMoney, fmtMoneyK, fmtInt, fmtPct } = useReportsFormat();
  const { palette, status } = useChartTheme();
  const accent = palette[0];
  const isPhone = useIsPhone();
  const tickBudget = useTickBudget();
  const [query, setQuery] = useState<ReportsQuery>({ rangeDays: 30, compare: 'prev' });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const hotelName = getHotelSettings().hotel_name;

  const canViewRevenue =
    hasPermission('revenue:read') || hasRole('admin') || hasRole('super_admin') || hasRole('manager');
  const canViewFinancials =
    hasPermission('ledgers:read') || hasRole('admin') || hasRole('super_admin') || hasRole('manager');

  const { model, loading, liveLoading, error } = useReportsModel(query, canViewRevenue);

  const open = (d: NonNullable<DrawerState>) => setDrawer(d);
  const close = () => setDrawer(null);

  if (error) {
    return <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>;
  }

  const sourceTotal = model.sources.reduce((a, s) => a + s.value, 0);
  const sourceBookings = (label: string) =>
    model.sources.find((s) => s.label === label)?.bookings ?? 0;
  const cmpCaption = compareCaption(query.compare, query.rangeDays);
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

      {/* FILTERS — all wired: range + compare always work; room-type/source
          selects only offer values that exist in the loaded data. */}
      <div className="filters">
        <Seg value={query.rangeDays} onChange={(rangeDays) => setQuery((q) => ({ ...q, rangeDays }))} options={RANGE_OPTIONS} />
        {!isPhone && (
          <>
            <FSelect icon="bed" label="Room type" value={String(query.roomTypeId ?? 'all')}
              onChange={(v) => setQuery((q) => ({ ...q, roomTypeId: v === 'all' ? undefined : Number(v) }))}
              options={[
                { value: 'all', label: 'All' },
                ...model.roomTypes.map((r) => ({ value: String(r.id), label: r.type })),
              ]} />
            <FSelect icon="globe" label="Source" value={String(query.channelId ?? 'all')}
              onChange={(v) => setQuery((q) => ({ ...q, channelId: v === 'all' ? undefined : Number(v) }))}
              options={[
                { value: 'all', label: 'All' },
                ...model.sources.filter((s) => s.channelId != null)
                  .map((s) => ({ value: String(s.channelId), label: s.label })),
              ]} />
            <div className="filters-spacer" />
          </>
        )}
        <div className="cmp">
          <span className="cmp-l">Compare</span>
          <Seg value={query.compare} onChange={(compare) => setQuery((q) => ({ ...q, compare }))} options={[
            { v: 'prev' as CompareMode, l: 'Prev period' }, { v: 'month' as CompareMode, l: 'Last month' }, { v: 'year' as CompareMode, l: 'Last year' },
          ]} />
        </div>
      </div>

      {liveLoading ? (
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
              accent={accent} showDeltas compareCaption={cmpCaption} onClick={() => open({ type: 'occupancy' })} />
            <KpiCard icon="gauge" label="ADR" kpi={k.adr} kind="adr" unit="RM"
              accent={accent} showDeltas compareCaption={cmpCaption} onClick={() => open({ type: 'revenue', metric: 'adr' })} locked={!canViewFinancials} />
            <KpiCard icon="gauge" label="RevPAR" kpi={k.revpar} kind="revpar" unit="RM"
              accent={accent} showDeltas compareCaption={cmpCaption} onClick={() => open({ type: 'revenue', metric: 'revpar' })} locked={!canViewFinancials} />
            <KpiCard icon="coins" label="Room revenue" kpi={k.roomRev} kind="roomRev" unit="RM"
              accent={accent} showDeltas compareCaption={cmpCaption} onClick={() => open({ type: 'revenue', metric: 'roomRev' })} locked={!canViewFinancials} />
            <KpiCard icon="coins" label="Total revenue" kpi={k.totalRev} kind="totalRev" unit="RM"
              accent={accent} showDeltas compareCaption={cmpCaption} onClick={() => open({ type: 'revenue', metric: 'totalRev' })} locked={!canViewFinancials} />
            <KpiCard icon="wallet" label="Outstanding" kpi={k.outstanding} kind="outstanding" unit="RM"
              accent={accent} showDeltas compareCaption={cmpCaption} onClick={() => open({ type: 'outstanding' })} locked={!canViewFinancials} />
          </div>

          {/* CHARTS — revenue trend + source mix */}
          <div className="chart-row two">
            {canViewFinancials ? (
              <Panel phoneCollapsible title="Daily revenue trend" icon="chart"
                sub={`Room ${fmtMoneyK(model.roomRev)} · Other ${fmtMoneyK(model.otherRev)} · last ${model.periodDays} days`}
                right={<Legend items={[{ label: 'Room revenue', color: palette[0] }, { label: 'Other revenue', color: palette[1] }]} />}>
                <ChartStateGate loading={loading} isEmpty={model.daily.length === 0}>
                  <HotelLineChart
                    height={250}
                    ariaLabel="Daily revenue trend by stay date"
                    data={[
                      { id: 'Room revenue', data: model.daily.map((d) => ({ x: d.date, y: d.room })) },
                      { id: 'Other revenue', data: model.daily.map((d) => ({ x: d.date, y: d.other })) },
                    ]}
                    enableArea
                    areaOpacity={0.14}
                    axisBottom={{ format: fmtShortDate, tickValues: thinTicks(model.daily.map((d) => d.date), tickBudget) }}
                    axisLeft={{ format: fmtMoneyK }}
                    sliceTooltip={({ slice }) => (
                      <div>
                        <strong>{fmtShortDate(String(slice.points[0]?.data.x))}</strong>
                        {slice.points.map((p) => (
                          <div key={p.seriesId} style={{ color: p.seriesColor }}>
                            {p.seriesId}: {fmtMoney(Number(p.data.y))}
                          </div>
                        ))}
                        <div>Occupancy: {fmtPct(model.daily[slice.points[0]?.indexInSeries ?? 0]?.occ ?? 0)}</div>
                      </div>
                    )}
                  />
                </ChartStateGate>
              </Panel>
            ) : (
              <Panel phoneCollapsible title="Daily revenue trend" icon="chart" sub="Revenue analytics">
                <Locked label="Finance only"><div style={{ height: 250 }} /></Locked>
              </Panel>
            )}

            {canViewFinancials ? (
              <Panel phoneCollapsible collapseOnPhone title="Booking source mix" icon="globe" sub="By net revenue · booking creation dates">
                <ChartStateGate loading={loading} isEmpty={model.sources.length === 0}>
                  <div className="donut-wrap">
                    <div className="donut-chart">
                      <HotelPieChart
                        height={190}
                        data={model.sources.map((s) => ({ id: s.label, value: s.value }))}
                        tooltip={({ datum }) => (
                          <div>
                            <strong>{String(datum.id)}</strong>
                            <div>{fmtMoney(Number(datum.value))}</div>
                            <div>{fmtInt(sourceBookings(String(datum.id)))} bookings</div>
                          </div>
                        )}
                      />
                      <div className="donut-center">
                        <div className="dc-v">{fmtMoneyK(sourceTotal)}</div>
                        <div className="dc-l">Total</div>
                      </div>
                    </div>
                    <div className="donut-leg">
                      {model.sources.map((s, i) => (
                        <div className="dl-row" key={i}>
                          <span className="dl-dot" style={{ background: palette[i % palette.length] }} />
                          <span className="dl-lbl">{s.label}</span>
                          <span className="dl-pct">{sourceTotal ? ((s.value / sourceTotal) * 100).toFixed(0) : 0}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartStateGate>
              </Panel>
            ) : (
              <Panel phoneCollapsible collapseOnPhone title="Booking source mix" icon="globe">
                <Locked label="Finance only"><div style={{ height: 200 }} /></Locked>
              </Panel>
            )}
          </div>

          {/* CHARTS — occupancy trend + room type */}
          <div className="chart-row two">
            <Panel phoneCollapsible collapseOnPhone title="Occupancy trend" icon="percent"
              sub={`Avg ${fmtPct(k.occupancy.value)} · ${model.periodRooms} rooms · last ${model.periodDays} days`}
              right={<Legend items={[{ label: 'Daily occupancy', color: accent }]} />}>
              <ChartStateGate loading={loading} isEmpty={model.daily.length === 0}>
                <HotelLineChart
                  height={230}
                  ariaLabel="Daily occupancy rate by stay date"
                  data={[{ id: 'Occupancy', data: model.daily.map((d) => ({ x: d.date, y: d.occ })) }]}
                  colors={[accent]}
                  enableArea
                  areaOpacity={0.16}
                  yScale={{ type: 'linear', min: 0, max: 100, stacked: false }}
                  axisBottom={{ format: fmtShortDate, tickValues: thinTicks(model.daily.map((d) => d.date), tickBudget) }}
                  axisLeft={{ format: (v) => fmtPct(Number(v), 0) }}
                  sliceTooltip={({ slice }) => (
                    <div>
                      <strong>{fmtShortDate(String(slice.points[0]?.data.x))}</strong>
                      <div>Occupancy: {fmtPct(Number(slice.points[0]?.data.y))}</div>
                      <div>{model.daily[slice.points[0]?.indexInSeries ?? 0]?.occRooms ?? 0} rooms sold</div>
                    </div>
                  )}
                />
              </ChartStateGate>
            </Panel>

            {canViewFinancials ? (
              <Panel phoneCollapsible collapseOnPhone title="Room type performance" icon="bed" sub="By room revenue">
                <ChartStateGate loading={loading} isEmpty={model.roomTypes.length === 0}>
                  <HotelBarChart
                    height={Math.max(140, model.roomTypes.length * 46)}
                    layout="horizontal"
                    ariaLabel="Room revenue by room type"
                    data={model.roomTypes.map((r) => ({ type: r.type, rev: r.rev, occ: r.occ, adr: r.adr, rooms: r.rooms }))}
                    keys={['rev']}
                    indexBy="type"
                    colors={[accent]}
                    axisLeft={{ tickSize: 0, tickPadding: 6 }}
                    axisBottom={null}
                    enableGridX={false}
                    enableLabel={false}
                    margin={{ top: 4, right: 8, bottom: 4, left: 96 }}
                    tooltip={({ indexValue, data: d }) => (
                      <div>
                        <strong>{String(indexValue)}</strong>
                        <div>{fmtMoney(Number(d.rev))} room revenue</div>
                        <div>{fmtPct(Number(d.occ), 0)} occupancy · {fmtMoney(Number(d.adr))} ADR</div>
                        <div>{fmtInt(Number(d.rooms))} rooms</div>
                      </div>
                    )}
                  />
                </ChartStateGate>
              </Panel>
            ) : (
              <Panel phoneCollapsible collapseOnPhone title="Room type performance" icon="bed">
                <Locked label="Finance only"><div style={{ height: 200 }} /></Locked>
              </Panel>
            )}
          </div>

          {/* CHARTS — ageing + arrivals + departures */}
          <div className="chart-row thirds">
            {canViewFinancials ? (
              <Panel phoneCollapsible collapseOnPhone title="Outstanding ageing" icon="wallet" clickable onClick={() => open({ type: 'outstanding' })}
                sub="Click to drill down" right={<Icon name="arrow-up-right" size={14} style={{ color: 'var(--ink-4)' }} />}>
                <ChartStateGate loading={loading} isEmpty={model.ageing.every((a) => a.value === 0)}
                  emptyMessage="No open invoices">
                  <HotelBarChart
                    height={Math.max(140, model.ageing.length * 40)}
                    layout="horizontal"
                    ariaLabel="Outstanding invoice ageing"
                    data={model.ageing.map((a) => ({ bucket: a.bucket, value: a.value, key: a.key, count: a.count }))}
                    keys={['value']}
                    indexBy="bucket"
                    colors={({ indexValue }) => {
                      const tone = AGEING_TONE[model.ageing.find((a) => a.bucket === indexValue)?.key ?? ''];
                      return tone ? status[tone] : palette[0];
                    }}
                    axisLeft={{ tickSize: 0, tickPadding: 6 }}
                    axisBottom={null}
                    enableGridX={false}
                    enableLabel={false}
                    margin={{ top: 4, right: 8, bottom: 4, left: 76 }}
                    tooltip={({ indexValue, data: d }) => (
                      <div>
                        <strong>{String(indexValue)}</strong>
                        <div>{fmtMoney(Number(d.value))} · {fmtInt(Number(d.count))} invoices</div>
                      </div>
                    )}
                  />
                </ChartStateGate>
              </Panel>
            ) : (
              <Panel phoneCollapsible collapseOnPhone title="Outstanding ageing" icon="wallet">
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
            Operational tiles (arrivals, departures, in-house, housekeeping) reflect live booking and room data. Revenue, occupancy-trend, channel-mix, per-type and pipeline figures come from revenue analytics — stay dates for trends, booking-creation dates for channel share. Outstanding ageing reads open invoices as of today.
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
