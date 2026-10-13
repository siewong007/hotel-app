import React from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { keyframes } from '@mui/system';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { PaymentApprovalsService, PendingPaymentEntry } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { useTranslation } from '../../../i18n';
import { formatCurrency } from '../../../utils/currency';
import { formatHotelDateTime } from '../../../utils/date';
import {
  useApprovePayment,
  useRejectPayment,
  useUrgentTransferClaims,
} from '../hooks/usePaymentApprovalsQueries';
import { canRejectPaymentClaim, hasPaymentReceipt } from '../utils/paymentApprovals';
import ApprovePaymentDialog from './ApprovePaymentDialog';

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(211, 47, 47, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(211, 47, 47, 0); }
  100% { box-shadow: 0 0 0 0 rgba(211, 47, 47, 0); }
`;

const REJECT_REASON_MAX = 1_000;

/** "12 min" / "3 h 5 min" / "1 d 2 h" — how long a claim has waited. */
export function formatWaiting(createdAt: string, now: number, t: (key: string, opts?: Record<string, number>) => string): string {
  // Postgres `timestamptz::text` reads "2026-10-13 09:00:00.12+08".
  const iso = createdAt.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return '—';
  const minutes = Math.max(0, Math.floor((now - created) / 60_000));
  if (minutes < 60) return t('urgentTransfer.waitingMinutes', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('urgentTransfer.waitingHours', { hours, minutes: minutes % 60 });
  return t('urgentTransfer.waitingDays', { days: Math.floor(hours / 24), hours: hours % 24 });
}

/**
 * Reception's urgent alert for guest website bank-transfer claims.
 *
 * Shown to staff holding `payments:approve` on every staff page while any
 * claim is pending. The sticky red bar has no close control; the modal opens
 * on page load and whenever a new claim arrives, and can only be minimised
 * back to the bar (no backdrop/Escape close). Both disappear only once every
 * claim is approved (after confirming receipt) or rejected with a reason —
 * an unanswered claim is auto-released as unpaid.
 */
export const UrgentTransferAlert: React.FC = () => {
  const { t } = useTranslation('admin');
  const { hasPermission } = useAuth();
  const isPhone = useIsPhone();
  const canApprove = hasPermission('payments:approve');
  const query = useUrgentTransferClaims(canApprove);
  const approveMutation = useApprovePayment();
  const rejectMutation = useRejectPayment();

  const items = React.useMemo(() => query.data?.items ?? [], [query.data]);
  const total = query.data?.total ?? items.length;

  const [modalOpen, setModalOpen] = React.useState(false);
  const [approveTarget, setApproveTarget] = React.useState<PendingPaymentEntry | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<PendingPaymentEntry | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const seenIds = React.useRef<Set<number> | null>(null);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Pop the modal on first load with claims, and again whenever a claim
  // that was not there before shows up.
  React.useEffect(() => {
    if (!query.data) return;
    const ids = new Set(items.map((item) => item.id));
    const previous = seenIds.current;
    const hasNew = previous === null ? ids.size > 0 : [...ids].some((id) => !previous.has(id));
    seenIds.current = ids;
    if (hasNew) setModalOpen(true);
    if (ids.size === 0) setModalOpen(false);
  }, [query.data, items]);

  if (!canApprove || total === 0) return null;

  const refLabel = (entry: PendingPaymentEntry) => entry.booking_number ?? `#${entry.booking_id}`;

  const openReceipt = async (entry: PendingPaymentEntry) => {
    setError(null);
    const popup = window.open('', '_blank');
    try {
      const blob = await PaymentApprovalsService.downloadReceipt(entry.id);
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.href = url;
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      popup?.close();
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.openReceipt'));
    }
  };

  const confirmApprove = async (entry: PendingPaymentEntry) => {
    setError(null);
    try {
      await approveMutation.mutateAsync(entry.id);
      setApproveTarget(null);
      await query.refetch();
    } catch (caught) {
      setApproveTarget(null);
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.approve'));
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget || !reason.trim()) return;
    setError(null);
    try {
      await rejectMutation.mutateAsync({ paymentId: rejectTarget.id, reason: reason.trim() });
      setRejectTarget(null);
      setReason('');
      await query.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.reject'));
    }
  };

  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <>
      <Box
        role="alert"
        aria-live="assertive"
        data-testid="urgent-transfer-banner"
        sx={{
          bgcolor: 'error.main',
          color: 'error.contrastText',
          px: { xs: 1.5, sm: 2.5 },
          py: { xs: 1, sm: 0.75 },
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          animation: `${pulse} 1.6s infinite`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Badge
          badgeContent={total}
          max={99}
          sx={{ '& .MuiBadge-badge': { bgcolor: 'common.white', color: 'error.main', fontWeight: 700 } }}
        >
          <PriorityHighIcon />
        </Badge>
        <Typography variant="body2" sx={{ fontWeight: 700, flex: '1 1 220px', ml: 1 }}>
          {t('urgentTransfer.banner', { count: total })}
        </Typography>
        <Button
          size="small"
          variant="contained"
          onClick={() => setModalOpen(true)}
          sx={{ bgcolor: 'common.white', color: 'error.main', '&:hover': { bgcolor: 'grey.100' }, flexShrink: 0 }}
        >
          {t('urgentTransfer.review')}
        </Button>
      </Box>

      <Dialog
        open={modalOpen && !approveTarget && !rejectTarget}
        // No backdrop / Escape close: only the explicit minimise button.
        onClose={() => undefined}
        fullScreen={isPhone}
        maxWidth="md"
        fullWidth
        aria-labelledby="urgent-transfer-title"
      >
        <DialogTitle id="urgent-transfer-title" sx={{ bgcolor: 'error.main', color: 'error.contrastText' }}>
          {t('urgentTransfer.title', { count: total })}
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            {t('urgentTransfer.explain')}
          </Alert>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <Stack spacing={1.5}>
            {items.map((entry) => {
              const receipt = hasPaymentReceipt(entry);
              const rejectable = canRejectPaymentClaim(entry.booking_status);
              return (
                <Box
                  key={entry.id}
                  data-testid="urgent-transfer-item"
                  sx={{ border: 1, borderColor: 'error.light', borderRadius: 1, p: 1.5 }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
                      gap: 1,
                      mb: 1.5,
                    }}
                  >
                    {[
                      [t('paymentApprovals.col.booking'), refLabel(entry)],
                      [t('paymentApprovals.col.guest'), entry.guest_name ?? '—'],
                      [t('common:field.amount'), formatCurrency(entry.amount)],
                      [t('urgentTransfer.submitted'), formatHotelDateTime(entry.created_at)],
                      [t('urgentTransfer.waiting'), formatWaiting(entry.created_at, now, t)],
                    ].map(([label, value]) => (
                      <Box key={label}>
                        <Typography variant="caption" color="text.secondary">
                          {label}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {value}
                        </Typography>
                      </Box>
                    ))}
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('paymentApprovals.receipt')}
                      </Typography>
                      <Box>
                        {receipt && entry.receipt_file_available ? (
                          <Button
                            size="small"
                            startIcon={<ReceiptLongOutlinedIcon />}
                            onClick={() => void openReceipt(entry)}
                            sx={{ p: 0, minWidth: 0 }}
                          >
                            {t('urgentTransfer.viewReceipt')}
                          </Button>
                        ) : (
                          <Chip size="small" color="warning" label={t('urgentTransfer.noReceipt')} />
                        )}
                      </Box>
                    </Box>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button
                      variant="contained"
                      color="success"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setApproveTarget(entry);
                      }}
                    >
                      {t('urgentTransfer.confirmApprove')}
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      disabled={busy || !rejectable}
                      onClick={() => {
                        setError(null);
                        setReason('');
                        setRejectTarget(entry);
                      }}
                    >
                      {t('paymentApprovals.reject')}
                    </Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, px: 1 }}>
            {t('urgentTransfer.minimiseHint')}
          </Typography>
          <Button onClick={() => setModalOpen(false)}>{t('urgentTransfer.minimise')}</Button>
        </DialogActions>
      </Dialog>

      <ApprovePaymentDialog
        entry={approveTarget}
        isApproving={approveMutation.isPending}
        onCancel={() => setApproveTarget(null)}
        onConfirm={(entry) => void confirmApprove(entry)}
      />

      <Dialog
        open={Boolean(rejectTarget)}
        onClose={() => !rejectMutation.isPending && setRejectTarget(null)}
        fullScreen={isPhone}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('paymentApprovals.rejectDialog.title')}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Typography sx={{ mb: 2 }}>
            {t('paymentApprovals.rejectDialog.bodyStart')} <strong>{rejectTarget ? refLabel(rejectTarget) : ''}</strong>
            {t('paymentApprovals.rejectDialog.bodyEnd')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            required
            multiline
            minRows={3}
            label={t('paymentApprovals.rejectDialog.labelReject')}
            placeholder={t('paymentApprovals.rejectDialog.placeholderReject')}
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, REJECT_REASON_MAX))}
            helperText={t('paymentApprovals.rejectDialog.charsLeft', { count: REJECT_REASON_MAX - reason.length })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)} disabled={rejectMutation.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!reason.trim() || rejectMutation.isPending}
            startIcon={rejectMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            onClick={() => void confirmReject()}
          >
            {t('paymentApprovals.reject')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default UrgentTransferAlert;
