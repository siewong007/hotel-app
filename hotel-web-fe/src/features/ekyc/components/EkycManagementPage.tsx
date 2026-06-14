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
  AssignmentInd as ClaimIcon,
  Cancel as RejectIcon,
  CheckCircle as ApproveIcon,
  Close as CloseIcon,
  FileDownload as ExportIcon,
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
import { format } from 'date-fns';
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
import {
  useAllEkycVerifications,
  useEkycApplication,
  useEkycReasonCodes,
  useRevealEkycField,
  useReviewEkycAction,
} from '../hooks/useEkycQueries';

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

const ACTION_LABELS: Record<string, string> = {
  claim: 'Claim',
  approve: 'Approve',
  reject: 'Reject',
  escalate: 'Escalate',
  request_resubmission: 'Request Info',
  hold: 'Hold',
  release_hold: 'Release',
  mark_potential_duplicate: 'Mark Duplicate',
  mark_fraud: 'Mark Fraud',
};

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
  if (!value) return '-';
  return format(new Date(value), 'MMM dd, yyyy HH:mm');
}

function labelize(value?: string | null): string {
  if (!value) return '-';
  return value.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function statusColor(status: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  if (status === 'approved') return 'success';
  if (status === 'rejected' || status === 'expired' || status === 'void') return 'error';
  if (status === 'escalated') return 'warning';
  if (status === 'in_review' || status === 'pending_manual_review') return 'info';
  return 'default';
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setImageUrl(null);
    setFailed(false);

    api
      .get(`ekyc/admin/applications/${applicationId}/documents/${kind}`)
      .blob()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [applicationId, kind]);

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{alt}</Typography>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Zoom out">
            <span>
              <IconButton size="small" onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} disabled={!imageUrl}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Zoom in">
            <span>
              <IconButton size="small" onClick={() => setZoom(value => Math.min(2, value + 0.25))} disabled={!imageUrl}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Rotate">
            <span>
              <IconButton size="small" onClick={() => setRotation(value => (value + 90) % 360)} disabled={!imageUrl}>
                <RotateIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <Box sx={{ height: 260, display: 'grid', placeItems: 'center', bgcolor: 'grey.50', overflow: 'auto' }}>
        {failed && (
          <Typography variant="caption" color="text.secondary">Unavailable</Typography>
        )}
        {!failed && !imageUrl && <CircularProgress size={24} />}
        {imageUrl && (
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
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" sx={{ color: colors[accent], mt: 0.5 }}>{value}</Typography>
    </Paper>
  );
};

const EkycManagementPage: React.FC = () => {
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
      setError((queryError as Error).message || 'Unable to load eKYC data');
    }
  }, [listQuery.error, detailQuery.error, reasonCodesQuery.error]);

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
    } catch (err: any) {
      setError(err.message || 'Unable to complete eKYC action');
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
    } catch (err: any) {
      setError(err.message || 'Unable to reveal field');
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
    } catch (err: any) {
      setError(err.message || 'Unable to export eKYC records');
    }
  };

  const metrics = listData?.metrics;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="h5">eKYC Admin</Typography>
            <Typography variant="body2" color="text.secondary">Compliance review queue</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh">
              <span>
                <IconButton onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="outlined" startIcon={<ExportIcon />} onClick={exportCsv}>
              CSV
            </Button>
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label="Submitted" value={metrics?.total_submitted ?? <Skeleton width={42} />} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label="Pending" value={metrics?.pending_review ?? <Skeleton width={42} />} accent="warning" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label="Manual" value={metrics?.under_manual_review ?? <Skeleton width={42} />} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label="Approved" value={metrics?.approved ?? <Skeleton width={42} />} accent="success" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile label="High Risk" value={metrics?.escalated_high_risk ?? <Skeleton width={42} />} accent="error" />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <MetricTile
              label="Avg Minutes"
              value={metrics?.average_processing_minutes != null ? Math.round(metrics.average_processing_minutes) : <Skeleton width={42} />}
            />
          </Grid>
        </Grid>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                label="Search"
                value={filters.search ?? ''}
                onChange={(event) => setFilter('search', event.target.value)}
                InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={filters.status ?? 'all'} onChange={(event) => setFilter('status', event.target.value)}>
                  <MenuItem value="all">All</MenuItem>
                  {STATUS_OPTIONS.map(status => (
                    <MenuItem key={status} value={status}>{labelize(status)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Risk</InputLabel>
                <Select label="Risk" value={filters.risk_level ?? 'all'} onChange={(event) => setFilter('risk_level', event.target.value)}>
                  <MenuItem value="all">All</MenuItem>
                  {RISK_OPTIONS.map(risk => (
                    <MenuItem key={risk} value={risk}>{labelize(risk)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Country"
                value={filters.country ?? ''}
                onChange={(event) => setFilter('country', event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Document"
                value={filters.document_type ?? ''}
                onChange={(event) => setFilter('document_type', event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 1 }}>
              <Button fullWidth onClick={resetFilters}>Reset</Button>
            </Grid>
          </Grid>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden' }}>
          {listQuery.isFetching && <LinearProgress />}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Application</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Document</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Risk</TableCell>
                  <TableCell>Reviewer</TableCell>
                  <TableCell>Submitted</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {listQuery.isLoading && Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={8}><Skeleton /></TableCell>
                  </TableRow>
                ))}
                {!listQuery.isLoading && (listData?.data.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                        No applications found
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {listData?.data.map(application => (
                  <TableRow key={application.id} hover selected={application.id === selectedId}>
                    <TableCell>
                      <Stack spacing={0.5}>
                        <Typography variant="body2" fontWeight={600}>{application.application_id}</Typography>
                        {application.overdue_sla && <Chip size="small" color="error" label="Overdue" />}
                        {!application.overdue_sla && application.nearing_sla && <Chip size="small" color="warning" label="Near SLA" />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{application.full_name ?? '-'}</Typography>
                      <Typography variant="caption" color="text.secondary">{application.email_masked ?? '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{labelize(application.id_type)}</Typography>
                      <Typography variant="caption" color="text.secondary">{application.id_number_masked ?? '-'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={statusColor(application.status)} label={labelize(application.status)} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" color={riskColor(application.risk_level)} label={labelize(application.risk_level)} />
                        <Typography variant="caption">{application.risk_score}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{application.assigned_reviewer_name ?? application.assigned_reviewer_id ?? '-'}</TableCell>
                    <TableCell>{formatDate(application.submitted_at)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="View">
                        <IconButton size="small" onClick={() => setSelectedId(application.id)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6">{selectedSummary?.application_id ?? 'Application'}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                {selectedSummary && <Chip size="small" color={statusColor(selectedSummary.status)} label={labelize(selectedSummary.status)} />}
                {selectedSummary && <Chip size="small" color={riskColor(selectedSummary.risk_level)} label={`${labelize(selectedSummary.risk_level)} ${selectedSummary.risk_score}`} />}
              </Stack>
            </Box>
            <IconButton onClick={() => setSelectedId(undefined)}>
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
        <DialogTitle>{actionMode ? ACTION_LABELS[actionMode] ?? labelize(actionMode) : 'Action'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {ACTION_REASONS_REQUIRED.has(actionMode ?? '') && (
              <FormControl fullWidth size="small">
                <InputLabel>Reason Code</InputLabel>
                <Select label="Reason Code" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
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
                label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
            {actionMode === 'request_resubmission' && (
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Customer Message"
                value={customerMessage}
                onChange={(event) => setCustomerMessage(event.target.value)}
              />
            )}
            {actionMode === 'approve' && (
              <FormControlLabel
                control={<Checkbox checked={selfCheckinEnabled} onChange={(event) => setSelfCheckinEnabled(event.target.checked)} />}
                label="Enable self check-in"
              />
            )}
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Internal Note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAction}>Cancel</Button>
          <Button variant="contained" onClick={submitAction} disabled={processing}>
            {processing ? <CircularProgress size={18} /> : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={revealOpen} onClose={() => setRevealOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reveal Sensitive Field</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Field</InputLabel>
              <Select label="Field" value={revealField} onChange={(event) => {
                setRevealField(event.target.value);
                setRevealedValue(null);
              }}>
                <MenuItem value="id_number">ID Number</MenuItem>
                <MenuItem value="full_name">Full Name</MenuItem>
                <MenuItem value="date_of_birth">Date of Birth</MenuItem>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="phone">Phone</MenuItem>
                <MenuItem value="current_address">Address</MenuItem>
                <MenuItem value="ip_address">IP Address</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Reason"
              value={revealReason}
              onChange={(event) => setRevealReason(event.target.value)}
            />
            {revealedValue !== null && (
              <TextField fullWidth label="Value" value={revealedValue || '-'} InputProps={{ readOnly: true }} />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevealOpen(false)}>Close</Button>
          <Button variant="contained" startIcon={<RevealIcon />} onClick={revealFieldValue} disabled={processing || revealReason.trim().length < 5}>
            Reveal
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

const DetailHeader: React.FC<{ detail: EkycApplicationDetail; onReveal: () => void }> = ({ detail, onReveal }) => (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, md: 4 }}>
      <InfoPanel title="Customer">
        <InfoLine label="Name" value={detail.summary.full_name} />
        <InfoLine label="Email" value={detail.summary.email_masked} />
        <InfoLine label="Phone" value={detail.summary.phone_masked} />
        <InfoLine label="DOB" value={detail.date_of_birth_masked} />
        <Button size="small" startIcon={<RevealIcon />} onClick={onReveal} sx={{ mt: 1 }}>
          Reveal
        </Button>
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <InfoPanel title="Identity">
        <InfoLine label="Type" value={labelize(detail.summary.id_type)} />
        <InfoLine label="Number" value={detail.summary.id_number_masked} />
        <InfoLine label="Country" value={detail.summary.country} />
        <InfoLine label="Expiry" value={detail.id_expiry_date} />
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <InfoPanel title="Submission">
        <InfoLine label="IP" value={detail.ip_address_masked} />
        <InfoLine label="Device" value={detail.device_fingerprint} />
        <InfoLine label="Location" value={detail.geolocation} />
        <InfoLine label="Provider" value={detail.summary.provider_name} />
      </InfoPanel>
    </Grid>
  </Grid>
);

const ActionBar: React.FC<{
  detail: EkycApplicationDetail;
  onAction: (action: string) => void;
  disabled: boolean;
}> = ({ detail, onAction, disabled }) => {
  const final = ['approved', 'rejected', 'expired', 'void'].includes(detail.summary.status);
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1, position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper' }}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button size="small" variant="outlined" startIcon={<ClaimIcon />} onClick={() => onAction('claim')} disabled={disabled || Boolean(detail.summary.assigned_reviewer_id) || final}>
          Claim
        </Button>
        <Button size="small" color="success" variant="contained" startIcon={<ApproveIcon />} onClick={() => onAction('approve')} disabled={disabled || final}>
          Approve
        </Button>
        <Button size="small" color="error" variant="outlined" startIcon={<RejectIcon />} onClick={() => onAction('reject')} disabled={disabled || final}>
          Reject
        </Button>
        <Button size="small" color="warning" variant="outlined" startIcon={<EscalateIcon />} onClick={() => onAction('escalate')} disabled={disabled || final}>
          Escalate
        </Button>
        <Button size="small" variant="outlined" onClick={() => onAction('request_resubmission')} disabled={disabled || final}>
          Request Info
        </Button>
        {detail.summary.status === 'on_hold' ? (
          <Button size="small" variant="outlined" startIcon={<ReleaseIcon />} onClick={() => onAction('release_hold')} disabled={disabled}>
            Release
          </Button>
        ) : (
          <Button size="small" variant="outlined" startIcon={<HoldIcon />} onClick={() => onAction('hold')} disabled={disabled || final}>
            Hold
          </Button>
        )}
      </Stack>
    </Paper>
  );
};

const DocumentSection: React.FC<{ detail: EkycApplicationDetail }> = ({ detail }) => (
  <InfoPanel title="Documents">
    <Grid container spacing={1.5}>
      {detail.documents.id_front && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="id-front" alt="ID Front" />
        </Grid>
      )}
      {detail.documents.id_back && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="id-back" alt="ID Back" />
        </Grid>
      )}
      {detail.documents.selfie && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="selfie" alt="Selfie" />
        </Grid>
      )}
      {detail.documents.proof_of_address && (
        <Grid size={{ xs: 12, md: 4 }}>
          <SecureDocumentImage applicationId={detail.summary.id} kind="proof-of-address" alt="Proof" />
        </Grid>
      )}
    </Grid>
  </InfoPanel>
);

const ReviewSignals: React.FC<{ detail: EkycApplicationDetail }> = ({ detail }) => (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, md: 5 }}>
      <InfoPanel title="Signals">
        <InfoLine label="Document" value={detail.document_authenticity_result} />
        <InfoLine label="Face Match" value={detail.face_match_score != null ? `${detail.face_match_score}%` : '-'} />
        <InfoLine label="Liveness" value={detail.liveness_score != null ? `${detail.liveness_score}%` : '-'} />
        <InfoLine label="Duplicate" value={detail.duplicate_check_result} />
        <InfoLine label="Watchlist" value={detail.watchlist_result} />
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
          {detail.summary.triggered_risk_rules.map(rule => (
            <Chip key={rule} size="small" label={labelize(rule)} />
          ))}
        </Stack>
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 7 }}>
      <InfoPanel title="Differences">
        {detail.differences.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No comparable OCR fields</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Field</TableCell>
                <TableCell>Submitted</TableCell>
                <TableCell>Extracted</TableCell>
                <TableCell>Match</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {detail.differences.map(row => (
                <TableRow key={row.field}>
                  <TableCell>{labelize(row.field)}</TableCell>
                  <TableCell>{row.submitted_value ?? '-'}</TableCell>
                  <TableCell>{row.extracted_value ?? '-'}</TableCell>
                  <TableCell>
                    <Chip size="small" color={row.matches ? 'success' : 'warning'} label={row.matches ? 'Yes' : 'No'} />
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

const TimelineSection: React.FC<{ detail: EkycApplicationDetail }> = ({ detail }) => (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, md: 7 }}>
      <InfoPanel title="Decision History">
        <List dense disablePadding>
          {detail.history.map(item => (
            <ListItem key={item.id} disableGutters divider>
              <ListItemText
                primary={`${labelize(item.action)} ${item.from_status ? `${labelize(item.from_status)} -> ${labelize(item.to_status)}` : ''}`}
                secondary={`${item.actor_name ?? 'System'} · ${formatDate(item.created_at)}${item.reason_code ? ` · ${labelize(item.reason_code)}` : ''}`}
              />
            </ListItem>
          ))}
          {detail.history.length === 0 && (
            <Typography variant="body2" color="text.secondary">No history yet</Typography>
          )}
        </List>
      </InfoPanel>
    </Grid>
    <Grid size={{ xs: 12, md: 5 }}>
      <InfoPanel title="Notes">
        <Stack spacing={1}>
          {detail.notes.map(note => (
            <Box key={note.id}>
              <Typography variant="body2">{note.body}</Typography>
              <Typography variant="caption" color="text.secondary">
                {labelize(note.note_type)} · {note.created_by_name ?? note.created_by} · {formatDate(note.created_at)}
              </Typography>
              <Divider sx={{ mt: 1 }} />
            </Box>
          ))}
          {detail.notes.length === 0 && (
            <Typography variant="body2" color="text.secondary">No notes yet</Typography>
          )}
        </Stack>
      </InfoPanel>
    </Grid>
  </Grid>
);

const InfoPanel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
    <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
    {children}
  </Paper>
);

const InfoLine: React.FC<{ label: string; value?: React.ReactNode | null }> = ({ label, value }) => (
  <Box sx={{ mb: 0.75 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2">{value || '-'}</Typography>
  </Box>
);

export default EkycManagementPage;
