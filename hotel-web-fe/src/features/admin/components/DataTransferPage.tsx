import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Alert,
  AlertTitle,
  Chip,
  Divider,
  Dialog,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Checkbox,
  CircularProgress,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Upload as UploadIcon,
  History as HistoryIcon,
  Close as CloseIcon,
  CheckCircle as SuccessIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Error as ErrorIcon,
  InsertDriveFile as FileIcon,
  CloudUpload as CloudUploadIcon,
  Article as TemplateIcon,
  ArrowForward as ArrowForwardIcon,
  AutoAwesome as PresetIcon,
  AccountTree as DependencyIcon,
  Tune as TuneIcon,
  Insights as OperationalIcon,
  Hotel as RoomIcon,
  Category as RoomTypeIcon,
  Business as CompanyIcon,
  Person as GuestIcon,
  EventAvailable as BookingIcon,
  Groups as BookingGuestsIcon,
  EditNote as ModificationIcon,
  Timeline as BookingHistoryIcon,
  Payments as PaymentIcon,
  ReceiptLong as InvoiceIcon,
  AccountBalance as LedgerIcon,
  Paid as LedgerPaymentIcon,
  Nightlight as AuditRunIcon,
  ListAlt as AuditDetailIcon,
  SwapHoriz as RoomChangeIcon,
  Link as UserGuestIcon,
  CardGiftcard as CreditIcon,
  Settings as SettingsIcon,
  Hub as ChannelIcon,
  Sell as RatePlanIcon,
  PriceChange as RoomRateIcon,
  Spa as AmenityIcon,
  Checklist as RoomTypeAmenityIcon,
  RoomService as ServiceIcon,
  MiscellaneousServices as BookingServiceIcon,
  Route as TransitionIcon,
  Restore as RoomHistoryIcon,
  ManageHistory as RoomStatusLogIcon,
  Email as EmailIcon,
  CardMembership as LoyaltyProgramIcon,
  WorkspacePremium as LoyaltyTierIcon,
  Toll as PointsIcon,
  Redeem as RewardCatalogIcon,
  EmojiEvents as RewardRedemptionIcon,
  CorporateFare as CorporateAccountIcon,
  Contacts as CorporateContactIcon,
  CleaningServices as HousekeepingIcon,
  Handyman as MaintenanceIcon,
  Description as GuestDocumentIcon,
  Notes as GuestNoteIcon,
  Recommend as GuestPreferenceIcon,
  RateReview as GuestReviewIcon,
  Login as SelfCheckinIcon,
  NightsStay as PostedNightIcon,
} from '@mui/icons-material';
import { BookingDataExport, ImportResult } from '../../../api';
import type { ImportMode } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { useExportDataMutation, useExportPreviewMutation, useImportDataMutation } from '../hooks/useDataTransferQueries';
import { formatLocalDate } from '../../../utils/date';
import { storage } from '../../../utils/storage';
import {
  ALL_CATEGORY_IDS,
  CATEGORY_DEFS,
  type CategoryDef,
  type CategoryId,
  type Selection,
  buildSelection,
  deselectWithDependents,
  directDependencies,
  getMissingDependencies,
  getOverwriteRisks,
  nameOf,
  SAFE_PRESETS,
  selectWithDependencies,
  toggleCategory,
} from '../utils/dataTransferDependencies';

// ---------------------------------------------------------------------------
// The dependency graph, names, and grouping live in the shared, unit-tested
// model (../utils/dataTransferDependencies). Only the icons — which can't live
// in a pure module — are defined here, keyed by the same category ids.
// ---------------------------------------------------------------------------

const ICONS: Record<CategoryId, React.ReactElement> = {
  room_types: <RoomTypeIcon />,
  rooms: <RoomIcon />,
  companies: <CompanyIcon />,
  guests: <GuestIcon />,
  bookings: <BookingIcon />,
  booking_guests: <BookingGuestsIcon />,
  booking_modifications: <ModificationIcon />,
  booking_history: <BookingHistoryIcon />,
  payments: <PaymentIcon />,
  invoices: <InvoiceIcon />,
  customer_ledgers: <LedgerIcon />,
  customer_ledger_payments: <LedgerPaymentIcon />,
  night_audit_runs: <AuditRunIcon />,
  night_audit_details: <AuditDetailIcon />,
  room_changes: <RoomChangeIcon />,
  user_guests: <UserGuestIcon />,
  guest_complimentary_credits: <CreditIcon />,
  system_settings: <SettingsIcon />,
  rate_plans: <RatePlanIcon />,
  room_rates: <RoomRateIcon />,
  amenities: <AmenityIcon />,
  room_type_amenities: <RoomTypeAmenityIcon />,
  services: <ServiceIcon />,
  booking_services: <BookingServiceIcon />,
  booking_channels: <ChannelIcon />,
  room_status_transitions: <TransitionIcon />,
  room_history: <RoomHistoryIcon />,
  room_status_change_log: <RoomStatusLogIcon />,
  email_templates: <EmailIcon />,
  loyalty_programs: <LoyaltyProgramIcon />,
  loyalty_program_rules: <LoyaltyProgramIcon />,
  loyalty_tiers: <LoyaltyTierIcon />,
  loyalty_memberships: <LoyaltyProgramIcon />,
  loyalty_members: <LoyaltyProgramIcon />,
  loyalty_accounts: <LoyaltyProgramIcon />,
  points_transactions: <PointsIcon />,
  loyalty_transactions: <PointsIcon />,
  reward_catalog: <RewardCatalogIcon />,
  loyalty_rewards: <RewardCatalogIcon />,
  reward_redemptions: <RewardRedemptionIcon />,
  loyalty_redemptions: <RewardRedemptionIcon />,
  corporate_accounts: <CorporateAccountIcon />,
  corporate_account_contacts: <CorporateContactIcon />,
  housekeeping_tasks: <HousekeepingIcon />,
  maintenance_tickets: <MaintenanceIcon />,
  guest_documents: <GuestDocumentIcon />,
  guest_notes: <GuestNoteIcon />,
  guest_preferences: <GuestPreferenceIcon />,
  guest_reviews: <GuestReviewIcon />,
  self_checkin_events: <SelfCheckinIcon />,
  night_audit_posted_nights: <PostedNightIcon />,
};

const SYSTEM_CATEGORIES = CATEGORY_DEFS.filter((c) => c.group === 'system');
const OPERATIONAL_CATEGORIES = CATEGORY_DEFS.filter((c) => c.group === 'operational');

type Tab = 'export' | 'import' | 'history';

interface HistoryEntry {
  id: string;
  type: 'export' | 'import';
  mode?: ImportMode;
  categories: string;
  records: number;
  by: string;
  at: number; // epoch ms
  status: 'success' | 'partial' | 'failed';
  error?: string;
}

const HISTORY_LIMIT = 30;

const emptySelection = (): Selection => buildSelection([]);

const formatNum = (n: number) => n.toLocaleString('en-US');

const formatWhen = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Copies one category's rows from `source` into `target` (or `[]` when unselected).
// A plain `target[id] = keep ? source[id] ?? [] : []` does not type-check when `id`
// is a plain `CategoryId`-typed value: TypeScript can only correlate the read/write
// element types on both sides of a keyed assignment through a generic type
// parameter, not a concrete union type. Keeping `id` generic here is what lets
// `target[id]`/`source[id]` line up per category without an `any`/`as any` escape.
function assignCategoryRows<K extends CategoryId>(
  target: Partial<BookingDataExport>,
  source: BookingDataExport,
  id: K,
  keep: boolean
): void {
  target[id] = keep ? source[id] ?? [] : [];
}

const DataTransferPage: React.FC = () => {
  const theme = useTheme();
  const { hasPermission, user } = useAuth();

  const [tab, setTab] = useState<Tab>('export');
  const [selected, setSelected] = useState<Selection>(emptySelection);
  const [exportCounts, setExportCounts] = useState<Record<string, number> | null>(null);

  const [importFile, setImportFile] = useState<BookingDataExport | null>(null);
  const [importFileName, setImportFileName] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('import');
  const [ack, setAck] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false,
    msg: '',
    severity: 'success',
  });

  const [history, setHistory] = useState<HistoryEntry[]>(
    () => storage.getItem<HistoryEntry[]>('dataTransferHistory') || []
  );

  const exportPreviewMutation = useExportPreviewMutation();
  const exportMutation = useExportDataMutation();
  const importMutation = useImportDataMutation();
  const previewBusy = exportPreviewMutation.isPending;
  const exportBusy = exportMutation.isPending;
  const importBusy = importMutation.isPending;
  const busy = previewBusy || exportBusy || importBusy;

  const performedBy = user?.full_name || user?.username || 'Unknown user';
  const isImportContext = tab === 'import' && !!importFile;

  const selectedIds = useMemo(
    () => ALL_CATEGORY_IDS.filter((id) => selected[id]),
    [selected]
  );

  // Record count for a category: from the parsed file in import context,
  // otherwise from the last preview/export's cached counts.
  const countOf = (id: CategoryId): number | null => {
    if (isImportContext) return importFile?.[id]?.length ?? 0;
    if (exportCounts) return exportCounts[id] ?? 0;
    return null;
  };

  const selectedRecords = useMemo(
    () =>
      selectedIds.reduce((sum, id) => {
        let n = 0;
        if (isImportContext) n = importFile?.[id]?.length ?? 0;
        else if (exportCounts) n = exportCounts[id] ?? 0;
        return sum + n;
      }, 0),
    [selectedIds, importFile, exportCounts, isImportContext]
  );

  const selectedCategoryNames = () => {
    const names = selectedIds.map((id) => nameOf(id));
    if (names.length === 0) return '—';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  };

  const countsFromExportData = (data: BookingDataExport): Record<string, number> => {
    const counts: Record<string, number> = {};
    ALL_CATEGORY_IDS.forEach((id) => (counts[id] = data[id]?.length ?? 0));
    return counts;
  };

  const selectedRecordCountFromCounts = (counts: Record<string, number>) =>
    selectedIds.reduce((sum, id) => sum + (counts[id] ?? 0), 0);

  if (!hasPermission('settings:manage')) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">You do not have permission to manage data transfer.</Alert>
      </Box>
    );
  }

  // Forward integrity: selected categories missing a parent (data-loss risk).
  const missingDeps = getMissingDependencies(selectedIds);
  // Reverse integrity for overwrite: parents whose unselected children would be
  // cascade-deleted or orphaned (data-leakage risk).
  const overwriteRisks = getOverwriteRisks(selectedIds);
  const previewWarnings: { severity: 'warning' | 'error'; text: string }[] = [
    ...missingDeps.map((m) => ({
      severity: 'error' as const,
      text: `${nameOf(m.id)} is selected but its required ${m.missing.map(nameOf).join(', ')} ${
        m.missing.length > 1 ? 'are' : 'is'
      } not — those rows may fail to import.`,
    })),
    ...(importMode === 'overwrite'
      ? overwriteRisks.map((r) => ({
          severity: r.blocked.length ? ('error' as const) : ('warning' as const),
          text: `Overwriting ${nameOf(r.id)} will ${[
            r.cascade.length ? `delete ${r.cascade.map(nameOf).join(', ')}` : '',
            r.orphan.length ? `orphan ${r.orphan.map(nameOf).join(', ')}` : '',
            r.blocked.length ? `be blocked by ${r.blocked.map(nameOf).join(', ')}` : '',
          ]
            .filter(Boolean)
            .join(' and ')} (not selected).`,
        }))
      : []),
  ];

  // -- selection helpers (dependency-aware) ---------------------------------
  // Toggling a category on pulls in the parents it references; toggling it off
  // removes the children that depend on it — so the selection is always
  // referentially complete and cannot silently drop or orphan data.
  const toggle = (id: CategoryId) => {
    const wasOn = !!selected[id];
    const { selection, affected } = toggleCategory(selected, id);
    setSelected(selection);
    if (affected.length) {
      notify(
        wasOn
          ? `Also removed ${affected.map(nameOf).join(', ')} — they depend on ${nameOf(id)}.`
          : `Also selected ${affected.map(nameOf).join(', ')} — ${nameOf(id)} depends on them.`,
        'info'
      );
    }
  };

  const selectGroup = (ids: CategoryId[]) => {
    let next: Selection = selected;
    const added: CategoryId[] = [];
    ids.forEach((id) => {
      const res = selectWithDependencies(next, id);
      next = res.selection;
      added.push(...res.affected);
    });
    setSelected(next);
    const extra = [...new Set(added)].filter((a) => !ids.includes(a));
    if (extra.length) notify(`Also selected ${extra.map(nameOf).join(', ')} (required dependencies).`, 'info');
  };

  const clearGroup = (ids: CategoryId[]) => {
    let next: Selection = selected;
    ids.forEach((id) => {
      next = deselectWithDependents(next, id).selection;
    });
    setSelected(next);
  };

  const applyPreset = (categories: CategoryId[], label: string) => {
    setSelected(buildSelection(categories));
    notify(`Applied "${label}" — ${categories.length} categories selected.`, 'info');
  };

  // -- persistence ----------------------------------------------------------
  const pushHistory = (entry: Omit<HistoryEntry, 'id' | 'at' | 'by'>) => {
    const full: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      by: performedBy,
    };
    setHistory((prev) => {
      const next = [full, ...prev].slice(0, HISTORY_LIMIT);
      storage.setItem('dataTransferHistory', next);
      return next;
    });
  };

  const notify = (msg: string, severity: typeof toast.severity = 'success') =>
    setToast({ open: true, msg, severity });

  // -- export ---------------------------------------------------------------
  const handlePreviewExport = async () => {
    if (selectedIds.length === 0) {
      notify('Select at least one category to preview.', 'warning');
      return;
    }
    try {
      const preview = await exportPreviewMutation.mutateAsync();
      setExportCounts(preview.counts);
      const records = selectedRecordCountFromCounts(preview.counts);
      notify(`Preview ready — ${formatNum(records)} records will be exported.`, 'info');
    } catch (err) {
      notify(err instanceof Error && err.message ? err.message : 'Failed to preview export data.', 'error');
    }
  };

  const handleExport = async () => {
    if (selectedIds.length === 0) {
      notify('Select at least one category to export.', 'warning');
      return;
    }
    try {
      const data = await exportMutation.mutateAsync();

      // Cache counts so the export cards can show record totals afterwards.
      const counts = countsFromExportData(data);
      setExportCounts(counts);

      // filter the payload down to the selected categories (client-side)
      const filtered: Partial<BookingDataExport> = { version: data.version, exported_at: data.exported_at };
      ALL_CATEGORY_IDS.forEach((id) => {
        assignCategoryRows(filtered, data, id, selected[id]);
      });

      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hotel-data-export-${formatLocalDate()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const records = selectedRecordCountFromCounts(counts);
      pushHistory({ type: 'export', categories: selectedCategoryNames(), records, status: 'success' });
      notify(`Export ready — ${formatNum(records)} records downloaded.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      pushHistory({ type: 'export', categories: selectedCategoryNames(), records: 0, status: 'failed', error: message });
      notify(message || 'Failed to export data.', 'error');
    }
  };

  // -- import: file handling ------------------------------------------------
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as BookingDataExport;
        if (!data.version || !Array.isArray(data.bookings)) {
          notify('Invalid file format — please select a valid export file.', 'error');
          return;
        }
        setImportFile(data);
        setImportFileName(file.name);
        // pre-select every category that has rows, then close over their
        // dependencies so the initial selection is referentially complete.
        const present = ALL_CATEGORY_IDS.filter((id) => (data[id]?.length ?? 0) > 0);
        let sel = emptySelection();
        present.forEach((id) => {
          sel = selectWithDependencies(sel, id).selection;
        });
        setSelected(sel);
        setImportResult(null);
        notify(`File parsed — ${present.length} categor${present.length === 1 ? 'y' : 'ies'} detected.`);
      } catch {
        notify('Failed to parse JSON — please select a valid export file.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const removeFile = () => {
    setImportFile(null);
    setImportFileName('');
    setSelected(emptySelection());
    setImportResult(null);
  };

  const openPreview = () => {
    if (selectedIds.length === 0) {
      notify('Select at least one category to import.', 'warning');
      return;
    }
    setPreviewOpen(true);
  };

  const gotoConfirm = () => {
    setPreviewOpen(false);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setAck(false);
  };

  const commit = async () => {
    if (!importFile || !ack) {
      notify('Please acknowledge before importing.', 'warning');
      return;
    }
    // build a payload with only the selected categories' rows
    const payload: Partial<BookingDataExport> = { version: importFile.version, exported_at: importFile.exported_at };
    ALL_CATEGORY_IDS.forEach((id) => {
      assignCategoryRows(payload, importFile, id, selected[id]);
    });

    const records = selectedRecords;
    const names = selectedCategoryNames();
    try {
      const result = await importMutation.mutateAsync({ mode: importMode, data: payload as BookingDataExport, tables: selectedIds });
      setImportResult(result);
      const failed = result.errors ? Object.values(result.errors).reduce((a, e) => a + (e.failed || 0), 0) : 0;
      pushHistory({
        type: 'import',
        mode: importMode,
        categories: names,
        records,
        status: failed > 0 ? 'partial' : 'success',
        error: failed > 0 ? `${failed} record(s) skipped — references could not be resolved.` : undefined,
      });
      closeConfirm();
      removeFile();
      setTab('history');
      notify(failed > 0 ? `Import completed with ${failed} skipped record(s).` : 'Import committed successfully.', failed > 0 ? 'warning' : 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      pushHistory({ type: 'import', mode: importMode, categories: names, records: 0, status: 'failed', error: message });
      closeConfirm();
      notify(message || 'Failed to import data.', 'error');
    }
  };

  // -- template -------------------------------------------------------------
  const downloadTemplate = () => {
    const template: Partial<BookingDataExport> = { version: '1.0', exported_at: new Date().toISOString() };
    ALL_CATEGORY_IDS.forEach((id) => (template[id] = []));
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hotel-import-template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('Template downloaded — hotel-import-template.json', 'info');
  };

  // =========================================================================
  // Rendering helpers
  // =========================================================================

  const sysIds = SYSTEM_CATEGORIES.map((c) => c.id);
  const opIds = OPERATIONAL_CATEGORIES.map((c) => c.id);
  const sysSelCount = sysIds.filter((id) => selected[id]).length;
  const opSelCount = opIds.filter((id) => selected[id]).length;

  const cardSx = {
    borderRadius: 3,
    border: `1px solid ${theme.palette.divider}`,
    bgcolor: 'background.paper',
  } as const;

  const CategoryCard: React.FC<{ meta: CategoryDef }> = ({ meta }) => {
    const checked = !!selected[meta.id];
    const count = countOf(meta.id);
    const depNames = directDependencies(meta.id).map(nameOf).join(', ');
    return (
      <Box
        onClick={() => toggle(meta.id)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1.75,
          minHeight: 166,
          height: '100%',
          cursor: 'pointer',
          borderRadius: 2,
          border: `1px solid ${checked ? theme.palette.primary.main : theme.palette.divider}`,
          bgcolor: checked ? alpha(theme.palette.primary.main, 0.06) : 'background.paper',
          transition: 'background-color .15s, border-color .15s, box-shadow .15s',
          '&:hover': {
            borderColor: checked ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.45),
            bgcolor: checked ? alpha(theme.palette.primary.main, 0.1) : theme.palette.action.hover,
            boxShadow: theme.shadows[1],
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color: 'primary.main',
              '& svg': { fontSize: 20 },
            }}
          >
            {ICONS[meta.id]}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                {meta.name}
              </Typography>
              {isImportContext && (
                <Chip
                  label={(count ?? 0) > 0 ? 'Detected' : 'Empty'}
                  size="small"
                  color={(count ?? 0) > 0 ? 'primary' : 'default'}
                  variant={(count ?? 0) > 0 ? 'filled' : 'outlined'}
                  sx={{ height: 18, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}
                />
              )}
            </Box>
          </Box>
          <Checkbox checked={checked} size="small" sx={{ p: 0.25, mt: -0.25 }} onClick={(e) => e.stopPropagation()} onChange={() => toggle(meta.id)} />
        </Box>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            fontSize: 12.5,
            lineHeight: 1.45,
            flex: 1
          }}>
          {meta.desc}
        </Typography>
        {(count != null || depNames) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 'auto', flexWrap: 'wrap' }}>
            {count != null && (
              <Chip
                label={`${formatNum(count)} records${isImportContext ? ' detected' : ''}`}
                size="small"
                variant="outlined"
                sx={{ height: 22, fontSize: 11, fontWeight: 700, maxWidth: '100%' }}
              />
            )}
            {depNames && (
              <Tooltip title={`Depends on: ${depNames}`}>
                <Chip
                  icon={<DependencyIcon sx={{ fontSize: '14px !important' }} />}
                  label={`Depends on: ${depNames}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    height: 22,
                    fontSize: 11,
                    fontWeight: 700,
                    maxWidth: '100%',
                    '& .MuiChip-label': {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  }}
                />
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
    );
  };

  const CategoryGrid: React.FC<{ cats: CategoryDef[] }> = ({ cats }) => (
    <Box
      sx={{
        p: 1.25,
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(3, minmax(0, 1fr))',
          xl: 'repeat(4, minmax(0, 1fr))',
        },
        gap: 1,
        alignItems: 'stretch',
      }}
    >
      {cats.map((c) => (
        <CategoryCard key={c.id} meta={c} />
      ))}
    </Box>
  );

  const Section: React.FC<{
    title: string;
    subtitle: string;
    icon: React.ReactElement;
    ids: CategoryId[];
    selCount: number;
    cats: CategoryDef[];
  }> = ({ title, subtitle, icon, ids, selCount, cats }) => (
    <Paper elevation={0} sx={cardSx}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          p: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: 'primary.main',
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 15 }}>{title}</Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                fontSize: 12.5
              }}>
              {subtitle}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 600
            }}>
            {selCount} of {ids.length} selected
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" onClick={() => selectGroup(ids)} sx={{ minWidth: 0, fontSize: 12, fontWeight: 700 }}>
              Select all
            </Button>
            <Typography variant="caption" sx={{
              color: "text.disabled"
            }}>
              ·
            </Typography>
            <Button size="small" color="inherit" onClick={() => clearGroup(ids)} sx={{ minWidth: 0, fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>
              Clear
            </Button>
          </Box>
        </Box>
      </Box>
      <CategoryGrid cats={cats} />
    </Paper>
  );

  const SummaryFooter: React.FC<{ recordsLabel: string; action: React.ReactNode }> = ({ recordsLabel, action }) => (
    <Paper
      elevation={0}
      sx={{
        ...cardSx,
        position: 'sticky',
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        p: 2,
        boxShadow: theme.shadows[3],
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 20, lineHeight: 1 }}>{selectedIds.length}</Typography>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            categories
          </Typography>
        </Box>
        <Divider orientation="vertical" flexItem />
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 20, lineHeight: 1 }}>
            {isImportContext || exportCounts ? formatNum(selectedRecords) : '—'}
          </Typography>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {recordsLabel}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>{action}</Box>
    </Paper>
  );

  const renderPresets = () => (
    <Paper elevation={0} sx={{ ...cardSx, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
        <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', '& svg': { fontSize: 18 } }}>
          <PresetIcon />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 14 }}>Suggested combinations</Typography>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Dependency-complete bundles — each pulls in the tables it references, so the result can never lose data.
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {SAFE_PRESETS.map((p) => {
          const active = p.categories.length === selectedIds.length && p.categories.every((c) => selected[c]);
          return (
            <Tooltip key={p.id} title={`${p.description} — ${p.categories.length} categories`}>
              <Chip
                label={p.label}
                onClick={() => applyPreset(p.categories, p.label)}
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                sx={{ fontWeight: 700, borderRadius: 2 }}
              />
            </Tooltip>
          );
        })}
      </Box>
    </Paper>
  );

  // =========================================================================
  // Views
  // =========================================================================

  const renderExport = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" icon={<DependencyIcon />} sx={{ borderRadius: 2 }}>
        <strong>References stay intact automatically.</strong> Selecting a category pulls in the tables it depends on;
        clearing one drops the records that depend on it — so the file is always self-contained.
      </Alert>
      {renderPresets()}
      <Section
        title="System Configuration"
        subtitle="Setup tables that define how the property operates."
        icon={<TuneIcon />}
        ids={sysIds}
        selCount={sysSelCount}
        cats={SYSTEM_CATEGORIES}
      />
      <Section
        title="Operational Data"
        subtitle="Live business records generated by day-to-day operations."
        icon={<OperationalIcon />}
        ids={opIds}
        selCount={opSelCount}
        cats={OPERATIONAL_CATEGORIES}
      />
      <SummaryFooter
        recordsLabel="records to export"
        action={
          <>
            <Button variant="text" startIcon={<TemplateIcon />} onClick={downloadTemplate} sx={{ fontWeight: 700 }}>
              Download template
            </Button>
            <Button
              variant="outlined"
              startIcon={previewBusy ? <CircularProgress size={18} color="inherit" /> : <InfoIcon />}
              onClick={handlePreviewExport}
              disabled={busy}
              sx={{ fontWeight: 700 }}
            >
              Preview counts
            </Button>
            <Button
              variant="contained"
              startIcon={exportBusy ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
              onClick={handleExport}
              disabled={busy}
              sx={{ fontWeight: 700 }}
            >
              Export selected data
            </Button>
          </>
        }
      />
    </Box>
  );

  const renderImportDropzone = () => (
    <Paper
      elevation={0}
      sx={{
        ...cardSx,
        p: 6,
        textAlign: 'center',
        borderStyle: 'dashed',
        borderWidth: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.1),
          color: 'primary.main',
          '& svg': { fontSize: 32 },
        }}
      >
        <CloudUploadIcon />
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: 18 }}>Select a backup file to import</Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.5,
            maxWidth: 480
          }}>
          Upload a previously exported <strong>.json</strong> file. Categories are detected automatically; you choose
          which to import and confirm before anything is written.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button variant="contained" component="label" startIcon={<UploadIcon />} sx={{ fontWeight: 700 }}>
          Select JSON file
          <input type="file" accept=".json,application/json" hidden onChange={handleFileSelect} />
        </Button>
        <Button variant="outlined" startIcon={<TemplateIcon />} onClick={downloadTemplate} sx={{ fontWeight: 700 }}>
          Download template
        </Button>
      </Box>
    </Paper>
  );

  const renderImportLoaded = () => {
    const detected = ALL_CATEGORY_IDS.filter((id) => (importFile?.[id]?.length ?? 0) > 0).length;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper elevation={0} sx={{ ...cardSx, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>
              <FileIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 14 }} noWrap>
                {importFileName}
              </Typography>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                {detected} categories detected · parsed successfully
              </Typography>
            </Box>
          </Box>
          <Button color="inherit" startIcon={<CloseIcon />} onClick={removeFile} sx={{ color: 'text.secondary', fontWeight: 600 }}>
            Remove file
          </Button>
        </Paper>
        <Alert severity="warning" icon={<WarningIcon />} sx={{ borderRadius: 2 }}>
          <strong>Operational data depends on system configuration.</strong> Selecting a category auto-includes the
          tables it references; categories required by your selection are pulled in for you.
        </Alert>
        {renderPresets()}
        <Section
          title="System Configuration"
          subtitle="Import these first so operational references resolve."
          icon={<TuneIcon />}
          ids={sysIds}
          selCount={sysSelCount}
          cats={SYSTEM_CATEGORIES}
        />
        <Section
          title="Operational Data"
          subtitle="References are checked against the file before import."
          icon={<OperationalIcon />}
          ids={opIds}
          selCount={opSelCount}
          cats={OPERATIONAL_CATEGORIES}
        />
        <SummaryFooter
          recordsLabel="records to import"
          action={
            <Button variant="contained" startIcon={<SuccessIcon />} onClick={openPreview} sx={{ fontWeight: 700 }}>
              Preview &amp; import
            </Button>
          }
        />
      </Box>
    );
  };

  const renderHistory = () => (
    <Paper elevation={0} sx={cardSx}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>Transfer History</Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            fontSize: 12.5
          }}>
          Every export and import performed on this device is logged with the user, time, and outcome.
        </Typography>
      </Box>
      {history.length === 0 ? (
        <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
          <HistoryIcon sx={{ fontSize: 40, opacity: 0.4, mb: 1 }} />
          <Typography variant="body2">No transfers recorded yet.</Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Action</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Categories</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Records
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Performed by</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Date &amp; time</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
                      <Box sx={{ width: 26, height: 26, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', '& svg': { fontSize: 16 } }}>
                        {h.type === 'import' ? <UploadIcon /> : <DownloadIcon />}
                      </Box>
                      {h.type === 'import' ? `Import${h.mode === 'overwrite' ? ' (overwrite)' : ''}` : 'Export'}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" sx={{ fontSize: 12.5 }}>
                      {h.categories}
                    </Typography>
                    {h.error && (
                      <Typography variant="caption" sx={{
                        color: "error.main"
                      }}>
                        {h.error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{formatNum(h.records)}</TableCell>
                  <TableCell>{h.by}</TableCell>
                  <TableCell>{formatWhen(h.at)}</TableCell>
                  <TableCell>
                    <Chip
                      label={h.status === 'success' ? 'Success' : h.status === 'partial' ? 'Partial' : 'Failed'}
                      size="small"
                      color={h.status === 'success' ? 'success' : h.status === 'partial' ? 'warning' : 'error'}
                      sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );

  // =========================================================================
  // Main layout
  // =========================================================================

  return (
    <Box sx={{ p: 3, maxWidth: 1320, mx: 'auto' }}>
      {/* Title row */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Data Transfer
            </Typography>
            <Chip
              label="settings:manage"
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}
            />
          </Box>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 0.5,
              maxWidth: 680
            }}>
            Export, import, and migrate property data. System configuration and operational records are grouped so you
            can move exactly what you need without breaking references.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<TemplateIcon />} onClick={downloadTemplate} sx={{ fontWeight: 700 }}>
            Download template
          </Button>
          <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => setTab('history')} sx={{ fontWeight: 700 }}>
            Transfer history
          </Button>
        </Box>
      </Box>
      {/* Tabs */}
      <ToggleButtonGroup
        value={tab}
        exclusive
        onChange={(_, v) => v && setTab(v)}
        sx={{
          mb: 3,
          bgcolor: alpha(theme.palette.text.primary, 0.04),
          borderRadius: 2,
          p: 0.5,
          '& .MuiToggleButton-root': {
            border: 'none',
            borderRadius: 1.5,
            px: 2,
            py: 0.75,
            fontWeight: 700,
            textTransform: 'none',
            color: 'text.secondary',
            '&.Mui-selected': {
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': { bgcolor: 'primary.dark' },
            },
          },
        }}
      >
        <ToggleButton value="export">
          <DownloadIcon sx={{ fontSize: 18, mr: 0.75 }} /> Export
        </ToggleButton>
        <ToggleButton value="import">
          <UploadIcon sx={{ fontSize: 18, mr: 0.75 }} /> Import
        </ToggleButton>
        <ToggleButton value="history">
          <HistoryIcon sx={{ fontSize: 18, mr: 0.75 }} /> History
        </ToggleButton>
      </ToggleButtonGroup>
      {tab === 'export' && renderExport()}
      {tab === 'import' && (importFile ? renderImportLoaded() : renderImportDropzone())}
      {tab === 'history' && renderHistory()}
      {/* Last import result */}
      {importResult && tab !== 'history' && (
        <Paper elevation={0} sx={{ ...cardSx, mt: 2, p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <SuccessIcon color="success" />
            <Typography sx={{ fontWeight: 700 }}>
              {importResult.mode === 'overwrite' ? 'Overwrite' : 'Import'} complete
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableBody>
                {Object.entries(importResult.records_imported).map(([key, count]) => {
                  const err = importResult.errors?.[key];
                  return (
                    <TableRow key={key}>
                      <TableCell>{nameOf(key as CategoryId)}</TableCell>
                      <TableCell align="right">
                        <Chip label={`${count} imported`} size="small" color={count > 0 ? 'success' : 'default'} />
                        {err && <Chip label={`${err.failed} failed`} size="small" color="error" sx={{ ml: 1 }} title={err.last_error} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
      {/* ===== Preview (pre-flight summary) modal ===== */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="sm" fullWidth slotProps={{
        paper: { sx: { borderRadius: 3 } }
      }}>
        <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>
              <InfoIcon />
            </Box>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontWeight: 800, fontSize: 16 }}>Import preview</Typography>
                <Chip label="Summary" size="small" sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
              </Box>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                Review what will be sent — nothing is written until you confirm.
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setPreviewOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            {[
              { label: 'Categories', value: selectedIds.length },
              { label: 'Records', value: formatNum(selectedRecords) },
              { label: 'Warnings', value: previewWarnings.length },
            ].map((s) => (
              <Paper key={s.label} variant="outlined" sx={{ flex: 1, p: 1.5, borderRadius: 2, textAlign: 'center' }}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>
                  {s.label}
                </Typography>
                <Typography sx={{ fontWeight: 800, fontSize: 20 }}>{s.value}</Typography>
              </Paper>
            ))}
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Records by category
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
            {selectedIds.map((id) => {
              return (
                <Box key={id} sx={{ display: 'flex', justifyContent: 'space-between', px: 1.5, py: 1, borderRadius: 1.5, bgcolor: theme.palette.action.hover }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {nameOf(id)}
                  </Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {formatNum(countOf(id) ?? 0)} records
                  </Typography>
                </Box>
              );
            })}
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Validation
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              {importMode === 'overwrite'
                ? 'Overwrite mode replaces all existing records in the selected categories.'
                : 'Merge mode adds new records; existing records with matching identifiers are skipped.'}
            </Alert>
            {previewWarnings.map((w, i) => (
              <Alert key={i} severity={w.severity} sx={{ borderRadius: 2 }}>
                {w.text}
              </Alert>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2.5, justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Import runs in a single transaction.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={() => setPreviewOpen(false)} color="inherit">
              Back
            </Button>
            <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={gotoConfirm} sx={{ fontWeight: 700 }}>
              Continue
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
      {/* ===== Confirm dialog ===== */}
      <Dialog open={confirmOpen} onClose={closeConfirm} maxWidth="xs" fullWidth slotProps={{
        paper: { sx: { borderRadius: 3 } }
      }}>
        <DialogContent sx={{ p: 3, textAlign: 'center' }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              mx: 'auto',
              mb: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(importMode === 'overwrite' ? theme.palette.error.main : theme.palette.warning.main, 0.12),
              color: importMode === 'overwrite' ? 'error.main' : 'warning.main',
              '& svg': { fontSize: 30 },
            }}
          >
            {importMode === 'overwrite' ? <ErrorIcon /> : <WarningIcon />}
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: 18, mb: 1 }}>Confirm import</Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2
            }}>
            You're about to import <strong>{formatNum(selectedRecords)} records</strong> across{' '}
            <strong>{selectedIds.length} categories</strong>. This action is logged to the transfer history.
          </Typography>

          <ToggleButtonGroup
            value={importMode}
            exclusive
            fullWidth
            size="small"
            onChange={(_, v) => v && setImportMode(v)}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="import" sx={{ textTransform: 'none', fontWeight: 700 }}>
              Merge (skip duplicates)
            </ToggleButton>
            <ToggleButton value="overwrite" sx={{ textTransform: 'none', fontWeight: 700 }}>
              Overwrite (replace all)
            </ToggleButton>
          </ToggleButtonGroup>

          {importMode === 'overwrite' && (
            <Alert severity="error" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
              <AlertTitle sx={{ fontWeight: 700 }}>This deletes all existing data first</AlertTitle>
              Overwrite removes existing records before inserting. Only the selected categories will be restored — make
              sure you have a backup.
              {overwriteRisks.length > 0 && (
                <Box component="ul" sx={{ m: '8px 0 0', pl: 2.5 }}>
                  {overwriteRisks.map((r) => {
                    const parts = [
                      r.cascade.length ? `deletes ${r.cascade.map(nameOf).join(', ')}` : '',
                      r.orphan.length ? `orphans ${r.orphan.map(nameOf).join(', ')}` : '',
                      r.blocked.length ? `is blocked by ${r.blocked.map(nameOf).join(', ')}` : '',
                    ].filter(Boolean);
                    return (
                      <li key={r.id}>
                        <strong>{nameOf(r.id)}</strong> {parts.join(' and ')} (not selected).
                      </li>
                    );
                  })}
                </Box>
              )}
            </Alert>
          )}

          {missingDeps.length > 0 && (
            <Alert severity="warning" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
              <AlertTitle sx={{ fontWeight: 700 }}>Missing dependencies</AlertTitle>
              {missingDeps.map((m) => (
                <Box key={m.id}>
                  <strong>{nameOf(m.id)}</strong> needs {m.missing.map(nameOf).join(', ')}.
                </Box>
              ))}
            </Alert>
          )}

          <Box
            onClick={() => setAck((a) => !a)}
            sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.5, borderRadius: 2, bgcolor: theme.palette.action.hover, cursor: 'pointer', textAlign: 'left' }}
          >
            <Checkbox checked={ack} size="small" sx={{ p: 0 }} onChange={() => setAck((a) => !a)} onClick={(e) => e.stopPropagation()} />
            <Typography variant="body2">
              I understand this may overwrite existing data and that the action will be recorded.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button onClick={closeConfirm} color="inherit" fullWidth>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={importMode === 'overwrite' ? 'error' : 'primary'}
            fullWidth
            disabled={!ack || busy}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <UploadIcon />}
            onClick={commit}
            sx={{ fontWeight: 700 }}
          >
            Import {formatNum(selectedRecords)} records
          </Button>
        </DialogActions>
      </Dialog>
      {/* ===== Toast ===== */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3800}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setToast((t) => ({ ...t, open: false }))}
          severity={toast.severity}
          variant="filled"
          sx={{ borderRadius: 2 }}
        >
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DataTransferPage;
