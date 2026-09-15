import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './Icon';
import { AGEING_TONE, Money, Pill } from './charts';
import { HotelBarChart, useChartTheme } from '../../../../components/charts';
import { useReportsFormat } from './formatContext';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { BottomSheet } from '../../../../components/common/BottomSheet';
import { useTranslation } from '../../../../i18n';
import type { ReportsModel } from './reportsModel';

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  icon: IconName;
  title: string;
  sub?: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}

const Drawer: React.FC<DrawerShellProps> = ({ open, onClose, icon, title, sub, children, foot }) => {
  const isPhone = useIsPhone();
  if (isPhone) {
    // Phones get the shared BottomSheet. The .salim-reports-drawer class is
    // kept on the content wrapper so every .dw-* rule and token alias still
    // applies; .salim-reports-sheet strips the fixed side-panel geometry.
    return (
      <BottomSheet open={open} onClose={onClose}
        title={<>{title}{sub && <span className="salim-reports-sheet-sub">{sub}</span>}</>}>
        <div className="salim-reports-drawer salim-reports-sheet">
          <div className="dw-body">{children}</div>
          {foot && <div className="dw-foot">{foot}</div>}
        </div>
      </BottomSheet>
    );
  }
  return createPortal(
    <>
      <div className={'salim-reports-scrim' + (open ? ' is-on' : '')} onClick={onClose} />
      <aside className={'salim-reports-drawer' + (open ? ' is-on' : '')} role="dialog" aria-hidden={!open}>
        {open && (
          <>
            <div className="dw-h">
              <div className="ico"><Icon name={icon} size={18} /></div>
              <div style={{ flex: 1 }}>
                <h2>{title}</h2>
                {sub && <div className="sub">{sub}</div>}
              </div>
              <button className="x" onClick={onClose}><Icon name="x" size={18} /></button>
            </div>
            <div className="dw-body">{children}</div>
            {foot && <div className="dw-foot">{foot}</div>}
          </>
        )}
      </aside>
    </>,
    document.body,
  );
};

function ageTone(a: string) {
  if (a === 'Current') return 'green' as const;
  if (a === '1–30 days' || a === '1_30') return 'blue' as const;
  if (a === '31–60 days' || a === '31_60') return 'amber' as const;
  return 'red' as const;
}

export type DrawerState =
  | { type: 'outstanding' }
  | { type: 'occupancy' }
  | { type: 'revenue'; metric?: string }
  | { type: 'flow'; mode: 'arrivals' | 'departures' }
  | null;

export const OutstandingDrawer: React.FC<{ open: boolean; onClose: () => void; model: ReportsModel }> = ({ open, onClose, model }) => {
  const { t } = useTranslation('dashboard');
  const { fmtMoney, symbol } = useReportsFormat();
  const { palette, status } = useChartTheme();
  const [tab, setTab] = useState<'guests' | 'company'>('guests');
  const total = model.ageing.reduce((a, b) => a + b.value, 0);
  const rows = tab === 'guests' ? model.guestBalances : model.companyBalances;
  return (
    <Drawer open={open} onClose={onClose} icon="wallet" title={t('reports.drawers.outstandingTitle')}
      sub={t('reports.drawers.outstandingSub', { date: model.todayLabel })}
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t('reports.drawers.outstandingSource')}</span>
        <span className="spacer" />
        <button className="btn sm"><Icon name="download" size={13} /> {t('common:actions.export')}</button>
      </>}>
      <div className="dw-big">
        <div className="dw-big-l">{t('reports.drawers.totalOutstanding')}</div>
        <div className="dw-big-v"><Money value={total} tone="due" prefix={symbol} /></div>
      </div>

      <div className="dw-sech">{t('reports.drawers.ageingBuckets')}</div>
      <div className="dw-sec">
        <HotelBarChart
          height={Math.max(160, model.ageing.length * 44)}
          layout="horizontal"
          ariaLabel={t('reports.aria.ageingBuckets')}
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
          margin={{ top: 4, right: 8, bottom: 4, left: 84 }}
          tooltip={({ indexValue, data: d }) => (
            <div>
              <strong>{String(indexValue)}</strong>
              <div>{fmtMoney(Number(d.value))} · {t('reports.tooltip.invoices', { count: Number(d.count) })}</div>
              <div>{t('reports.tooltip.ofTotal', { pct: total > 0 ? ((Number(d.value) / total) * 100).toFixed(0) : 0 })}</div>
            </div>
          )}
        />
      </div>

      <div className="dw-tabs">
        <button className={'dw-tab' + (tab === 'guests' ? ' is-on' : '')} onClick={() => setTab('guests')}>
          <Icon name="user" size={14} /> {t('reports.drawers.guestBalances')} <span className="ct">{model.guestBalances.length}</span>
        </button>
        <button className={'dw-tab' + (tab === 'company' ? ' is-on' : '')} onClick={() => setTab('company')}>
          <Icon name="building" size={14} /> {t('reports.drawers.companyBalances')} <span className="ct">{model.companyBalances.length}</span>
        </button>
      </div>

      <table className="dw-table">
        <thead><tr><th>{tab === 'guests' ? t('reports.drawers.colGuest') : t('reports.drawers.colCompany')}</th><th>{t('reports.drawers.colAgeing')}</th><th className="num">{t('reports.drawers.colBalance')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <div className="dt-name">{r.name}</div>
                <div className="dt-sub mono">{r.ref} · {r.stay || r.terms}</div>
              </td>
              <td><Pill tone={ageTone(r.age)} sm>{r.age}</Pill></td>
              <td className="num"><Money value={r.bal} tone="due" prefix={symbol} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
};

export const OccupancyDrawer: React.FC<{ open: boolean; onClose: () => void; model: ReportsModel }> = ({ open, onClose, model }) => {
  const { t } = useTranslation('dashboard');
  const { fmtPct } = useReportsFormat();
  const { primary, status } = useChartTheme();
  const occupied = model.live.inHouse;
  return (
    <Drawer open={open} onClose={onClose} icon="bed" title={t('reports.drawers.occupancyTitle')}
      sub={t('reports.drawers.occupancySub')}
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t('reports.drawers.occupiedLine', { pct: fmtPct(model.live.occNow), occupied, total: model.periodRooms })}</span>
        <span className="spacer" />
        <button className="btn sm primary"><Icon name="calendar" size={13} /> {t('reports.drawers.openRoomTimeline')}</button>
      </>}>
      <div className="dw-statgrid">
        {model.roomStatus.map((s, i) => (
          <div className="dw-statcell" key={i}>
            <div className="dw-statn" style={{ color: s.color }}>{s.count}</div>
            <div className="dw-statl">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="dw-sech">{t('reports.drawers.occupancyByType')}</div>
      <div className="dw-sec">
        <HotelBarChart
          height={Math.max(140, model.roomTypes.length * 44)}
          layout="horizontal"
          ariaLabel={t('reports.aria.occupancyByType')}
          data={model.roomTypes.map((r) => ({ type: r.type, occ: r.occ, rooms: r.rooms }))}
          keys={['occ']}
          indexBy="type"
          valueScale={{ type: 'linear', min: 0, max: 100 }}
          colors={({ data: d }) =>
            Number(d.occ) >= 80 ? primary : Number(d.occ) >= 60 ? status.info : status.warning
          }
          axisLeft={{ tickSize: 0, tickPadding: 6 }}
          axisBottom={{ tickSize: 0, tickPadding: 6, format: (v) => `${v}%` }}
          enableGridX
          enableLabel={false}
          margin={{ top: 4, right: 16, bottom: 26, left: 96 }}
          tooltip={({ indexValue, data: d }) => (
            <div>
              <strong>{String(indexValue)}</strong>
              <div>{t('reports.drawers.pctOccupied', { pct: fmtPct(Number(d.occ)) })}</div>
              <div>{t('reports.tooltip.rooms', { count: Number(d.rooms) })}</div>
            </div>
          )}
        />
      </div>

      <div className="dw-sech">{t('reports.panels.departuresToday')} <span className="dw-sech-ct">{model.departures.length}</span></div>
      <table className="dw-table">
        <thead><tr><th>{t('reports.drawers.colGuest')}</th><th>{t('reports.drawers.colRoom')}</th><th className="num">{t('reports.drawers.colBalance')}</th></tr></thead>
        <tbody>
          {model.departures.map((d, i) => (
            <tr key={i}>
              <td><div className="dt-name">{d.name}</div><div className="dt-sub">{d.type} · {t('reports.drawers.checkoutAt', { time: d.out })}</div></td>
              <td><span className="mono" style={{ fontWeight: 700 }}>{d.room}</span></td>
              <td className="num"><DepartureBalance bal={d.bal} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
};

const DepartureBalance: React.FC<{ bal: number }> = ({ bal }) => {
  const { t } = useTranslation('dashboard');
  const { symbol } = useReportsFormat();
  return bal > 0 ? <Money value={bal} tone="due" prefix={symbol} /> : <Pill tone="green" sm dot={false}>{t('status:ledger.settled')}</Pill>;
};

export const RevenueDrawer: React.FC<{ open: boolean; onClose: () => void; metric?: string; model: ReportsModel }> = ({ open, onClose, metric, model }) => {
  const { t } = useTranslation('dashboard');
  const { fmtPct, symbol } = useReportsFormat();
  const titleMap: Record<string, [string, IconName]> = {
    roomRev: [t('reports.drawers.revenueTitles.roomRev'), 'coins'], totalRev: [t('reports.drawers.revenueTitles.totalRev'), 'coins'],
    adr: [t('reports.drawers.revenueTitles.adr'), 'gauge'], revpar: [t('reports.drawers.revenueTitles.revpar'), 'gauge'],
  };
  const [title, ic] = titleMap[metric || ''] || [t('reports.drawers.revenueTitles.fallback'), 'coins'];
  return (
    <Drawer open={open} onClose={onClose} icon={ic} title={title}
      sub={t('reports.drawers.revenueSub')}
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t('reports.drawers.earnedDefinition')}</span>
        <span className="spacer" />
        <button className="btn sm"><Icon name="list" size={13} /> {t('reports.drawers.viewBookings')}</button>
      </>}>
      <div className="dw-info">
        <Icon name="info" size={16} />
        <div>{t('reports.drawers.revenueStatesNote')}</div>
      </div>
      <div className="dw-rev">
        {model.revenueStates.map((s, i) => (
          <div className="dw-revrow" key={i}>
            <span className="dw-revdot" style={{ background: s.color }} />
            <div className="dw-revl"><div className="dw-revt">{s.label}</div><div className="dw-revs">{s.desc}</div></div>
            <div className="dw-revv"><Money value={s.value} prefix={symbol} /></div>
          </div>
        ))}
      </div>

      <div className="dw-sech">{t('reports.drawers.byRoomType')}</div>
      <table className="dw-table">
        <thead><tr><th>{t('reports.drawers.colType')}</th><th className="num">{t('reports.drawers.colAdr')}</th><th className="num">{t('reports.drawers.colOcc')}</th><th className="num">{t('reports.drawers.colRevenue')}</th></tr></thead>
        <tbody>
          {model.roomTypes.map((r, i) => (
            <tr key={i}>
              <td><div className="dt-name">{r.type}</div><div className="dt-sub">{t('reports.tooltip.rooms', { count: r.rooms })}</div></td>
              <td className="num"><Money value={r.adr} prefix={symbol} /></td>
              <td className="num mono" style={{ fontWeight: 700 }}>{fmtPct(r.occ, 0)}</td>
              <td className="num"><Money value={r.rev} prefix={symbol} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
};

export const FlowDrawer: React.FC<{ open: boolean; onClose: () => void; mode?: 'arrivals' | 'departures'; model: ReportsModel }> = ({ open, onClose, mode, model }) => {
  const { t } = useTranslation('dashboard');
  const { symbol } = useReportsFormat();
  const isArr = mode === 'arrivals';
  const rows = isArr ? model.arrivals : model.departures;
  return (
    <Drawer open={open} onClose={onClose} icon={isArr ? 'login' : 'logout'}
      title={isArr ? t('reports.panels.arrivalsToday') : t('reports.panels.departuresToday')}
      sub={isArr
        ? t('reports.drawers.expectedCheckIns', { date: model.todayLabel, count: rows.length })
        : t('reports.drawers.expectedCheckOuts', { date: model.todayLabel, count: rows.length })}
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t('reports.drawers.liveListNote')}</span>
        <span className="spacer" />
        <button className="btn sm primary"><Icon name="arrow-right" size={13} /> {t('reports.drawers.openFrontDesk')}</button>
      </>}>
      <table className="dw-table">
        <thead><tr><th>{t('reports.drawers.colGuest')}</th><th>{isArr ? t('reports.drawers.colEta') : t('reports.drawers.colRoom')}</th><th className="num">{isArr ? t('reports.drawers.colNights') : t('reports.drawers.colBalance')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const arr = r as ReportsModel['arrivals'][number];
            const dep = r as ReportsModel['departures'][number];
            return (
              <tr key={i}>
                <td>
                  <div className="dt-name">{r.name}{isArr && arr.vip && <span className="vip">VIP</span>}</div>
                  <div className="dt-sub">{r.type} · {isArr ? arr.source : t('reports.drawers.checkoutAt', { time: dep.out })}</div>
                </td>
                <td>{isArr ? <span className="mono">{arr.eta}</span> : <span className="mono" style={{ fontWeight: 700 }}>{dep.room}</span>}</td>
                <td className="num">
                  {isArr ? <span className="mono" style={{ fontWeight: 700 }}>{arr.nights}</span>
                    : (dep.bal > 0 ? <Money value={dep.bal} tone="due" prefix={symbol} /> : <Pill tone="green" sm dot={false}>{t('status:ledger.settled')}</Pill>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Drawer>
  );
};
