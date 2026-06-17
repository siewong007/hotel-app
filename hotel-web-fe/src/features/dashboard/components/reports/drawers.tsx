import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './Icon';
import { BarRows, Money, Pill } from './charts';
import { useReportsFormat } from './formatContext';
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

const Drawer: React.FC<DrawerShellProps> = ({ open, onClose, icon, title, sub, children, foot }) =>
  createPortal(
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

function ageTone(a: string) {
  if (a === 'Current') return 'green' as const;
  if (a === '1–30 days') return 'blue' as const;
  if (a === '31–60 days') return 'amber' as const;
  return 'red' as const;
}

export type DrawerState =
  | { type: 'outstanding' }
  | { type: 'occupancy' }
  | { type: 'revenue'; metric?: string }
  | { type: 'flow'; mode: 'arrivals' | 'departures' }
  | null;

export const OutstandingDrawer: React.FC<{ open: boolean; onClose: () => void; model: ReportsModel }> = ({ open, onClose, model }) => {
  const { fmtMoney, symbol } = useReportsFormat();
  const [tab, setTab] = useState<'guests' | 'company'>('guests');
  const total = model.ageing.reduce((a, b) => a + b.value, 0);
  const rows = tab === 'guests' ? model.guestBalances : model.companyBalances;
  return (
    <Drawer open={open} onClose={onClose} icon="wallet" title="Outstanding balance"
      sub={`Unpaid guest & company balances · as of ${model.todayLabel}`}
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Authoritative source: invoice total − valid payments</span>
        <span className="spacer" />
        <button className="btn sm"><Icon name="download" size={13} /> Export</button>
      </>}>
      <div className="dw-big">
        <div className="dw-big-l">Total outstanding</div>
        <div className="dw-big-v"><Money value={total} tone="due" prefix={symbol} /></div>
      </div>

      <div className="dw-sech">Ageing buckets</div>
      <div className="dw-sec">
        <BarRows rows={model.ageing.map((a) => ({
          label: a.bucket, value: a.value, color: a.color,
          display: fmtMoney(a.value),
          sub: ((a.value / total) * 100).toFixed(0) + '% of total',
        }))} />
      </div>

      <div className="dw-tabs">
        <button className={'dw-tab' + (tab === 'guests' ? ' is-on' : '')} onClick={() => setTab('guests')}>
          <Icon name="user" size={14} /> Guest balances <span className="ct">{model.guestBalances.length}</span>
        </button>
        <button className={'dw-tab' + (tab === 'company' ? ' is-on' : '')} onClick={() => setTab('company')}>
          <Icon name="building" size={14} /> Company balances <span className="ct">{model.companyBalances.length}</span>
        </button>
      </div>

      <table className="dw-table">
        <thead><tr><th>{tab === 'guests' ? 'Guest' : 'Company'}</th><th>Ageing</th><th className="num">Balance</th></tr></thead>
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
  const { fmtPct } = useReportsFormat();
  const occupied = model.live.inHouse;
  return (
    <Drawer open={open} onClose={onClose} icon="bed" title="Occupancy detail"
      sub="Room status snapshot · drill into the room timeline"
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtPct(model.live.occNow)} occupied · {occupied} of {model.periodRooms} rooms</span>
        <span className="spacer" />
        <button className="btn sm primary"><Icon name="calendar" size={13} /> Open room timeline</button>
      </>}>
      <div className="dw-statgrid">
        {model.roomStatus.map((s, i) => (
          <div className="dw-statcell" key={i}>
            <div className="dw-statn" style={{ color: s.color.startsWith('var(') ? undefined : s.color }}>{s.count}</div>
            <div className="dw-statl">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="dw-sech">Occupancy by room type</div>
      <div className="dw-sec">
        <BarRows rows={model.roomTypes.map((r) => ({
          label: r.type, value: r.occ, color: r.occ >= 80 ? 'var(--emerald)' : r.occ >= 74 ? 'var(--blue)' : 'var(--amber)',
          display: fmtPct(r.occ), sub: r.rooms + ' rooms',
        }))} />
      </div>

      <div className="dw-sech">Departures today <span className="dw-sech-ct">{model.departures.length}</span></div>
      <table className="dw-table">
        <thead><tr><th>Guest</th><th>Room</th><th className="num">Balance</th></tr></thead>
        <tbody>
          {model.departures.map((d, i) => (
            <tr key={i}>
              <td><div className="dt-name">{d.name}</div><div className="dt-sub">{d.type} · checkout {d.out}</div></td>
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
  const { symbol } = useReportsFormat();
  return bal > 0 ? <Money value={bal} tone="due" prefix={symbol} /> : <Pill tone="green" sm dot={false}>Settled</Pill>;
};

export const RevenueDrawer: React.FC<{ open: boolean; onClose: () => void; metric?: string; model: ReportsModel }> = ({ open, onClose, metric, model }) => {
  const { fmtPct, symbol } = useReportsFormat();
  const titleMap: Record<string, [string, IconName]> = {
    roomRev: ['Room revenue', 'coins'], totalRev: ['Total revenue', 'coins'],
    adr: ['Average daily rate', 'gauge'], revpar: ['RevPAR', 'gauge'],
  };
  const [t, ic] = titleMap[metric || ''] || ['Revenue', 'coins'];
  return (
    <Drawer open={open} onClose={onClose} icon={ic} title={t}
      sub="Revenue states are distinct economic events — never summed together"
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Earned = posted room-charge ledger entries</span>
        <span className="spacer" />
        <button className="btn sm"><Icon name="list" size={13} /> View bookings</button>
      </>}>
      <div className="dw-info">
        <Icon name="info" size={16} />
        <div>A future booking is <b>booked</b>; a completed night is <b>earned</b>; a payment received is <b>collected</b>; an unpaid invoice is <b>outstanding</b>. The dashboard reports <b>earned</b> revenue by stay date.</div>
      </div>
      <div className="dw-rev">
        {model.revenueStates.map((s, i) => (
          <div className="dw-revrow" key={i}>
            <span className="dw-revdot" style={{ background: s.color.startsWith('var(') ? undefined : s.color }} />
            <div className="dw-revl"><div className="dw-revt">{s.label}</div><div className="dw-revs">{s.desc}</div></div>
            <div className="dw-revv"><Money value={s.value} prefix={symbol} /></div>
          </div>
        ))}
      </div>

      <div className="dw-sech">By room type</div>
      <table className="dw-table">
        <thead><tr><th>Type</th><th className="num">ADR</th><th className="num">Occ</th><th className="num">Revenue</th></tr></thead>
        <tbody>
          {model.roomTypes.map((r, i) => (
            <tr key={i}>
              <td><div className="dt-name">{r.type}</div><div className="dt-sub">{r.rooms} rooms</div></td>
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
  const { symbol } = useReportsFormat();
  const isArr = mode === 'arrivals';
  const rows = isArr ? model.arrivals : model.departures;
  return (
    <Drawer open={open} onClose={onClose} icon={isArr ? 'login' : 'logout'}
      title={isArr ? 'Arrivals today' : 'Departures today'}
      sub={`${model.todayLabel} · ${rows.length}${isArr ? ' expected check-ins' : ' expected check-outs'}`}
      foot={<>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Live operational list · refreshes automatically</span>
        <span className="spacer" />
        <button className="btn sm primary"><Icon name="arrow-right" size={13} /> Open front desk</button>
      </>}>
      <table className="dw-table">
        <thead><tr><th>Guest</th><th>{isArr ? 'ETA' : 'Room'}</th><th className="num">{isArr ? 'Nights' : 'Balance'}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const arr = r as ReportsModel['arrivals'][number];
            const dep = r as ReportsModel['departures'][number];
            return (
              <tr key={i}>
                <td>
                  <div className="dt-name">{r.name}{isArr && arr.vip && <span className="vip">VIP</span>}</div>
                  <div className="dt-sub">{r.type} · {isArr ? arr.source : 'checkout ' + dep.out}</div>
                </td>
                <td>{isArr ? <span className="mono">{arr.eta}</span> : <span className="mono" style={{ fontWeight: 700 }}>{dep.room}</span>}</td>
                <td className="num">
                  {isArr ? <span className="mono" style={{ fontWeight: 700 }}>{arr.nights}</span>
                    : (dep.bal > 0 ? <Money value={dep.bal} tone="due" prefix={symbol} /> : <Pill tone="green" sm dot={false}>Settled</Pill>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Drawer>
  );
};
