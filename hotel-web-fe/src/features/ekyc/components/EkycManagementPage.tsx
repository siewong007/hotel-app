import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AssignmentInd as ClaimIcon,
  Cancel as RejectIcon,
  CheckCircle as ApproveIcon,
  Close as CloseIcon,
  FileDownload as ExportIcon,
  ImageNotSupported as ImageNotSupportedIcon,
  LockOpen as RevealIcon,
  PauseCircle as HoldIcon,
  PlayCircle as ReleaseIcon,
  Refresh as RefreshIcon,
  ReportProblem as EscalateIcon,
  RotateRight as RotateIcon,
  Search as SearchIcon,
  Visibility as ViewIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';
import { formatCalendarDate } from '../utils/reviewQueue';
import {
  EkycActionPayload,
  EkycApplicationDetail,
  EkycApplicationSummary,
  EkycListParams,
  EkycReasonCode,
  EkycService,
} from '../../../api/ekyc.service';
import { api } from '../../../api/client';
import { storage } from '../../../utils/storage';
import { useAuth } from '../../../auth/AuthContext';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { LogoLoader } from '../../../components';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { FilterSheet } from '../../../components/common/FilterSheet';
import {
  useAllEkycVerifications,
  useEkycApplication,
  useEkycReasonCodes,
  useRevealEkycField,
  useReviewEkycAction,
} from '../hooks/useEkycQueries';
import EkycCreateDialog from './EkycCreateDialog';
import { errorMessage } from '../../../utils/errorMessage';
import { formatStatusLabel } from '../../../utils/formatters';
import { useTranslation, statusLabel } from '../../../i18n';
import type { UseTranslationResult } from '../../../i18n/useTranslation';
import { formatHotelDateTime } from '../../../utils/date';

const STATUS_OPTIONS = [
  'submitted',
  'automated_review',
  'pending_manual_review',
  'in_review',
  'additional_information_required',
  'approved',
  'rejected',
  'escalated',
  'expired',
  'void',
  'on_hold',
];

const RISK_OPTIONS = ['low', 'medium', 'high', 'critical'];

const DEFAULT_FILTERS: EkycListParams = {
  page: 1,
  page_size: 10,
  sort_by: 'submitted_at',
  sort_order: 'desc',
};

const ACTION_KEY_PREFIX = 'actions.';

const ACTION_REASONS_REQUIRED = new Set([
  'approve',
  'reject',
  'escalate',
  'request_resubmission',
  'hold',
  'mark_potential_duplicate',
  'mark_fraud',
]);

function getSavedFilters(): EkycListParams {
  return storage.getItem<EkycListParams>('ekycAdminFilters') ?? DEFAULT_FILTERS;
}

function formatDate(value?: string | null): string {
  return formatHotelDateTime(value);
}

// Humanizes non-status enum codes (id types, reason codes, risk rules) whose
// full value set lives in the backend; status values go through statusLabel.
function labelize(value?: string | null): string {
  return formatStatusLabel(value, '-');
}

type T = UseTranslationResult['t'];
type TOr = UseTranslationResult['tOr'];
const actionLabel = (t: T, tOr: TOr, action: string): string =>
  tOr(`${ACTION_KEY_PREFIX}${action}`, formatStatusLabel(action, action));
const riskLabel = (t: T, tOr: TOr, risk?: string | null): string =>
  tOr(`riskLevels.${risk ?? ''}`, formatStatusLabel(risk, '-'));
const idTypeLabel = (t: T, tOr: TOr, idType?: string | null): string =>
  tOr(`idTypes.${idType ?? ''}`, formatStatusLabel(idType, '-'));
const ekycStatus = (t: T, value?: string | null): string =>
  statusLabel(t, 'ekyc', value);

// Distinct colour per eKYC status. MUI's Chip `color` prop only exposes a
// handful of palette names, so we style the chip directly to keep each status
// visually separable. Returned object is spread into the Chip `sx`.
const STATUS_CHIP_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: 'var(--hotel-neutral-bg)', fg: 'var(--hotel-neutral)' },
  submitted: { bg: 'var(--hotel-info-bg)', fg: 'var(--hotel-info)' },
  automated_review: { bg: 'var(--hotel-info-bg)', fg: 'var(--hotel-info)' },
  pending_manual_review: { bg: 'var(--hotel-warning-bg)', fg: 'var(--hotel-warning)' },
  in_review: { bg: 'var(--hotel-info-bg)', fg: 'var(--hotel-info)' },
  additional_information_required: { bg: 'var(--hotel-warning-bg)', fg: 'var(--hotel-warning)' },
  on_hold: { bg: 'var(--hotel-warning-bg)', fg: 'var(--hotel-warning)' },
  escalated: { bg: 'var(--hotel-danger-bg)', fg: 'var(--hotel-danger)' },
  approved: { bg: 'var(--hotel-success-bg)', fg: 'var(--hotel-success)' },
  rejected: { bg: 'var(--hotel-danger-bg)', fg: 'var(--hotel-danger)' },
  expired: { bg: 'var(--hotel-neutral-bg)', fg: 'var(--hotel-neutral)' },
  void: { bg: 'var(--hotel-neutral-bg)', fg: 'var(--hotel-neutral)' },
};

function statusChipSx(status: string) {
  const colors = STATUS_CHIP_COLORS[status] ?? { bg: 'var(--hotel-neutral-bg)', fg: 'var(--hotel-neutral)' };
  return {
    bgcolor: colors.bg,
    color: colors.fg,
    fontWeight: 600,
    '& .MuiChip-label': { color: colors.fg },
  };
}

function riskColor(risk: string): 'default' | 'success' | 'warning' | 'error' {
  if (risk === 'low') return 'success';
  if (risk === 'high' || risk === 'critical') return 'error';
  if (risk === 'medium') return 'warning';
  return 'default';
}

const SecureDocumentImage: React.FC<{
  applicationId: number;
  kind: 'id-front' | 'id-back' | 'selfie' | 'proof-of-address';
  alt: string;
}> = ({ applicationId, kind, alt }) => {
  const { t } = useTranslation('ekyc');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setImageUrl(null);
    setLoadState('loading');

    api
      .get(`ekyc/admin/applications/${applicationId}/documents/${kind}`)
      .blob()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
        setLoadState('ok');
      })
      .catch((err) => {
        if (cancelled) return;
        // A 404 means the file simply isn't on record; anything else is a
        // transient/load problem the user can retry.
        const status = err?.response?.status;
        setLoadState(status === 404 ? 'missing' : 'error');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [applicationId, kind, reloadKey]);

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 1,
          py: 0.5
        }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>{alt}</Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={t('doc.zoomOut')}>
            <span>
              <IconButton size="small" aria-label={t('doc.zoomOut')} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} disabled={!imageUrl}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('doc.zoomIn')}>
            <span>
              <IconButton size="small" aria-label={t('doc.zoomIn')} onClick={() => setZoom(value => Math.min(2, value + 0.25))} disabled={!imageUrl}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('doc.rotate')}>
            <span>
              <IconButton size="small" aria-label={t('doc.rotate')} onClick={() => setRotation(value => (value + 90) % 360)} disabled={!imageUrl}>
                <RotateIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <Box sx={{ height: 260, display: 'grid', placeItems: 'center', bgcolor: 'var(--hotel-surface-sunken)', overflow: 'auto' }}>
        {loadState === 'loading' && <LogoLoader variant="inline" />}
        {loadState === 'missing' && (
          <Stack
            spacing={0.5}
            sx={{
              alignItems: "center",
              color: 'text.disabled',
              px: 2,
              textAlign: 'center'
            }}>
            <ImageNotSupportedIcon fontSize="large" />
            <Typography variant="caption">{t('doc.missing')}</Typography>
          </Stack>
        )}
        {loadState === 'error' && (
          <Stack
            spacing={1}
            sx={{
              alignItems: "center",
              color: 'text.secondary',
              px: 2,
              textAlign: 'center'
            }}>
            <Typography variant="caption">{t('doc.loadError')}</Typography>
            <Button size="small" variant="outlined" onClick={() => setReloadKey(value => value + 1)}>
              {t('common:actions.retry')}
            </Button>
          </Stack>
        )}
        {loadState === 'ok' && imageUrl && (
          <Box
            component="img"
            src={imageUrl}
            alt={alt}
            sx={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: `rotate(${rotation}deg) scale(${zoom})`,
              transition: 'transform 160ms ease',
            }}
          />
        )}
      </Box>
    </Box>
  );
};

const MetricTile: React.FC<{ label: string; value: React.ReactNode; accent?: 'default' | 'warning' | 'error' | 'success' }> = ({
  label,
  value,
  accent = 'default',
}) => {
  const colors = {
    default: 'text.primary',
    warning: 'warning.main',
    error: 'error.main',
    success: 'success.main',
  } as const;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, minHeight: 88 }}>
      <Typography variant="caption" sx={{
        color: "text.secondary"
      }}>{label}</Typography>
      <Typography variant="h5" sx={{ color: colors[accent], mt: 0.5 }}>{value}</Typography>
    </Paper>
  );
};

const EkycManagementPage: React.FC = () => {
  const { t, tOr } = useTranslation('ekyc');
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<EkycListParams>(() => getSavedFilters());
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [actionMode, setActionMode] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [customerMessage, setCustomerMessage] = useState('');
  const [note, setNote] = useState('');
  const [selfCheckinEnabled, setSelfCheckinEnabled] = useState(true);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealField, setRevealField] = useState('id_number');
  const [revealReason, setRevealReason] = useState('');
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const { hasPermission } = useAuth();
  const canCreate = hasPermission('ekyc:approve');

  const listQuery = useAllEkycVerifications(filters);
  const detailQuery = useEkycApplication(selectedId);
  const reasonCodesQuery = useEkycReasonCodes();
  const reviewActionMutation = useReviewEkycAction();
  const revealMutation = useRevealEkycField();

  const listData = listQuery.data;
  const detail = detailQuery.data;
  const reasonCodes = reasonCodesQuery.data ?? [];
  const processing = reviewActionMutation.isPending || revealMutation.isPending;

  useEffect(() => {
    storage.setItem('ekycAdminFilters', filters);
  }, [filters]);

  useEffect(() => {
    const queryError = listQuery.error || detailQuery.error || reasonCodesQuery.error;
    if (queryError) {
      setError((queryError as Error).message || t('errors.loadData'));
    }
  }, [listQuery.error, detailQuery.error, reasonCodesQuery.error, t]);

  const selectedSummary = useMemo(() => {
    return listData?.data.find(item => item.id === selectedId) ?? detail?.summary;
  }, [detail?.summary, listData?.data, selectedId]);

  const setFilter = <K extends keyof EkycListParams>(key: K, value: EkycListParams[K]) => {
    setFilters(current => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value as number : 1,
    }));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const openAction = (action: string) => {
    setActionMode(action);
    setReasonCode('');
    setReason('');
    setCustomerMessage('');
    setNote('');
    setSelfCheckinEnabled(action === 'approve');
  };

  const closeAction = () => {
    setActionMode(null);
    setReasonCode('');
    setReason('');
    setCustomerMessage('');
    setNote('');
  };

  const submitAction = async () => {
    if (!detail || !actionMode) return;

    const payload: EkycActionPayload = {
      action: actionMode,
      expected_version: detail.summary.version,
      idempotency_key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    };
    if (reasonCode) payload.reason_code = reasonCode;
    if (reason.trim()) payload.reason = reason.trim();
    if (note.trim()) payload.note = note.trim();
    if (customerMessage.trim()) payload.customer_message = customerMessage.trim();
    if (actionMode === 'approve') payload.self_checkin_enabled = selfCheckinEnabled;

    try {
      const updated = await reviewActionMutation.mutateAsync({
        applicationId: detail.summary.id,
        payload,
      });
      setSelectedId(updated.summary.id);
      closeAction();
    } catch (err) {
      setError(errorMessage(err, t('errors.action')));
    }
  };

  const revealFieldValue = async () => {
    if (!detail) return;
    try {
      const result = await revealMutation.mutateAsync({
        applicationId: detail.summary.id,
        field: revealField,
        reason: revealReason,
      });
      setRevealedValue(result.value ?? '');
    } catch (err) {
      setError(errorMessage(err, t('errors.reveal')));
    }
  };

  const exportCsv = async () => {
    try {
      const blob = await EkycService.exportEkycApplications(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ekyc_applications.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, t('errors.export')));
    }
  };

  const metrics = listData?.metrics;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{
          justifyContent: "space-between"
        }}>
          <Box>
            <Typography variant="h5">{t('page.title')}</Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{t('page.subtitle')}</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title={t('common:actions.refresh')}>
              <span>
                <IconButton onClick={() => listQuery.refetch()} disabled={listQuery.isFetching} aria-label={t('page.refreshAria')}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="outlined" startIcon={<ExportIcon />} onClick={exportCsv}>
              {t('page.exportCsv')}
            </Button>
            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
                {t('page.create')}
              </Button>
            )}
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label={t('metrics.submitted')} value={metrics?.total_submitted ?? <Skeleton width={42} />} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label={t('metrics.pending')} value={metrics?.pending_review ?? <Skeleton width={42} />} accent="warning" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label={t('metrics.manual')} value={metrics?.under_manual_review ?? <Skeleton width={42} />} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label={t('metrics.approved')} value={metrics?.approved ?? <Skeleton width={42} />} accent="success" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label={t('metrics.highRisk')} value={metrics?.escalated_high_risk ?? <Skeleton width={42} />} accent="error" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile
              label={t('metrics.avgMinutes')}
              value={metrics?.average_processing_minutes != null ? Math.round(metrics.average_processing_minutes) : <Skeleton width={42} />}
            />
          </Grid>
        </Grid>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
          <Grid container spacing={1.5} sx={{
            alignItems: "center"
          }}>
            <Grid size={{ xs: 12, md: 3 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                fullWidth
                size="small"
                label={t('filters.search')}
                value={filters.search ?? ''}
                onChange={(event) => setFilter('search', event.target.value)}
                slotProps={{
                  input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }
                }}
              />
              {isPhone && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setFiltersOpen(true)}
                  sx={{ whiteSpace: 'nowrap', minHeight: 40 }}
                >
                  {t('filters.title')}
                </Button>
              )}
              </Stack>
            </Grid>
            {!isPhone && (
            <>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('filters.status')}</InputLabel>
                <Select label={t('filters.status')} value={filters.status ?? 'all'} onChange={(event) => setFilter('status', event.target.value)}>
                  <MenuItem value="all">{t('common:filters.all')}</MenuItem>
                  {STATUS_OPTIONS.map(status => (
                    <MenuItem key={status} value={status}>{ekycStatus(t, status)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('filters.orderBy')}</InputLabel>
                <Select
                  label={t('filters.orderBy')}
                  value={filters.sort_by ?? 'submitted_at'}
                  onChange={(event) => {
                    const sortBy = event.target.value;
                    // Arrival order is ascending — soonest first — where every
                    // other key reads newest-first. Sorting arrivals descending
                    // would bury the guest landing tomorrow behind next month's.
                    setFilters(current => ({
                      ...current,
                      page: 1,
                      sort_by: sortBy,
                      sort_order: sortBy === 'next_arrival' ? 'asc' : 'desc',
                    }));
                  }}
                >
                  <MenuItem value="submitted_at">{t('filters.sortNewest')}</MenuItem>
                  <MenuItem value="next_arrival">{t('filters.sortArrival')}</MenuItem>
                  <MenuItem value="risk_score">{t('filters.sortRisk')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('filters.risk')}</InputLabel>
                <Select label={t('filters.risk')} value={filters.risk_level ?? 'all'} onChange={(event) => setFilter('risk_level', event.target.value)}>
                  <MenuItem value="all">{t('common:filters.all')}</MenuItem>
                  {RISK_OPTIONS.map(risk => (
                    <MenuItem key={risk} value={risk}>{riskLabel(t, tOr, risk)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label={t('filters.country')}
                value={filters.country ?? ''}
                onChange={(event) => setFilter('country', event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label={t('filters.document')}
                value={filters.document_type ?? ''}
                onChange={(event) => setFilter('document_type', event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 1 }}>
              <Button fullWidth onClick={resetFilters}>{t('common:actions.reset')}</Button>
            </Grid>
            </>
            )}
          </Grid>
          <FilterSheet
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            onReset={resetFilters}
          >
            <FormControl fullWidth size="small">
              <InputLabel>{t('filters.status')}</InputLabel>
              <Select label={t('filters.status')} value={filters.status ?? 'all'} onChange={(event) => setFilter('status', event.target.value)}>
                <MenuItem value="all">{t('common:filters.all')}</MenuItem>
                {STATUS_OPTIONS.map(status => (
                  <MenuItem key={status} value={status}>{ekycStatus(t, status)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t('filters.orderBy')}</InputLabel>
              <Select
                label={t('filters.orderBy')}
                value={filters.sort_by ?? 'submitted_at'}
                onChange={(event) => {
                  const sortBy = event.target.value;
                  setFilters(current => ({
                    ...current,
                    page: 1,
                    sort_by: sortBy,
                    sort_order: sortBy === 'next_arrival' ? 'asc' : 'desc',
                  }));
                }}
              >
                <MenuItem value="submitted_at">{t('filters.sortNewest')}</MenuItem>
                <MenuItem value="next_arrival">{t('filters.sortArrival')}</MenuItem>
                <MenuItem value="risk_score">{t('filters.sortRisk')}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>{t('filters.risk')}</InputLabel>
              <Select label={t('filters.risk')} value={filters.risk_level ?? 'all'} onChange={(event) => setFilter('risk_level', event.target.value)}>
                <MenuItem value="all">{t('common:filters.all')}</MenuItem>
                {RISK_OPTIONS.map(risk => (
                  <MenuItem key={risk} value={risk}>{riskLabel(t, tOr, risk)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              size="small"
              label={t('filters.country')}
              value={filters.country ?? ''}
              onChange={(event) => setFilter('country', event.target.value)}
            />
            <TextField
              fullWidth
              size="small"
              label={t('filters.document')}
              value={filters.document_type ?? ''}
              onChange={(event) => setFilter('document_type', event.target.value)}
            />
          </FilterSheet>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden' }}>
          {listQuery.isFetching && <LinearProgress />}
          {isPhone ? (
            <Box>
              {listQuery.isLoading && Array.from({ length: 5 }).map((_, index) => (
                <Box key={index} sx={{ px: 2, py: 1.5 }}>
                  <Skeleton />
                  <Skeleton width="60%" />
                </Box>
              ))}
              {!listQuery.isLoading && (listData?.data.length ?? 0) === 0 && (
                <Typography
                  variant="body2"
                  align="center"
                  sx={{ color: "text.secondary", py: 4 }}
                >
                  {t('list.empty')}
                </Typography>
              )}
              {listData?.data.map(application => (
                <Box
                  key={application.id}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <MobileCardRow
                    selected={application.id === selectedId}
                    title={application.application_id}
                    subtitle={`${application.full_name ?? '-'} · ${idTypeLabel(t, tOr, application.id_type)}`}
                    meta={`${idTypeLabel(t, tOr, application.id_type)} ${application.id_number_masked ?? '-'} · ${t('list.submittedAt', { date: formatDate(application.submitted_at) })} · ${t('list.arrivesAt', { date: formatCalendarDate(application.next_arrival_date) })}${application.assigned_reviewer_name ? ` · ${application.assigned_reviewer_name}` : ''}`}
                    status={
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
                        <Chip size="small" sx={statusChipSx(application.status)} label={ekycStatus(t, application.status)} />
                        <Chip size="small" variant="outlined" color={riskColor(application.risk_level)} label={`${riskLabel(t, tOr, application.risk_level)} ${application.risk_score}`} />
                        {application.overdue_sla ? <Chip size="small" color="error" label={t('chips.overdue')} /> : null}
                        {!application.overdue_sla && application.nearing_sla ? <Chip size="small" color="warning" label={t('chips.nearSla')} /> : null}
                        {application.arrival_imminent ? <Chip size="small" color="warning" label={t('chips.arrivingSoon')} /> : null}
                      </Stack>
                    }
                    onClick={() => setSelectedId(application.id)}
                  />
                </Box>
              ))}
            </Box>
          ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('list.colApplication')}</TableCell>
                  <TableCell>{t('list.colCustomer')}</TableCell>
                  <TableCell>{t('list.colDocument')}</TableCell>
                  <TableCell>{t('list.colStatus')}</TableCell>
                  <TableCell>{t('list.colRisk')}</TableCell>
                  <TableCell>{t('list.colReviewer')}</TableCell>
                  <TableCell>{t('list.colSubmitted')}</TableCell>
                  <TableCell>{t('list.colArrives')}</TableCell>
                  <TableCell align="right">{t('list.colActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {listQuery.isLoading && Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={9}><Skeleton /></TableCell>
                  </TableRow>
                ))}
                {!listQuery.isLoading && (listData?.data.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography
                        variant="body2"
                        sx={{
                          color: "text.secondary",
                          py: 4
                        }}>
                        {t('list.empty')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {listData?.data.map(application => (
                  <TableRow key={application.id} hover selected={application.id === selectedId}>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body2" sx={{
                          fontWeight: 600
                        }}>{application.application_id}</Typography>
                        {application.overdue_sla && <Chip size="small" color="error" label={t('chips.overdue')} />}
                        {!application.overdue_sla && application.nearing_sla && <Chip size="small" color="warning" label={t('chips.nearSla')} />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{application.full_name ?? '-'}</Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>{application.email_masked ?? '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{idTypeLabel(t, tOr, application.id_type)}</Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>{application.id_number_masked ?? '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" sx={statusChipSx(application.status)} label={ekycStatus(t, application.status)} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{
                        alignItems: "center"
                      }}>
                        <Chip size="small" color={riskColor(application.risk_level)} label={riskLabel(t, tOr, application.risk_level)} />
                        <Typography variant="caption">{application.risk_score}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{application.assigned_reviewer_name ?? application.assigned_reviewer_id ?? '-'}</TableCell>
                    <TableCell>{formatDate(application.submitted_at)}</TableCell>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body2">
                          {formatCalendarDate(application.next_arrival_date)}
                        </Typography>
                        {application.arrival_imminent && (
                          <Chip size="small" color="warning" label={t('chips.arrivingSoon')} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('common:actions.view')}>
                        <IconButton size="small" aria-label={t('list.viewAria')} onClick={() => setSelectedId(application.id)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          )}
          <TablePagination
            component="div"
            count={listData?.total ?? 0}
            page={(filters.page ?? 1) - 1}
            rowsPerPage={filters.page_size ?? 10}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_event, page) => setFilter('page', page + 1)}
            onRowsPerPageChange={(event) => setFilters(current => ({ ...current, page: 1, page_size: Number(event.target.value) }))}
          />
        </Paper>
      </Stack>
      <Dialog open={Boolean(selectedId)} onClose={() => setSelectedId(undefined)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between"
            }}>
            <Box>
              <Typography variant="h6">{selectedSummary?.application_id ?? t('detail.titleFallback')}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                {selectedSummary && <Chip size="small" sx={statusChipSx(selectedSummary.status)} label={ekycStatus(t, selectedSummary.status)} />}
                {selectedSummary && <Chip size="small" color={riskColor(selectedSummary.risk_level)} label={`${riskLabel(t, tOr, selectedSummary.risk_level)} ${selectedSummary.risk_score}`} />}
              </Stack>
            </Box>
            <IconButton onClick={() => setSelectedId(undefined)} aria-label={t('detail.closeAria')}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {detailQuery.isLoading && <LinearProgress />}
          {detail && (
            <Stack spacing={2.5}>
              <DetailHeader detail={detail} onReveal={() => setRevealOpen(true)} />
              <ActionBar
                detail={detail}
                onAction={openAction}
                disabled={processing}
              />
              <DocumentSection detail={detail} />
              <ReviewSignals detail={detail} />
              <TimelineSection detail={detail} />
            </Stack>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(actionMode)} onClose={closeAction} maxWidth="sm" fullWidth>
        <DialogTitle>{actionMode ? actionLabel(t, tOr, actionMode) : t('detail.actionFallback')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {ACTION_REASONS_REQUIRED.has(actionMode ?? '') && (
              <FormControl fullWidth size="small">
                <InputLabel>{t('detail.reasonCode')}</InputLabel>
                <Select label={t('detail.reasonCode')} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                  {reasonCodes.map(code => (
                    <MenuItem key={code.code} value={code.code}>{code.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {ACTION_REASONS_REQUIRED.has(actionMode ?? '') && (
              <TextField
                fullWidth
                multiline
                minRows={3}
                label={t('detail.reason')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
            {actionMode === 'request_resubmission' && (
              <TextField
                fullWidth
                multiline
                minRows={2}
                label={t('detail.customerMessage')}
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
              />
            )}
            {actionMode === 'approve' && (
              <FormControlLabel
                control={<Checkbox checked={selfCheckinEnabled} onChange={(event) => setSelfCheckinEnabled(event.target.checked)} />}
                label={t('detail.enableSelfCheckin')}
              />
            )}
            <TextField
              fullWidth
              multiline
              minRows={2}
              label={t('detail.internalNote')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAction}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" onClick={submitAction} disabled={processing}>
            {processing ? <CircularProgress size={18} /> : t('common:actions.submit')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={revealOpen} onClose={() => setRevealOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('reveal.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('reveal.field')}</InputLabel>
              <Select label={t('reveal.field')} value={revealField} onChange={(event) => {
                setRevealField(event.target.value);
                setRevealedValue(null);
              }}>
                <MenuItem value="id_number">{t('reveal.fields.id_number')}</MenuItem>
                <MenuItem value="full_name">{t('reveal.fields.full_name')}</MenuItem>
                <MenuItem value="date_of_birth">{t('reveal.fields.date_of_birth')}</MenuItem>
                <MenuItem value="email">{t('reveal.fields.email')}</MenuItem>
                <MenuItem value="phone">{t('reveal.fields.phone')}</MenuItem>
                <MenuItem value="current_address">{t('reveal.fields.current_address')}</MenuItem>
                <MenuItem value="ip_address">{t('reveal.fields.ip_address')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label={t('reveal.reason')}
              value={revealReason}
              onChange={(event) => setRevealReason(event.target.value)}
            />
            {revealedValue !== null && (
              <TextField fullWidth label={t('reveal.value')} value={revealedValue || '-'} slotProps={{
                input: { readOnly: true }
              }} />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevealOpen(false)}>{t('common:actions.close')}</Button>
          <Button variant="contained" startIcon={<RevealIcon />} onClick={revealFieldValue} disabled={processing || revealReason.trim().length < 5}>
            {t('reveal.submit')}
          </Button>
        </DialogActions>
      </Dialog>
      {canCreate && (
        <EkycCreateDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(message) => {
            setSuccessMsg(message);
            listQuery.refetch();
          }}
        />
      )}
      <Snackbar
        open={!!successMsg}
        autoHideDuration={4000}
        onClose={() => setSuccessMsg('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ top: { xs: 72, sm: 88 } }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSuccessMsg('')}>
          {successMsg}
        </Alert>
      </Snackbar>
    </Container>
  );
};

const DetailHeader: React.FC<{ detail: EkycApplicationDetail; onReveal: () => void }> = ({ detail, onReveal }) => {
  const { t, tOr } = useTranslation('ekyc');
  return (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, md: 4 }}>
      <InfoPanel title={t('detail.customer')}>
        <InfoLine label={t('detail.name')} value={detail.summary.full_name} />
        <InfoLine label={t('detail.email')} value={detail.summary.email_masked} />
        <InfoLine label={t('detail.phone')} value={detail.summary.phone_masked} />
        <InfoLine label={t('detail.dob')} value={detail.date_of_birth_masked} />
        <Button size="small" startIcon={<RevealIcon />} onClick={onReveal} sx={{ mt: 1 }}>
          {t('reveal.submit')}
        </Button>
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <InfoPanel title={t('detail.identity')}>
        <InfoLine label={t('detail.idType')} value={idTypeLabel(t, tOr, detail.summary.id_type)} />
        <InfoLine label={t('detail.idNumber')} value={detail.summary.id_number_masked} />
        <InfoLine label={t('detail.country')} value={detail.summary.country} />
        <InfoLine label={t('detail.expiry')} value={detail.id_expiry_date} />
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <InfoPanel title={t('detail.submission')}>
        <InfoLine label={t('detail.ip')} value={detail.ip_address_masked} />
        <InfoLine label={t('detail.device')} value={detail.device_fingerprint} />
        <InfoLine label={t('detail.location')} value={detail.geolocation} />
        <InfoLine label={t('detail.provider')} value={detail.summary.provider_name} />
      </InfoPanel>
    </Grid>
  </Grid>
  );
};

const ActionBar: React.FC<{
  detail: EkycApplicationDetail;
  onAction: (action: string) => void;
  disabled: boolean;
}> = ({ detail, onAction, disabled }) => {
  const { t } = useTranslation('ekyc');
  const final = ['approved', 'rejected', 'expired', 'void'].includes(detail.summary.status);
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1, position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper' }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{
        flexWrap: "wrap"
      }}>
        <Button size="small" variant="outlined" startIcon={<ClaimIcon />} onClick={() => onAction('claim')} disabled={disabled || Boolean(detail.summary.assigned_reviewer_id) || final}>
          {t('actions.claim')}
        </Button>
        <Button size="small" color="success" variant="contained" startIcon={<ApproveIcon />} onClick={() => onAction('approve')} disabled={disabled || final}>
          {t('actions.approve')}
        </Button>
        <Button size="small" color="error" variant="outlined" startIcon={<RejectIcon />} onClick={() => onAction('reject')} disabled={disabled || final}>
          {t('actions.reject')}
        </Button>
        <Button size="small" color="warning" variant="outlined" startIcon={<EscalateIcon />} onClick={() => onAction('escalate')} disabled={disabled || final}>
          {t('actions.escalate')}
        </Button>
        <Button size="small" variant="outlined" onClick={() => onAction('request_resubmission')} disabled={disabled || final}>
          {t('actions.request_resubmission')}
        </Button>
        {detail.summary.status === 'on_hold' ? (
          <Button size="small" variant="outlined" startIcon={<ReleaseIcon />} onClick={() => onAction('release_hold')} disabled={disabled}>
            {t('actions.release_hold')}
          </Button>
        ) : (
          <Button size="small" variant="outlined" startIcon={<HoldIcon />} onClick={() => onAction('hold')} disabled={disabled || final}>
            {t('actions.hold')}
          </Button>
        )}
      </Stack>
    </Paper>
  );
};

const DocumentSection: React.FC<{ detail: EkycApplicationDetail }> = ({ detail }) => {
  const { t } = useTranslation('ekyc');
  return (
  <InfoPanel title={t('detail.documents')}>
    <Grid container spacing={1.5}>
      {detail.documents.id_front && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="id-front" alt={t('doc.altIdFront')} />
        </Grid>
      )}
      {detail.documents.id_back && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="id-back" alt={t('doc.altIdBack')} />
        </Grid>
      )}
      {detail.documents.selfie && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="selfie" alt={t('doc.altSelfie')} />
        </Grid>
      )}
      {detail.documents.proof_of_address && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="proof-of-address" alt={t('doc.altProof')} />
        </Grid>
      )}
    </Grid>
  </InfoPanel>
  );
};

const ReviewSignals: React.FC<{ detail: EkycApplicationDetail }> = ({ detail }) => {
  const { t } = useTranslation('ekyc');
  const isPhone = useIsPhone();
  return (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, md: 5 }}>
      <InfoPanel title={t('signals.title')}>
        <InfoLine label={t('signals.document')} value={detail.document_authenticity_result} />
        <InfoLine label={t('signals.faceMatch')} value={detail.face_match_score != null ? `${detail.face_match_score}%` : '-'} />
        <InfoLine label={t('signals.liveness')} value={detail.liveness_score != null ? `${detail.liveness_score}%` : '-'} />
        <InfoLine label={t('signals.duplicate')} value={detail.duplicate_check_result} />
        <InfoLine label={t('signals.watchlist')} value={detail.watchlist_result} />
        <Stack
          direction="row"
          spacing={0.5}
          useFlexGap
          sx={{
            flexWrap: "wrap",
            mt: 1
          }}>
          {detail.summary.triggered_risk_rules.map(rule => (
            <Chip key={rule} size="small" label={labelize(rule)} />
          ))}
        </Stack>
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 7 }}>
      <InfoPanel title={t('signals.differences')}>
        {detail.differences.length === 0 ? (
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>{t('signals.noComparable')}</Typography>
        ) : isPhone ? (
          <Box>
            {detail.differences.map(row => (
              <Box
                key={row.field}
                sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <MobileCardRow
                  title={labelize(row.field)}
                  subtitle={t('signals.submittedValue', { value: row.submitted_value ?? '-' })}
                  meta={t('signals.extractedValue', { value: row.extracted_value ?? '-' })}
                  status={<Chip size="small" color={row.matches ? 'success' : 'warning'} label={row.matches ? t('signals.match') : t('signals.diff')} />}
                />
              </Box>
            ))}
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('signals.colField')}</TableCell>
                <TableCell>{t('signals.colSubmitted')}</TableCell>
                <TableCell>{t('signals.colExtracted')}</TableCell>
                <TableCell>{t('signals.colMatch')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {detail.differences.map(row => (
                <TableRow key={row.field}>
                  <TableCell>{labelize(row.field)}</TableCell>
                  <TableCell>{row.submitted_value ?? '-'}</TableCell>
                  <TableCell>{row.extracted_value ?? '-'}</TableCell>
                  <TableCell>
                    <Chip size="small" color={row.matches ? 'success' : 'warning'} label={row.matches ? t('common:actions.yes') : t('common:actions.no')} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </InfoPanel>
    </Grid>
  </Grid>
  );
};

const TimelineSection: React.FC<{ detail: EkycApplicationDetail }> = ({ detail }) => {
  const { t, tOr } = useTranslation('ekyc');
  return (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, md: 7 }}>
      <InfoPanel title={t('timeline.history')}>
        <List dense disablePadding>
          {detail.history.map(item => (
            <ListItem key={item.id} disableGutters divider>
              <ListItemText
                primary={`${actionLabel(t, tOr, item.action)} ${item.from_status ? `${ekycStatus(t, item.from_status)} -> ${ekycStatus(t, item.to_status)}` : ''}`}
                secondary={`${item.actor_name ?? t('timeline.system')} · ${formatDate(item.created_at)}${item.reason_code ? ` · ${labelize(item.reason_code)}` : ''}`}
              />
            </ListItem>
          ))}
          {detail.history.length === 0 && (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{t('timeline.noHistory')}</Typography>
          )}
        </List>
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 5 }}>
      <InfoPanel title={t('timeline.notes')}>
        <Stack spacing={1}>
          {detail.notes.map(note => (
            <Box key={note.id}>
              <Typography variant="body2">{note.body}</Typography>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                {labelize(note.note_type)} · {note.created_by_name ?? note.created_by} · {formatDate(note.created_at)}
              </Typography>
              <Divider sx={{ mt: 1 }} />
            </Box>
          ))}
          {detail.notes.length === 0 && (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{t('timeline.noNotes')}</Typography>
          )}
        </Stack>
      </InfoPanel>
    </Grid>
  </Grid>
  );
};

const InfoPanel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
    <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
    {children}
  </Paper>
);

const InfoLine: React.FC<{ label: string; value?: React.ReactNode | null }> = ({ label, value }) => (
  <Box sx={{ mb: 0.75 }}>
    <Typography variant="caption" sx={{
      color: "text.secondary"
    }}>{label}</Typography>
    <Typography variant="body2">{value || '-'}</Typography>
  </Box>
);

export default EkycManagementPage;
