import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
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
  FlagOutlined as ActionOnlyIcon,
} from '@mui/icons-material';
import {
  AuditLogEntry,
  AuditLogQuery,
  AuditCategoryId,
} from '../../../types/audit.types';
import { getActionLabel, getResourceLabel } from '../../../types/audit.types';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { LogoLoader } from '../../../components';
import EmptyState from '../../../components/common/EmptyState';
import {
  useAuditCategoryCounts,
  useAuditLogs,
  useExportAuditCsv,
  useExportAuditPdf,
} from '../hooks/useAuditQueries';
import { errorMessage } from '../../../utils/errorMessage';
import { useTranslation } from '../../../i18n';
import { dateFormatter } from '../../../i18n/format';

/* ---------- Design tokens — aliases onto the global --hotel-* vars ---------- */
const T = {
  surface: 'var(--hotel-surface)',
  surface2: 'var(--hotel-surface-raised)',
  surface3: 'var(--hotel-surface-sunken)',
  border: 'var(--hotel-border)',
  borderHi: 'var(--hotel-border-strong)',
  ink: 'var(--hotel-text)',
  ink2: 'var(--hotel-text-secondary)',
  ink3: 'var(--hotel-text-muted)',
  ink4: 'var(--hotel-text-disabled)',
  slateSoft: 'var(--hotel-neutral-bg)',
  rose: 'var(--hotel-danger)',
  roseSoft: 'var(--hotel-danger-bg)',
  roseDeep: 'var(--hotel-danger)',
  emerald: 'var(--hotel-primary)',
  emeraldDeep: 'var(--hotel-primary-hover)',
  emeraldSoft: 'var(--hotel-primary-subtle)',
  amber: 'var(--hotel-warning)',
  amberSoft: 'var(--hotel-warning-bg)',
  blue: 'var(--hotel-info)',
  blueSoft: 'var(--hotel-info-bg)',
  success: 'var(--hotel-success)',
  successSoft: 'var(--hotel-success-bg)',
  violet: 'var(--hotel-chart-4)',
  violetSoft: 'color-mix(in srgb, var(--hotel-chart-4) 14%, transparent)',
  teal: 'var(--hotel-chart-3)',
  tealSoft: 'color-mix(in srgb, var(--hotel-chart-3) 14%, transparent)',
};

interface CatDef {
  id: AuditCategoryId;
  nameKey: string;
  subKey: string;
  Icon: typeof RoomIcon;
  acc: string;
  accDeep: string;
  accSoft: string;
}

const CATEGORIES: CatDef[] = [
  { id: 'rooms', nameKey: 'admin:audit.cat.rooms.name', subKey: 'admin:audit.cat.rooms.sub', Icon: RoomIcon, acc: T.emerald, accDeep: T.emerald, accSoft: T.emeraldSoft },
  { id: 'guests', nameKey: 'admin:audit.cat.guests.name', subKey: 'admin:audit.cat.guests.sub', Icon: GuestIcon, acc: T.blue, accDeep: T.blue, accSoft: T.blueSoft },
  { id: 'bookings', nameKey: 'admin:audit.cat.bookings.name', subKey: 'admin:audit.cat.bookings.sub', Icon: BookingIcon, acc: T.violet, accDeep: T.violet, accSoft: T.violetSoft },
  { id: 'system', nameKey: 'admin:audit.cat.system.name', subKey: 'admin:audit.cat.system.sub', Icon: SystemIcon, acc: T.amber, accDeep: T.amber, accSoft: T.amberSoft },
  { id: 'reports', nameKey: 'admin:audit.cat.reports.name', subKey: 'admin:audit.cat.reports.sub', Icon: ReportIcon, acc: T.teal, accDeep: T.teal, accSoft: T.tealSoft },
];

type Verb = 'create' | 'update' | 'delete' | 'view' | 'run' | 'export' | 'check';

const VERB_LABEL_KEYS: Record<Verb, string> = {
  create: 'admin:audit.verb.create',
  update: 'admin:audit.verb.update',
  delete: 'admin:audit.verb.delete',
  view: 'admin:audit.verb.view',
  run: 'admin:audit.verb.run',
  export: 'admin:audit.verb.export',
  check: 'admin:audit.verb.check',
};

const VERB_STYLE: Record<Verb, { bg: string; fg: string }> = {
  create: { bg: 'var(--hotel-success-bg)', fg: 'var(--hotel-success)' },
  update: { bg: 'var(--hotel-warning-bg)', fg: 'var(--hotel-warning)' },
  delete: { bg: 'var(--hotel-danger-bg)', fg: 'var(--hotel-danger)' },
  view: { bg: 'var(--hotel-neutral-bg)', fg: 'var(--hotel-neutral)' },
  run: { bg: 'var(--hotel-info-bg)', fg: 'var(--hotel-info)' },
  export: { bg: 'color-mix(in srgb, var(--hotel-chart-4) 14%, transparent)', fg: 'var(--hotel-chart-4)' },
  check: { bg: 'color-mix(in srgb, var(--hotel-chart-3) 14%, transparent)', fg: 'var(--hotel-chart-3)' },
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
const TIME_FMT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
const DATE_FMT: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
const DAY_FMT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const DAY_YEAR_FMT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
const STAMP_FMT: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
const fmtTime = (iso: string) => dateFormatter(TIME_FMT).format(new Date(iso));
const fmtDate = (iso: string) => dateFormatter(DATE_FMT).format(new Date(iso));
const dayDiff = (d: Date) => {
  const today = new Date();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const td = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((td.getTime() - dd.getTime()) / 86400000);
};
const initials = (nm: string) =>
  nm.split(/[\s._-]+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Format a Date as a value for <input type="datetime-local"> (local time). */
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
/** Compact label for a chosen timestamp bound. */
const shortStamp = (v?: string) => (v ? dateFormatter(STAMP_FMT).format(new Date(v)) : '');

// Deterministic sparkline bars per category (visual only)
const sparkBars = (seed: number) =>
  Array.from({ length: 12 }, (_, k) => 0.3 + 0.7 * Math.abs(Math.sin((seed + 1) * 0.7 + k * 0.55)));

type DetailRecord = Record<string, unknown>;
type ChangeRow = { k: string; from: string; to: string };
type MetadataRow = { k: string; v: string };

const isRecord = (value: unknown): value is DetailRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fmtValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const isEmptyDetailValue = (value: unknown) =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0);

function addPairRow(
  details: DetailRecord,
  oldKey: string,
  newKey: string,
  label: string,
  changes: ChangeRow[],
  consumed: Set<string>
) {
  if (!(oldKey in details) || !(newKey in details)) return;
  consumed.add(oldKey);
  consumed.add(newKey);

  const oldValue = details[oldKey];
  const newValue = details[newKey];
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;

  changes.push({ k: label, from: fmtValue(oldValue), to: fmtValue(newValue) });
}

function addObjectPairRows(
  details: DetailRecord,
  oldKey: string,
  newKey: string,
  changes: ChangeRow[],
  consumed: Set<string>
) {
  if (!isRecord(details[oldKey]) || !isRecord(details[newKey])) return;
  consumed.add(oldKey);
  consumed.add(newKey);

  const oldValues = details[oldKey] as DetailRecord;
  const newValues = details[newKey] as DetailRecord;
  const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);

  keys.forEach((key) => {
    if (JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key])) {
      changes.push({ k: key, from: fmtValue(oldValues[key]), to: fmtValue(newValues[key]) });
    }
  });
}

function addPrefixedPairRows(
  details: DetailRecord,
  oldPrefix: string,
  newPrefix: string,
  changes: ChangeRow[],
  consumed: Set<string>
) {
  Object.entries(details).forEach(([oldKey, oldValue]) => {
    if (!oldKey.startsWith(oldPrefix)) return;
    const suffix = oldKey.slice(oldPrefix.length);
    const newKey = `${newPrefix}${suffix}`;
    if (!(newKey in details) || consumed.has(oldKey) || consumed.has(newKey)) return;

    consumed.add(oldKey);
    consumed.add(newKey);
    const newValue = details[newKey];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ k: suffix || 'value', from: fmtValue(oldValue), to: fmtValue(newValue) });
    }
  });
}

function buildChangeRowsFromValue(value: unknown): ChangeRow[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const rows = buildChangeRowsFromValue(entry);
      if (rows.length > 0) return rows;
      return isEmptyDetailValue(entry) ? [] : [{ k: `change_${index + 1}`, from: '—', to: fmtValue(entry) }];
    });
  }

  if (!isRecord(value)) {
    return isEmptyDetailValue(value) ? [] : [{ k: 'value', from: '—', to: fmtValue(value) }];
  }

  const nested = analyzeDetails(value);
  if (nested.changes.length > 0) return nested.changes;

  return Object.entries(value)
    .filter(([, entry]) => !isEmptyDetailValue(entry))
    .map(([key, entry]) => ({ k: key, from: '—', to: fmtValue(entry) }));
}

function analyzeDetails(details: DetailRecord | null): { changes: ChangeRow[]; metadata: MetadataRow[] } {
  if (!isRecord(details)) return { changes: [], metadata: [] };

  const changes: ChangeRow[] = [];
  const consumed = new Set<string>();

  addPairRow(details, 'old_value', 'new_value', String(details.key ?? 'value'), changes, consumed);
  addObjectPairRows(details, 'old_values', 'new_values', changes, consumed);
  addObjectPairRows(details, 'before', 'after', changes, consumed);
  addPrefixedPairRows(details, 'old_', 'new_', changes, consumed);
  addPrefixedPairRows(details, 'from_', 'to_', changes, consumed);
  addPrefixedPairRows(details, 'previous_', 'new_', changes, consumed);

  if ('changes' in details) {
    consumed.add('changes');
    changes.push(...buildChangeRowsFromValue(details['changes']));
  }

  const metadata = Object.entries(details)
    .filter(([key, value]) => !consumed.has(key) && !isEmptyDetailValue(value))
    .map(([key, value]) => ({ k: key, v: fmtValue(value) }));

  return { changes, metadata };
}



const AuditLogPage: React.FC = () => {
  const { t } = useTranslation('admin');
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

  const logQuery = useMemo(
    () => ({ ...query, category: activeCat }),
    [activeCat, query]
  );
  const countQuery = useMemo(
    () => ({
      start_date: query.start_date,
      end_date: query.end_date,
      search: query.search,
    }),
    [query.end_date, query.search, query.start_date]
  );
  const auditLogsQuery = useAuditLogs(logQuery);
  const countsQuery = useAuditCategoryCounts(countQuery);
  const exportCsvMutation = useExportAuditCsv();
  const exportPdfMutation = useExportAuditPdf();
  const logs = useMemo(() => auditLogsQuery.data?.data ?? [], [auditLogsQuery.data]);
  const total = auditLogsQuery.data?.total ?? 0;
  const counts = countsQuery.data ?? null;
  const loading = auditLogsQuery.isPending;
  const exporting = exportCsvMutation.isPending || exportPdfMutation.isPending;

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

  const fmtDayLabel = (key: string): string => {
    const d = new Date(key + 'T00:00:00');
    const diff = dayDiff(d);
    if (diff === 0) return t('audit.todayLine', { date: dateFormatter(DAY_FMT).format(d) });
    if (diff === 1) return t('audit.yesterdayLine', { date: dateFormatter(DAY_FMT).format(d) });
    return dateFormatter(DAY_YEAR_FMT).format(d);
  };

  const activeDef = CATEGORIES.find((c) => c.id === activeCat)!;
  const pageSize = query.page_size || 25;
  const curPage = query.page || 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasDateRange = !!(query.start_date || query.end_date);
  const dateLabel = hasDateRange
    ? t('audit.range', { start: shortStamp(query.start_date) || '…', end: shortStamp(query.end_date) || t('audit.rangeNow') })
    : t('audit.allDates');

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
      await exportCsvMutation.mutateAsync({ ...query, category: activeCat });
    } catch (e) {
      console.error('CSV export failed:', e);
      emitApiNotification({ message: errorMessage(e, t('audit.errors.exportCsv')), severity: 'error' });
    }
  };
  const handleExportPDF = async () => {
    try {
      await exportPdfMutation.mutateAsync({ ...query, category: activeCat });
    } catch (e) {
      console.error('PDF export failed:', e);
      emitApiNotification({ message: errorMessage(e, t('audit.errors.exportPdf')), severity: 'error' });
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1480, mx: 'auto', bgcolor: 'var(--hotel-bg)', minHeight: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 2.25 }}>
        <Box>
          <Box sx={{ fontSize: 11.5, color: T.ink3, fontWeight: 500, display: 'flex', gap: 0.75, mb: 0.75 }}>
            <span>{t('audit.crumbs.settings')}</span><span style={{ color: T.ink4 }}>/</span>
            <span>{t('audit.crumbs.security')}</span><span style={{ color: T.ink4 }}>/</span>
            <span style={{ color: T.ink2, fontWeight: 600 }}>{t('audit.title')}</span>
          </Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px' }}>{t('audit.title')}</Typography>
          <Typography sx={{ fontSize: 13, color: T.ink3, mt: 0.5 }}>
            {t('audit.subtitle')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { auditLogsQuery.refetch(); countsQuery.refetch(); }} disabled={loading}
            sx={{ textTransform: 'none', borderColor: T.border, color: T.ink }}>
            {t('common:actions.refresh')}
          </Button>
          <Button variant="outlined" startIcon={<PdfIcon />} onClick={handleExportPDF} disabled={exporting || loading}
            sx={{ textTransform: 'none', borderColor: T.border, color: T.ink }}>
            {t('audit.exportPdf')}
          </Button>
          <Button variant="contained" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={exporting || loading}
            sx={{ textTransform: 'none', bgcolor: 'var(--hotel-primary)', '&:hover': { bgcolor: 'var(--hotel-primary-hover)' } }}>
            {t('audit.export')}
          </Button>
        </Box>
      </Box>
      {/* Category rail */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(5,1fr)' }, gap: 1.25, mb: 2 }}>
        {CATEGORIES.map((cat, i) => {
          const on = cat.id === activeCat;
          const n = counts ? counts[cat.id] ?? 0 : 0;
          return (
            <Box
              key={cat.id}
              component="button"
              onClick={() => setActiveCat(cat.id)}
              sx={{
                position: 'relative', textAlign: 'left', cursor: 'pointer',
                bgcolor: T.surface, border: `1px solid ${on ? T.ink : T.border}`,
                borderRadius: '12px', p: '14px 16px 12px', overflow: 'hidden',
                boxShadow: on ? 'var(--hotel-shadow-sm)' : 'none',
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
                  <Box sx={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{t(cat.nameKey)}</Box>
                  <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 500 }}>{t(cat.subKey)}</Box>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Box sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n}</Box>
                <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{t('audit.events')}</Box>
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
          placeholder={t('audit.searchPlaceholder')}
          sx={{ flex: { xs: '1 1 100%', sm: 1 }, minWidth: { xs: 0, sm: 280 }, bgcolor: T.surface, '& .MuiOutlinedInput-root': { borderRadius: '9px' } }}
          slotProps={{
            input: { startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: T.ink3 }} /></InputAdornment>) }
          }}
        />
        <Box sx={{ display: 'inline-flex', maxWidth: '100%', overflowX: 'auto', scrollbarWidth: 'none', bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '9px', p: '3px', '&::-webkit-scrollbar': { display: 'none' } }}>
          {availableVerbs.map((v) => {
            const sel = verbFilter === v;
            return (
              <Box key={v} component="button" onClick={() => setVerbFilter(v as Verb | 'all')}
                sx={{
                  px: 1.25, py: 0.75, fontSize: 12, fontWeight: 600, borderRadius: '6px', cursor: 'pointer',
                  border: 'none', color: sel ? 'var(--hotel-bg)' : T.ink3, bgcolor: sel ? T.ink : 'transparent',
                  '&:hover': { color: sel ? 'var(--hotel-bg)' : T.ink },
                }}>
                {v === 'all' ? t('audit.allActions') : t(VERB_LABEL_KEYS[v as Verb])}
              </Box>
            );
          })}
        </Box>
        <Box
          component="button"
          onClick={openDateMenu}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.625, cursor: 'pointer',
            bgcolor: hasDateRange ? T.ink : T.surface, color: hasDateRange ? 'var(--hotel-bg)' : T.ink2,
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
            {t('audit.filterByTimestamp')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
            {[
              { lb: t('audit.presets.today'), fn: applyToday },
              { lb: t('audit.presets.lastNDays', { count: 7 }), fn: () => applyPreset(7) },
              { lb: t('audit.presets.lastNDays', { count: 30 }), fn: () => applyPreset(30) },
              { lb: t('audit.presets.allTime'), fn: () => applyRange(undefined, undefined) },
            ].map((p) => (
              <Box key={p.lb} component="button" onClick={p.fn}
                sx={{ px: 1, py: 0.5, fontSize: 11.5, fontWeight: 600, borderRadius: '7px', cursor: 'pointer', border: `1px solid ${T.border}`, bgcolor: T.surface, color: T.ink2, '&:hover': { borderColor: T.borderHi, color: T.ink } }}>
                {p.lb}
              </Box>
            ))}
          </Box>
          <Divider sx={{ mb: 1.5 }} />
          <TextField
            size="small" fullWidth type="datetime-local" label={t('common:field.from')}
            value={draftStart} onChange={(e) => setDraftStart(e.target.value)}
            sx={{ mb: 1.25 }} slotProps={{
            inputLabel: { shrink: true }
          }}
          />
          <TextField
            size="small" fullWidth type="datetime-local" label={t('common:field.to')}
            value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)}
            sx={{ mb: 1.5 }} slotProps={{
            inputLabel: { shrink: true }
          }}
          />
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => applyRange(undefined, undefined)} sx={{ textTransform: 'none', color: T.ink2 }}>
              {t('common:actions.clear')}
            </Button>
            <Button
              size="small" variant="contained"
              onClick={() => applyRange(draftStart || undefined, draftEnd || undefined)}
              sx={{ textTransform: 'none', bgcolor: 'var(--hotel-primary)', '&:hover': { bgcolor: 'var(--hotel-primary-hover)' } }}
            >
              {t('common:actions.apply')}
            </Button>
          </Box>
        </Menu>
      </Box>
      {/* Log panel */}
      <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, p: '14px 18px', borderBottom: `1px solid ${T.border}`, background: `linear-gradient(180deg, ${T.surface} 0%, ${T.surface2} 100%)` }}>
          <Box sx={{ width: 38, height: 38, borderRadius: '10px', bgcolor: activeDef.accSoft, color: activeDef.accDeep, display: 'grid', placeItems: 'center', border: `1px solid color-mix(in srgb, ${activeDef.acc} 18%, transparent)` }}>
            <activeDef.Icon sx={{ fontSize: 20 }} />
          </Box>
          <Box>
            <Box sx={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px' }}>{t(activeDef.nameKey)}</Box>
            <Box sx={{ fontSize: 11.5, color: T.ink3, mt: '2px', fontWeight: 500 }}>
              {t('audit.showingLine', { shown: pageRows.length, total })}
            </Box>
          </Box>
        </Box>

        {loading ? (
          <LogoLoader variant="page" />
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title={t('audit.emptyTitle')}
            description={t('audit.emptyDescription')}
          />
        ) : (
          grouped.map(([day, rows]) => (
            <React.Fragment key={day}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: '10px 18px', bgcolor: T.surface2, borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.ink3, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: T.ink4 }} />
                <span>{fmtDayLabel(day)}</span>
                <Box sx={{ ml: 'auto', color: T.ink3, fontWeight: 600 }}>{t('audit.eventCount', { count: rows.length })}</Box>
              </Box>
              {rows.map((r) => {
                const verb = deriveVerb(r.action);
                const vs = VERB_STYLE[verb];
                const open = !!openIds[r.id];
                const isSys = !r.username;
                const actionMeta = getActionLabel(r.action);
                const actionLabel = actionMeta.labelKey ? t(actionMeta.labelKey) : actionMeta.label;
                const resMeta = getResourceLabel(r.resource_type);
                const resLabel = resMeta.labelKey ? t(resMeta.labelKey) : resMeta.label;
                const detailAnalysis = analyzeDetails(r.details);
                const hasFieldChanges = r.has_changes ?? detailAnalysis.changes.length > 0;
                const changeSummary = hasFieldChanges
                  ? detailAnalysis.changes.length > 0
                    ? t('audit.fieldChanges', { count: detailAnalysis.changes.length })
                    : t('audit.kind.changes')
                  : t('audit.kind.action');
                return (
                  <Box key={r.id}>
                    <Box
                      onClick={() => setOpenIds((s) => ({ ...s, [r.id]: !s[r.id] }))}
                      sx={{
                        display: 'grid',
                        // xs previously read '16px 90px 1fr 110px': 216px of fixed
                        // track plus three 14px gaps against ~236px of usable row
                        // on a 320px viewport, which collapsed the 1fr column to
                        // 0px and pushed the action text off-page. The IP column
                        // is dropped on phones — it is still in the expanded row
                        // below (IP / Source) — and the flexible track is
                        // minmax(0, 1fr) so it can shrink rather than overflow.
                        gridTemplateColumns: {
                          xs: '16px 76px minmax(0, 1fr)',
                          md: '16px 92px 168px minmax(0, 1fr) 200px 120px',
                        },
                        alignItems: 'flex-start',
                        gap: { xs: 1, md: 1.75 },
                        p: { xs: '12px', md: '12px 18px' },
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
                        <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 10.5, fontWeight: 700, ...(isSys ? { bgcolor: T.slateSoft, color: T.ink2 } : { background: 'var(--hotel-success-bg)', color: 'var(--hotel-success)' }) }}>
                          {isSys ? <CronIcon sx={{ fontSize: 14 }} /> : initials(r.username || 'NA')}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.username || t('audit.system')}</Box>
                          <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 500 }}>{isSys ? t('audit.automated') : t('audit.userRef', { id: r.user_id })}</Box>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700, px: 1, py: '3px', borderRadius: '6px', whiteSpace: 'nowrap', flexShrink: 0, bgcolor: vs.bg, color: vs.fg }}>
                          {t(VERB_LABEL_KEYS[verb])}
                        </Box>
                        {/* `overflowWrap: anywhere` so a long resource label or
                            the inline #id pill breaks instead of running past
                            the row on a 320px viewport. */}
                        <Box sx={{ fontSize: 13, color: T.ink, lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
                            <Box component="span" sx={{ fontWeight: 600 }}>{actionLabel}</Box>
                            {!hasFieldChanges && (
                              <Tooltip title={t('audit.actionOnlyTooltip')}>
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35, fontSize: 10.5, fontWeight: 700, color: 'var(--hotel-warning)', bgcolor: 'var(--hotel-warning-bg)', border: '1px solid var(--hotel-warning-border)', px: 0.65, py: '1px', borderRadius: '999px', lineHeight: 1.4 }}>
                                  <ActionOnlyIcon sx={{ fontSize: 12 }} />
                                  {t('audit.kind.action')}
                                </Box>
                              </Tooltip>
                            )}
                          </Box>
                          <br />
                          <Box component="span" sx={{ color: T.ink2 }}>{resLabel}</Box>
                          {r.resource_id != null && (
                            <Box component="span" sx={{ display: 'inline-block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, bgcolor: T.surface3, color: T.ink2, px: 0.75, py: '1px', borderRadius: '5px', ml: 0.5 }}>
                              #{r.resource_id}
                            </Box>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12, color: T.ink3, fontWeight: 500 }}>
                        {changeSummary}
                      </Box>
                      <Box sx={{ display: { xs: 'none', md: 'block' }, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: T.ink2, fontWeight: 600, textAlign: { md: 'right' } }}>
                        {r.ip_address || '—'}
                        <Tooltip title={r.user_agent || ''}>
                          <Box sx={{ color: T.ink3, fontSize: 10, fontWeight: 500, mt: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.user_agent ? r.user_agent.slice(0, 22) : t('audit.server')}
                          </Box>
                        </Tooltip>
                      </Box>
                    </Box>
                    <Collapse in={open} unmountOnExit>
                      <Box sx={{ p: '14px 18px 16px 48px', bgcolor: T.surface, borderBottom: `1px solid ${T.border}`, borderTop: `1px dashed ${T.border}`, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                        <Box>
                          <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', mb: 1 }}>{t('audit.eventDetails')}</Box>
                          <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 12.5 }}>
                            <Box sx={{ color: T.ink3 }}>{t('audit.eventId')}</Box><Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>#{r.id}</Box>
                            <Box sx={{ color: T.ink3 }}>{t('audit.timestamp')}</Box><Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{fmtDate(r.created_at)} · {fmtTime(r.created_at)}</Box>
                            <Box sx={{ color: T.ink3 }}>{t('audit.actor')}</Box><Box sx={{ fontWeight: 600 }}>{r.username || t('audit.system')} <Box component="span" sx={{ color: T.ink3, fontWeight: 500 }}>{r.user_id != null ? t('audit.userIdParen', { id: r.user_id }) : t('audit.automatedParen')}</Box></Box>
                            <Box sx={{ color: T.ink3 }}>{t('audit.stream')}</Box><Box sx={{ fontWeight: 600, textTransform: 'capitalize' }}>{r.category || activeCat}</Box>
                            <Box sx={{ color: T.ink3 }}>{t('audit.ip')}</Box><Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{r.ip_address || '—'}</Box>
                            <Box sx={{ color: T.ink3 }}>{t('audit.source')}</Box><Box sx={{ fontWeight: 600, wordBreak: 'break-word' }}>{r.user_agent || t('audit.server')}</Box>
                            <Box sx={{ color: T.ink3 }}>{t('audit.resourceLabel')}</Box><Box sx={{ fontWeight: 600 }}>{resLabel}{r.resource_id != null ? ` #${r.resource_id}` : ''}</Box>
                          </Box>
                        </Box>
                        <Box>
                          <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', mb: 1 }}>{t('audit.fieldChangesTitle')}</Box>
                          {detailAnalysis.changes.length > 0 ? (
                            <Box sx={{ bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '9px', overflow: 'hidden', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>
                              {detailAnalysis.changes.map((d, i) => (
                                <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 1.25, p: '6px 10px', borderBottom: i < detailAnalysis.changes.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                                  <Box sx={{ color: T.ink3, fontWeight: 600 }}>{d.k}</Box>
                                  <Box sx={{ color: T.rose, textDecoration: 'line-through', textDecorationColor: 'var(--hotel-danger-border)' }}>{d.from}</Box>
                                  <Box sx={{ color: 'var(--hotel-success)', fontWeight: 700 }}><Box component="span" sx={{ color: T.ink4, px: 0.5 }}>→</Box>{d.to}</Box>
                                </Box>
                              ))}
                            </Box>
                          ) : (
                            <Box sx={{ fontSize: 12, color: T.ink3, p: '10px 12px', bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '9px', display: 'flex', gap: 0.75, alignItems: 'center' }}>
                              <ActionOnlyIcon sx={{ fontSize: 16, color: 'var(--hotel-warning)' }} />
                              {t('audit.actionOnlyNote')}
                            </Box>
                          )}
                          {detailAnalysis.metadata.length > 0 && (
                            <Box sx={{ mt: 1.5 }}>
                              <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', mb: 1 }}>{t('audit.metadataTitle')}</Box>
                              <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '9px', overflow: 'hidden', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>
                                {detailAnalysis.metadata.map((d, i) => (
                                  <Box key={d.k} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 1.25, p: '6px 10px', borderBottom: i < detailAnalysis.metadata.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                                    <Box sx={{ color: T.ink3, fontWeight: 600 }}>{d.k}</Box>
                                    <Box sx={{ color: T.ink2, fontWeight: 600, wordBreak: 'break-word' }}>{d.v}</Box>
                                  </Box>
                                ))}
                              </Box>
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
            {total === 0 ? t('audit.noEvents') : t('audit.pageRange', { from: (curPage - 1) * pageSize + 1, to: Math.min(curPage * pageSize, total), total })}
          </span>
          <Box sx={{ flex: 1 }} />
          <span>{t('audit.rowsPerPage')}</span>
          <Select
            size="small"
            value={pageSize}
            onChange={(e) => setQuery((p) => ({ ...p, page_size: Number(e.target.value), page: 1 }))}
            sx={{ fontSize: 12, fontWeight: 600, '& .MuiSelect-select': { py: 0.5 } }}
          >
            {[25, 50, 100].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </Select>
          <Box sx={{ display: 'inline-flex', gap: '2px', ml: 1.5 }}>
            <IconButton size="small" disabled={curPage <= 1} onClick={() => setQuery((p) => ({ ...p, page: curPage - 1 }))} aria-label={t('common:pagination.previous')}>‹</IconButton>
            <Box sx={{ minWidth: 28, height: 28, borderRadius: '7px', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, bgcolor: T.ink, color: 'var(--hotel-bg)' }}>{curPage}</Box>
            <IconButton size="small" disabled={curPage >= totalPages} onClick={() => setQuery((p) => ({ ...p, page: curPage + 1 }))} aria-label={t('common:pagination.next')}>›</IconButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default AuditLogPage;
