import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  CircularProgress,
  IconButton,
  Collapse,
  Tooltip,
  Select,
  MenuItem,
  Menu,
  InputAdornment,
  Divider,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  ChevronRight as ChevronRightIcon,
  MoveToInbox as InboxIcon,
  KingBed as RoomIcon,
  People as GuestIcon,
  MenuBook as BookingIcon,
  Settings as SystemIcon,
  Assessment as ReportIcon,
  Person as PersonIcon,
  Computer as CronIcon,
  CalendarToday as CalIcon,
} from '@mui/icons-material';
import { AuditService } from '../../../api';
import {
  AuditLogEntry,
  AuditLogQuery,
  AuditCategoryCounts,
  AuditCategoryId,
} from '../../../types/audit.types';
import { getActionLabel, getResourceLabel } from '../../../types/audit.types';
import { emitApiNotification } from '../../../utils/apiNotifications';

/* ---------- Salim Inn design tokens ---------- */
const T = {
  surface: '#FFFFFF',
  surface2: '#F8FAFB',
  surface3: '#EFF2F5',
  border: '#E2E6EC',
  borderHi: '#CBD2DA',
  ink: '#0F172A',
  ink2: '#475569',
  ink3: '#7B8794',
  ink4: '#B0B8C2',
  slateSoft: '#F0F3F7',
  rose: '#D14256',
  roseSoft: '#FCE8EC',
  roseDeep: '#9B2A3B',
};

interface CatDef {
  id: AuditCategoryId;
  name: string;
  sub: string;
  Icon: typeof RoomIcon;
  acc: string;
  accDeep: string;
  accSoft: string;
}

const CATEGORIES: CatDef[] = [
  { id: 'rooms', name: 'Room Activity', sub: 'Inventory & status', Icon: RoomIcon, acc: '#10A47C', accDeep: '#0B6A50', accSoft: '#E7F5EF' },
  { id: 'guests', name: 'Guest Activity', sub: 'Profiles & KYC', Icon: GuestIcon, acc: '#2F7DE1', accDeep: '#1F5FB8', accSoft: '#E8F1FB' },
  { id: 'bookings', name: 'Booking Activity', sub: 'Reservations & stays', Icon: BookingIcon, acc: '#7A56D6', accDeep: '#5436A8', accSoft: '#EDE7FA' },
  { id: 'system', name: 'System Configuration', sub: 'Settings & access', Icon: SystemIcon, acc: '#C8941D', accDeep: '#8A6210', accSoft: '#FBF1DC' },
  { id: 'reports', name: 'Report Activity', sub: 'Exports & night audit', Icon: ReportIcon, acc: '#1A8FA0', accDeep: '#0F6470', accSoft: '#DCF1F4' },
];

type Verb = 'create' | 'update' | 'delete' | 'view' | 'run' | 'export' | 'check';

const VERB_LABEL: Record<Verb, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  view: 'Viewed',
  run: 'Ran',
  export: 'Exported',
  check: 'Checked',
};

const VERB_STYLE: Record<Verb, { bg: string; fg: string }> = {
  create: { bg: '#E7F5EF', fg: '#0B6A50' },
  update: { bg: '#FBF1DC', fg: '#8A6210' },
  delete: { bg: '#FCE8EC', fg: '#9B2A3B' },
  view: { bg: '#F0F3F7', fg: '#475569' },
  run: { bg: '#E8F1FB', fg: '#1F5FB8' },
  export: { bg: '#EDE7FA', fg: '#5436A8' },
  check: { bg: '#DCF1F4', fg: '#0F6470' },
};

/** Derive a coarse verb from a backend action string. Order matters. */
function deriveVerb(action: string): Verb {
  const a = action.toLowerCase();
  if (/(export|download|csv|pdf)/.test(a)) return 'export';
  if (/(creat|added|assign|enrol|register|login_success|insert|grant)/.test(a)) return 'create';
  if (/(delet|cancel|remov|reject|blacklist|void|fail|revoke)/.test(a)) return 'delete';
  if (/(reconcil|verif|inspect|^check|_check)/.test(a)) return 'check';
  if (/(run|execut|night_audit|generat|process)/.test(a)) return 'run';
  if (/(view|read|access|opened)/.test(a)) return 'view';
  return 'update';
}

const PAD = (n: number) => String(n).padStart(2, '0');
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}:${PAD(d.getSeconds())}`;
};
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${PAD(d.getDate())}/${PAD(d.getMonth() + 1)}/${d.getFullYear()}`;
};
function fmtDay(key: string): string {
  const d = new Date(key + 'T00:00:00');
  const today = new Date();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const td = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((td.getTime() - dd.getTime()) / 86400000);
  const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  if (diff === 0) return `Today · ${wk} ${d.getDate()} ${mo}`;
  if (diff === 1) return `Yesterday · ${wk} ${d.getDate()} ${mo}`;
  return `${wk} ${d.getDate()} ${mo} ${d.getFullYear()}`;
}
const initials = (nm: string) =>
  nm.split(/[\s._-]+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Format a Date as a value for <input type="datetime-local"> (local time). */
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
/** Compact label for a chosen timestamp bound. */
const shortStamp = (v?: string) => {
  if (!v) return '';
  const d = new Date(v);
  return `${PAD(d.getDate())}/${PAD(d.getMonth() + 1)} ${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
};

// Deterministic sparkline bars per category (visual only)
const sparkBars = (seed: number) =>
  Array.from({ length: 12 }, (_, k) => 0.3 + 0.7 * Math.abs(Math.sin((seed + 1) * 0.7 + k * 0.55)));

/** Build from→to rows out of a heterogeneous details object. */
function buildDiff(details: Record<string, unknown> | null): { k: string; from: string; to: string }[] {
  if (!details || typeof details !== 'object') return [];
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  if ('old_value' in details || 'new_value' in details) {
    return [{ k: String((details as any).key ?? 'value'), from: s((details as any).old_value), to: s((details as any).new_value) }];
  }
  return Object.entries(details).map(([k, v]) => ({ k, from: '—', to: s(v) }));
}

const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<AuditCategoryCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [activeCat, setActiveCat] = useState<AuditCategoryId>('rooms');
  const [verbFilter, setVerbFilter] = useState<Verb | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  // Timestamp-range picker
  const [dateAnchor, setDateAnchor] = useState<null | HTMLElement>(null);
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');

  const [query, setQuery] = useState<AuditLogQuery>({
    page: 1,
    page_size: 25,
    sort_by: 'created_at',
    sort_order: 'desc',
  });

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await AuditService.getAuditLogs({ ...query, category: activeCat });
      setLogs(response.data);
      setTotal(response.total);
    } catch (e) {
      console.error('Failed to fetch audit logs:', e);
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [query, activeCat]);

  const fetchCounts = useCallback(async () => {
    try {
      setCounts(
        await AuditService.getCategoryCounts({
          start_date: query.start_date,
          end_date: query.end_date,
          search: query.search,
        })
      );
    } catch (e) {
      console.error('Failed to fetch category counts:', e);
    }
  }, [query.start_date, query.end_date, query.search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // debounce search into the query
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== (query.search || '')) {
        setQuery((p) => ({ ...p, search: searchInput || undefined, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchInput, query.search]);

  // reset verb + expansion when switching streams
  useEffect(() => {
    setVerbFilter('all');
    setOpenIds({});
    setQuery((p) => ({ ...p, page: 1 }));
  }, [activeCat]);

  // verb filter is a client-side refinement of the fetched page
  const pageRows = useMemo(
    () => (verbFilter === 'all' ? logs : logs.filter((l) => deriveVerb(l.action) === verbFilter)),
    [logs, verbFilter]
  );

  const availableVerbs = useMemo(() => {
    const set = new Set<Verb>();
    logs.forEach((l) => set.add(deriveVerb(l.action)));
    return ['all', ...Array.from(set)] as ('all' | Verb)[];
  }, [logs]);

  const grouped = useMemo(() => {
    const byDay: Record<string, AuditLogEntry[]> = {};
    pageRows.forEach((e) => {
      const k = e.created_at.slice(0, 10);
      (byDay[k] ||= []).push(e);
    });
    return Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
  }, [pageRows]);

  const activeDef = CATEGORIES.find((c) => c.id === activeCat)!;
  const pageSize = query.page_size || 25;
  const curPage = query.page || 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasDateRange = !!(query.start_date || query.end_date);
  const dateLabel = hasDateRange
    ? `${shortStamp(query.start_date) || '…'} → ${shortStamp(query.end_date) || 'now'}`
    : 'All dates';

  const openDateMenu = (e: React.MouseEvent<HTMLElement>) => {
    setDraftStart(query.start_date || '');
    setDraftEnd(query.end_date || '');
    setDateAnchor(e.currentTarget);
  };
  const applyRange = (start?: string, end?: string) => {
    setQuery((p) => ({ ...p, start_date: start || undefined, end_date: end || undefined, page: 1 }));
    setDateAnchor(null);
  };
  const applyPreset = (days: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400000);
    applyRange(toLocalInput(from), toLocalInput(now));
  };
  const applyToday = () => {
    const now = new Date();
    applyRange(toLocalInput(new Date(now.getFullYear(), now.getMonth(), now.getDate())), toLocalInput(now));
  };

  const handleExportCSV = async () => {
    try {
      setExporting(true);
      await AuditService.downloadCSV({ ...query, category: activeCat });
    } catch (e: any) {
      console.error('CSV export failed:', e);
      emitApiNotification({ message: e?.message || 'Failed to export CSV', severity: 'error' });
    } finally {
      setExporting(false);
    }
  };
  const handleExportPDF = async () => {
    try {
      setExporting(true);
      await AuditService.downloadPDF({ ...query, category: activeCat });
    } catch (e: any) {
      console.error('PDF export failed:', e);
      emitApiNotification({ message: e?.message || 'Failed to export PDF', severity: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1480, mx: 'auto', bgcolor: '#F4F6F8', minHeight: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 2.25 }}>
        <Box>
          <Box sx={{ fontSize: 11.5, color: T.ink3, fontWeight: 500, display: 'flex', gap: 0.75, mb: 0.75 }}>
            <span>Settings</span><span style={{ color: T.ink4 }}>/</span>
            <span>Security</span><span style={{ color: T.ink4 }}>/</span>
            <span style={{ color: T.ink2, fontWeight: 600 }}>Audit Log</span>
          </Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px' }}>Audit Log</Typography>
          <Typography sx={{ fontSize: 13, color: T.ink3, mt: 0.5 }}>
            A chronological record of every action across the property — separated by activity stream.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { fetchLogs(); fetchCounts(); }} disabled={loading}
            sx={{ textTransform: 'none', borderColor: T.border, color: T.ink }}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<PdfIcon />} onClick={handleExportPDF} disabled={exporting || loading}
            sx={{ textTransform: 'none', borderColor: T.border, color: T.ink }}>
            PDF
          </Button>
          <Button variant="contained" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={exporting || loading}
            sx={{ textTransform: 'none', bgcolor: '#10A47C', '&:hover': { bgcolor: '#0E8C6A' } }}>
            Export
          </Button>
        </Box>
      </Box>

      {/* Category rail */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(5,1fr)' }, gap: 1.25, mb: 2 }}>
        {CATEGORIES.map((cat, i) => {
          const on = cat.id === activeCat;
          const n = counts ? (counts as any)[cat.id] ?? 0 : 0;
          return (
            <Box
              key={cat.id}
              component="button"
              onClick={() => setActiveCat(cat.id)}
              sx={{
                position: 'relative', textAlign: 'left', cursor: 'pointer',
                bgcolor: T.surface, border: `1px solid ${on ? T.ink : T.border}`,
                borderRadius: '12px', p: '14px 16px 12px', overflow: 'hidden',
                boxShadow: on ? '0 2px 8px rgba(15,23,42,0.07)' : 'none',
                transition: 'border-color 120ms, transform 120ms',
                '&:hover': { borderColor: on ? T.ink : T.borderHi, transform: 'translateY(-1px)' },
                '&::before': {
                  content: '""', position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: on ? 5 : 3, bgcolor: on ? cat.acc : T.ink4, transition: 'width 160ms',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
                <Box sx={{ width: 32, height: 32, borderRadius: '9px', bgcolor: cat.accSoft, color: cat.accDeep, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <cat.Icon sx={{ fontSize: 18 }} />
                </Box>
                <Box>
                  <Box sx={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{cat.name}</Box>
                  <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 500 }}>{cat.sub}</Box>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Box sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n}</Box>
                <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>events</Box>
              </Box>
              <Box sx={{ mt: 1.125, display: 'flex', alignItems: 'flex-end', gap: '2px', height: 22 }}>
                {sparkBars(i).map((h, k) => (
                  <Box key={k} sx={{ flex: 1, minHeight: 3, height: `${4 + h * 18}px`, borderRadius: '2px', bgcolor: on ? cat.acc : cat.accSoft, opacity: on ? 0.85 : 1 }} />
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search this stream by user, target, code, or action…"
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: T.ink3 }} /></InputAdornment>) }}
          sx={{ flex: 1, minWidth: 280, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: '9px' } }}
        />
        <Box sx={{ display: 'inline-flex', bgcolor: '#fff', border: `1px solid ${T.border}`, borderRadius: '9px', p: '3px' }}>
          {availableVerbs.map((v) => {
            const sel = verbFilter === v;
            return (
              <Box key={v} component="button" onClick={() => setVerbFilter(v as Verb | 'all')}
                sx={{
                  px: 1.25, py: 0.75, fontSize: 12, fontWeight: 600, borderRadius: '6px', cursor: 'pointer',
                  border: 'none', color: sel ? '#fff' : T.ink3, bgcolor: sel ? T.ink : 'transparent',
                  '&:hover': { color: sel ? '#fff' : T.ink },
                }}>
                {v === 'all' ? 'All actions' : VERB_LABEL[v as Verb]}
              </Box>
            );
          })}
        </Box>
        <Box
          component="button"
          onClick={openDateMenu}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.625, cursor: 'pointer',
            bgcolor: hasDateRange ? T.ink : '#fff', color: hasDateRange ? '#fff' : T.ink2,
            border: `1px solid ${hasDateRange ? T.ink : T.border}`, borderRadius: 999,
            px: 1.5, py: 0.75, fontSize: 12, fontWeight: 600,
            '&:hover': { borderColor: hasDateRange ? T.ink : T.borderHi },
          }}
        >
          <CalIcon sx={{ fontSize: 14 }} /> {dateLabel}
        </Box>
        <Menu
          anchorEl={dateAnchor}
          open={!!dateAnchor}
          onClose={() => setDateAnchor(null)}
          slotProps={{ paper: { sx: { p: 1.5, width: 300 } } }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.ink3, letterSpacing: '0.5px', textTransform: 'uppercase', mb: 1 }}>
            Filter by timestamp
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
            {[
              { lb: 'Today', fn: applyToday },
              { lb: 'Last 7 days', fn: () => applyPreset(7) },
              { lb: 'Last 30 days', fn: () => applyPreset(30) },
              { lb: 'All time', fn: () => applyRange(undefined, undefined) },
            ].map((p) => (
              <Box key={p.lb} component="button" onClick={p.fn}
                sx={{ px: 1, py: 0.5, fontSize: 11.5, fontWeight: 600, borderRadius: '7px', cursor: 'pointer', border: `1px solid ${T.border}`, bgcolor: '#fff', color: T.ink2, '&:hover': { borderColor: T.borderHi, color: T.ink } }}>
                {p.lb}
              </Box>
            ))}
          </Box>
          <Divider sx={{ mb: 1.5 }} />
          <TextField
            size="small" fullWidth type="datetime-local" label="From"
            value={draftStart} onChange={(e) => setDraftStart(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ mb: 1.25 }}
          />
          <TextField
            size="small" fullWidth type="datetime-local" label="To"
            value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ mb: 1.5 }}
          />
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => applyRange(undefined, undefined)} sx={{ textTransform: 'none', color: T.ink2 }}>
              Clear
            </Button>
            <Button
              size="small" variant="contained"
              onClick={() => applyRange(draftStart || undefined, draftEnd || undefined)}
              sx={{ textTransform: 'none', bgcolor: '#10A47C', '&:hover': { bgcolor: '#0E8C6A' } }}
            >
              Apply
            </Button>
          </Box>
        </Menu>
      </Box>

      {/* Log panel */}
      <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, p: '14px 18px', borderBottom: `1px solid ${T.border}`, background: `linear-gradient(180deg, ${T.surface} 0%, ${T.surface2} 100%)` }}>
          <Box sx={{ width: 38, height: 38, borderRadius: '10px', bgcolor: activeDef.accSoft, color: activeDef.accDeep, display: 'grid', placeItems: 'center', border: `1px solid ${activeDef.acc}2E` }}>
            <activeDef.Icon sx={{ fontSize: 20 }} />
          </Box>
          <Box>
            <Box sx={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px' }}>{activeDef.name}</Box>
            <Box sx={{ fontSize: 11.5, color: T.ink3, mt: '2px', fontWeight: 500 }}>
              Showing {pageRows.length} of {total} events · Newest first
            </Box>
          </Box>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress />
          </Box>
        ) : grouped.length === 0 ? (
          <Box sx={{ p: '60px 20px', textAlign: 'center', color: T.ink3 }}>
            <InboxIcon sx={{ fontSize: 32, color: T.ink4, mb: 1 }} />
            <Box sx={{ fontSize: 15, fontWeight: 700, color: T.ink2, mb: 0.5 }}>No events match your filters</Box>
            <Box>Try a different stream, widen the date range, or clear the search.</Box>
          </Box>
        ) : (
          grouped.map(([day, rows]) => (
            <React.Fragment key={day}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: '10px 18px', bgcolor: T.surface2, borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.ink3, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: T.ink4 }} />
                <span>{fmtDay(day)}</span>
                <Box sx={{ ml: 'auto', color: T.ink3, fontWeight: 600 }}>{rows.length} event{rows.length === 1 ? '' : 's'}</Box>
              </Box>
              {rows.map((r) => {
                const verb = deriveVerb(r.action);
                const vs = VERB_STYLE[verb];
                const open = !!openIds[r.id];
                const isSys = !r.username;
                const actionLabel = getActionLabel(r.action).label;
                const resLabel = getResourceLabel(r.resource_type).label;
                const diff = buildDiff(r.details);
                return (
                  <Box key={r.id}>
                    <Box
                      onClick={() => setOpenIds((s) => ({ ...s, [r.id]: !s[r.id] }))}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '16px 90px 1fr 110px', md: '16px 92px 168px 1fr 200px 120px' },
                        alignItems: 'flex-start', gap: 1.75, p: '12px 18px',
                        borderBottom: `1px solid ${T.border}`, cursor: 'pointer',
                        bgcolor: open ? T.surface2 : 'transparent',
                        '&:hover': { bgcolor: T.surface2 },
                      }}
                    >
                      <ChevronRightIcon sx={{ fontSize: 16, color: T.ink3, mt: '3px', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 180ms' }} />
                      <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: T.ink2, fontWeight: 600 }}>
                        {fmtTime(r.created_at)}
                        <Box sx={{ color: T.ink3, fontSize: 10.5, mt: '2px', fontWeight: 500 }}>{fmtDate(r.created_at)}</Box>
                      </Box>
                      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, minWidth: 0 }}>
                        <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 10.5, fontWeight: 700, ...(isSys ? { bgcolor: T.slateSoft, color: T.ink2 } : { background: 'linear-gradient(135deg,#E7F5EF,#B8E5D5)', color: '#0B6A50' }) }}>
                          {isSys ? <CronIcon sx={{ fontSize: 14 }} /> : initials(r.username || 'NA')}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.username || 'System'}</Box>
                          <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 500 }}>{isSys ? 'Automated' : `User #${r.user_id}`}</Box>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700, px: 1, py: '3px', borderRadius: '6px', whiteSpace: 'nowrap', flexShrink: 0, bgcolor: vs.bg, color: vs.fg }}>
                          {VERB_LABEL[verb]}
                        </Box>
                        <Box sx={{ fontSize: 13, color: T.ink, lineHeight: 1.5, minWidth: 0 }}>
                          <Box component="span" sx={{ fontWeight: 600 }}>{actionLabel}</Box>
                          <br />
                          <Box component="span" sx={{ color: T.ink2 }}>{resLabel}</Box>
                          {r.resource_id != null && (
                            <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, bgcolor: T.surface3, color: T.ink2, px: 0.75, py: '1px', borderRadius: '5px', ml: 0.5 }}>
                              #{r.resource_id}
                            </Box>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12, color: T.ink3, fontWeight: 500 }}>
                        {r.details && (('old_value' in (r.details as any)) || ('new_value' in (r.details as any)))
                          ? `${(r.details as any).old_value ?? '—'} → ${(r.details as any).new_value ?? '—'}`
                          : resLabel}
                      </Box>
                      <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: T.ink2, fontWeight: 600, textAlign: { md: 'right' } }}>
                        {r.ip_address || '—'}
                        <Tooltip title={r.user_agent || ''}>
                          <Box sx={{ color: T.ink3, fontSize: 10, fontWeight: 500, mt: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.user_agent ? r.user_agent.slice(0, 22) : 'Server'}
                          </Box>
                        </Tooltip>
                      </Box>
                    </Box>
                    <Collapse in={open} unmountOnExit>
                      <Box sx={{ p: '14px 18px 16px 48px', bgcolor: '#fff', borderBottom: `1px solid ${T.border}`, borderTop: `1px dashed ${T.border}`, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                        <Box>
                          <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', mb: 1 }}>Event details</Box>
                          <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 12.5 }}>
                            <Box sx={{ color: T.ink3 }}>Event ID</Box><Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>#{r.id}</Box>
                            <Box sx={{ color: T.ink3 }}>Timestamp</Box><Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{fmtDate(r.created_at)} · {fmtTime(r.created_at)}</Box>
                            <Box sx={{ color: T.ink3 }}>Actor</Box><Box sx={{ fontWeight: 600 }}>{r.username || 'System'} <Box component="span" sx={{ color: T.ink3, fontWeight: 500 }}>{r.user_id != null ? `(#${r.user_id})` : '(automated)'}</Box></Box>
                            <Box sx={{ color: T.ink3 }}>Stream</Box><Box sx={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.category || activeCat}</Box>
                            <Box sx={{ color: T.ink3 }}>IP</Box><Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{r.ip_address || '—'}</Box>
                            <Box sx={{ color: T.ink3 }}>Source</Box><Box sx={{ fontWeight: 600, wordBreak: 'break-word' }}>{r.user_agent || 'Server'}</Box>
                            <Box sx={{ color: T.ink3 }}>Resource</Box><Box sx={{ fontWeight: 600 }}>{resLabel}{r.resource_id != null ? ` #${r.resource_id}` : ''}</Box>
                          </Box>
                        </Box>
                        <Box>
                          <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', mb: 1 }}>Changes</Box>
                          {diff.length > 0 ? (
                            <Box sx={{ bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '9px', overflow: 'hidden', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>
                              {diff.map((d, i) => (
                                <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 1.25, p: '6px 10px', borderBottom: i < diff.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                                  <Box sx={{ color: T.ink3, fontWeight: 600 }}>{d.k}</Box>
                                  <Box sx={{ color: T.rose, textDecoration: 'line-through', textDecorationColor: 'rgba(209,66,86,0.45)' }}>{d.from}</Box>
                                  <Box sx={{ color: '#0B6A50', fontWeight: 700 }}><Box component="span" sx={{ color: T.ink4, px: 0.5 }}>→</Box>{d.to}</Box>
                                </Box>
                              ))}
                            </Box>
                          ) : (
                            <Box sx={{ fontSize: 12, color: T.ink3, p: '10px 12px', bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '9px' }}>
                              Read-only event — no field changes.
                            </Box>
                          )}
                        </Box>
                      </Box>
                    </Collapse>
                  </Box>
                );
              })}
            </React.Fragment>
          ))
        )}

        {/* Footer / pagination */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: '12px 18px', bgcolor: T.surface2, borderTop: `1px solid ${T.border}`, fontSize: 12, color: T.ink3, fontWeight: 500, flexWrap: 'wrap' }}>
          <span>
            {total === 0 ? 'No events' : `Showing ${(curPage - 1) * pageSize + 1}–${Math.min(curPage * pageSize, total)} of ${total}`}
          </span>
          <Box sx={{ flex: 1 }} />
          <span>Rows per page</span>
          <Select
            size="small"
            value={pageSize}
            onChange={(e) => setQuery((p) => ({ ...p, page_size: Number(e.target.value), page: 1 }))}
            sx={{ fontSize: 12, fontWeight: 600, '& .MuiSelect-select': { py: 0.5 } }}
          >
            {[25, 50, 100].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
          <Box sx={{ display: 'inline-flex', gap: '2px', ml: 1.5 }}>
            <IconButton size="small" disabled={curPage <= 1} onClick={() => setQuery((p) => ({ ...p, page: curPage - 1 }))}>‹</IconButton>
            <Box sx={{ minWidth: 28, height: 28, borderRadius: '7px', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, bgcolor: T.ink, color: '#fff' }}>{curPage}</Box>
            <IconButton size="small" disabled={curPage >= totalPages} onClick={() => setQuery((p) => ({ ...p, page: curPage + 1 }))}>›</IconButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default AuditLogPage;
