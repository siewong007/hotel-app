import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { PaymentApprovalsService, PendingPaymentEntry } from '../../../api';
import { formatCurrency } from '../../../utils/currency';
import { formatStatusLabel } from '../../../utils/formatters';
import { useAuth } from '../../../auth/AuthContext';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import PageHeader from '../../../components/common/PageHeader';
import {
  useApprovePayment,
  usePendingPayments,
  usePaymentApprovalHistory,
  usePaypalConflictEvents,
  useRejectPayment,
  useRequestPaymentReceipt,
} from '../hooks/usePaymentApprovalsQueries';
import { receiptAsPdf } from '../utils/paymentReceiptPdf';
import { useTranslation, statusLabel } from '../../../i18n';
import { formatHotelDateTime } from '../../../utils/date';

const CONFLICT_EVENTS_SHOWN = 10;

function statusColor(status: string): 'default' | 'warning' | 'success' | 'error' {
  switch (status) {
    case 'pending':
    case 'processing':
      return 'warning';
    case 'completed':
      return 'success';
    case 'void':
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

const PaymentApprovalsPage: React.FC = () => {
  const { t, tOr } = useTranslation('admin');
  const { hasPermission } = useAuth();
  const isPhone = useIsPhone();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<PendingPaymentEntry | null>(null);
  const [receiptMessage, setReceiptMessage] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<{ url: string; bookingNumber: string; file: Blob } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingPaymentEntry | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const pendingQuery = usePendingPayments({ page: page + 1, pageSize });
  const historyQuery = usePaymentApprovalHistory({ page: page + 1, pageSize }, view === 'history');

  const approveMutation = useApprovePayment();
  const rejectMutation = useRejectPayment();
  const receiptMutation = useRequestPaymentReceipt();

  // Same permission this page's own data already requires (payments:read,
  // routes/payments.rs). The banner reads the narrow paypal-conflicts
  // endpoint rather than audit-logs, so approvers without audit:read still
  // see conflicts — previously the banner was invisible to exactly the staff
  // it exists for.
  const canViewConflicts = hasPermission('payments:read');
  const conflictQuery = usePaypalConflictEvents(canViewConflicts);
  const conflictEvents = conflictQuery.data?.events ?? [];
  const conflictTotal = conflictQuery.data?.total ?? 0;

  const activeQuery = view === 'pending' ? pendingQuery : historyQuery;
  const items = activeQuery.data?.items ?? [];
  const total = activeQuery.data?.total ?? 0;
  const loading = activeQuery.isPending;
  const queryError = activeQuery.error;
  const effectiveError =
    error || (queryError instanceof Error ? queryError.message : null);

  const paginationEl = (
    <TablePagination
      component="div"
      count={total}
      page={page}
      onPageChange={(_, newPage) => setPage(newPage)}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[10, 25, 50, 100]}
      onRowsPerPageChange={(event) => {
        setPageSize(parseInt(event.target.value, 10));
        setPage(0);
      }}
      labelRowsPerPage={t('paymentApprovals.perPage')}
    />
  );

  const handleApprove = async (entry: PendingPaymentEntry) => {
    setError(null);
    setSuccess(null);
    try {
      await approveMutation.mutateAsync(entry.id);
      setSuccess(t('paymentApprovals.toast.approved', { ref: entry.booking_number ?? entry.booking_id }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.approve'));
    }
  };

  const openReceiptDialog = (entry: PendingPaymentEntry) => {
    setError(null);
    setSuccess(null);
    setReceiptMessage('');
    setReceiptTarget(entry);
  };

  const handleRequestReceipt = async () => {
    if (!receiptTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await receiptMutation.mutateAsync({
        paymentId: receiptTarget.id,
        message: receiptMessage.trim() || undefined,
      });
      setSuccess(t('paymentApprovals.toast.receiptRequested', { ref: receiptTarget.booking_number ?? receiptTarget.booking_id }));
      setReceiptTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.requestReceipt'));
    }
  };

  const openRejectDialog = (entry: PendingPaymentEntry) => {
    setError(null);
    setSuccess(null);
    setRejectionReason('');
    setRejectTarget(entry);
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      await rejectMutation.mutateAsync({
        paymentId: rejectTarget.id,
        reason: rejectionReason.trim(),
      });
      setSuccess(
        rejectTarget.payment_method === 'paypal'
          ? t('paymentApprovals.toast.paypalCancelled', { ref: rejectTarget.booking_number ?? rejectTarget.booking_id })
          : t('paymentApprovals.toast.rejected', { ref: rejectTarget.booking_number ?? rejectTarget.booking_id }),
      );
      setRejectTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.reject'));
    }
  };

  const handleViewReceipt = async (entry: PendingPaymentEntry) => {
    setError(null);
    try {
      const blob = await PaymentApprovalsService.downloadReceipt(entry.id);
      const pdf = await receiptAsPdf(blob);
      const url = URL.createObjectURL(pdf);
      setReceiptPreview({
        url,
        bookingNumber: entry.booking_number ?? String(entry.booking_id),
        file: blob,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('paymentApprovals.errors.openReceipt'));
    }
  };

  const closeReceiptPreview = () => {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview.url);
    setReceiptPreview(null);
  };

  const downloadReceipt = () => {
    if (!receiptPreview) return;
    const extensionByType: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensionByType[receiptPreview.file.type] ?? 'bin';
    const url = URL.createObjectURL(receiptPreview.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payment-receipt-${receiptPreview.bookingNumber}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <PageHeader
        title={t('paymentApprovals.title')}
        subtitle={t('paymentApprovals.subtitle')}
        sx={{ mb: 3 }}
      />
      {canViewConflicts && conflictEvents.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <AlertTitle>
            {t('paymentApprovals.conflicts.title', { count: conflictTotal })}
          </AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('paymentApprovals.conflicts.body')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {conflictEvents.slice(0, CONFLICT_EVENTS_SHOWN).map((event) => {
              const details = (event.details ?? {}) as Record<string, unknown>;
              const bookingId = details.booking_id;
              const reason = details.reason;
              return (
                <Box component="li" key={event.id}>
                  <Typography variant="body2">
                    {t('paymentApprovals.conflicts.eventLine', { at: formatHotelDateTime(event.created_at), id: event.resource_id ?? '—' })}
                    {typeof bookingId === 'number' || typeof bookingId === 'string'
                      ? `, ${t('paymentApprovals.conflicts.bookingRef', { id: bookingId })}`
                      : ''}
                    {typeof reason === 'string' ? `: ${reason}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          {conflictTotal > Math.min(conflictEvents.length, CONFLICT_EVENTS_SHOWN) && (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('paymentApprovals.conflicts.showing', { shown: Math.min(conflictEvents.length, CONFLICT_EVENTS_SHOWN), total: conflictTotal })}
            </Typography>
          )}
        </Alert>
      )}
      <Tabs value={view} onChange={(_, value: 'pending' | 'history') => { setView(value); setPage(0); }} sx={{ mb: 2 }}>
        <Tab value="pending" label={t('paymentApprovals.tabs.pending')} />
        <Tab value="history" label={t('paymentApprovals.tabs.history')} />
      </Tabs>
      {effectiveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {effectiveError}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Alert severity="info">{view === 'pending' ? t('paymentApprovals.empty.pending') : t('paymentApprovals.empty.history')}</Alert>
      ) : isPhone ? (
        <Paper variant="outlined" component="div" sx={{ overflow: 'hidden' }}>
          {items.map((entry) => {
            const isPaypal = entry.payment_method === 'paypal';
            const isBusy =
              (approveMutation.isPending && approveMutation.variables === entry.id) ||
              (rejectMutation.isPending && rejectMutation.variables?.paymentId === entry.id) ||
              (receiptMutation.isPending && receiptMutation.variables?.paymentId === entry.id);
            return (
              <MobileCardRow
                key={entry.id}
                title={entry.guest_name ?? entry.booking_number ?? `#${entry.booking_id}`}
                subtitle={`${entry.booking_number ?? `#${entry.booking_id}`} · ${formatCurrency(entry.amount)} · ${tOr(`finance:ledger.paymentMethod.${entry.payment_method}`, formatStatusLabel(entry.payment_method))}`}
                meta={t('paymentApprovals.submittedAt', { at: formatHotelDateTime(entry.created_at) }) + (
                  view === 'history' && entry.processed_at
                    ? ` · ${t('paymentApprovals.reviewedAt', { at: formatHotelDateTime(entry.processed_at) })}`
                    : ''
                )}
                status={<Chip label={statusLabel(t, 'payment', entry.status)} size="small" color={statusColor(entry.status)} />}
                footer={
                  <>
                    {entry.receipt_file_available ? (
                      <Button
                        size="small"
                        startIcon={<DescriptionOutlinedIcon />}
                        onClick={() => void handleViewReceipt(entry)}
                      >
                        {t('paymentApprovals.receipt')}
                      </Button>
                    ) : null}
                    {view !== 'history' ? (
                      <>
                        {!isPaypal ? (
                          <Button
                            size="small"
                            color="success"
                            variant="outlined"
                            startIcon={
                              isBusy && approveMutation.isPending ? (
                                <CircularProgress size={16} color="inherit" />
                              ) : (
                                <CheckCircleOutlineIcon />
                              )
                            }
                            disabled={isBusy}
                            onClick={() => void handleApprove(entry)}
                          >
                            {t('paymentApprovals.approve')}
                          </Button>
                        ) : null}
                        {entry.payment_method === 'bank_transfer' ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<UploadFileOutlinedIcon />}
                            disabled={isBusy}
                            onClick={() => openReceiptDialog(entry)}
                          >
                            {entry.receipt_uploaded ? t('paymentApprovals.receiptUploaded') : entry.receipt_requested ? t('paymentApprovals.requestAgain') : t('paymentApprovals.requestReceipt')}
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          disabled={isBusy}
                          onClick={() => openRejectDialog(entry)}
                        >
                          {isPaypal ? t('paymentApprovals.cancelPaypal') : t('paymentApprovals.reject')}
                        </Button>
                      </>
                    ) : null}
                  </>
                }
              />
            );
          })}
          {paginationEl}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('paymentApprovals.col.booking')}</TableCell>
                <TableCell>{t('paymentApprovals.col.guest')}</TableCell>
                <TableCell align="right">{t('common:field.amount')}</TableCell>
                <TableCell>{t('paymentApprovals.col.method')}</TableCell>
                <TableCell>{t('paymentApprovals.col.submitted')}</TableCell>
                <TableCell>{t('common:field.status')}</TableCell>
                {view === 'history' ? <TableCell>{t('paymentApprovals.col.reviewed')}</TableCell> : null}
                <TableCell>{t('paymentApprovals.receipt')}</TableCell>
                <TableCell align="right">{t('common:field.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((entry) => {
                const isPaypal = entry.payment_method === 'paypal';
                const isBusy =
                  (approveMutation.isPending && approveMutation.variables === entry.id) ||
                  (rejectMutation.isPending && rejectMutation.variables?.paymentId === entry.id) ||
                  (receiptMutation.isPending && receiptMutation.variables?.paymentId === entry.id);
                return (
                  <TableRow key={entry.id} hover>
                    <TableCell>{entry.booking_number ?? `#${entry.booking_id}`}</TableCell>
                    <TableCell>{entry.guest_name ?? '—'}</TableCell>
                    <TableCell align="right">{formatCurrency(entry.amount)}</TableCell>
                    <TableCell>{tOr(`finance:ledger.paymentMethod.${entry.payment_method}`, formatStatusLabel(entry.payment_method))}</TableCell>
                    <TableCell>{formatHotelDateTime(entry.created_at)}</TableCell>
                    <TableCell>
                      <Chip
                        label={statusLabel(t, 'payment', entry.status)}
                        size="small"
                        color={statusColor(entry.status)}
                      />
                    </TableCell>
                    {view === 'history' ? (
                      <TableCell>
                        {entry.processed_at ? formatHotelDateTime(entry.processed_at) : '—'}
                        {entry.processed_by_name ? <Typography variant="caption" sx={{
                          display: "block"
                        }}>{entry.processed_by_name}</Typography> : null}
                        {entry.decision_reason ? <Typography variant="caption" sx={{
                          display: "block"
                        }}>{entry.decision_reason}</Typography> : null}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      {entry.receipt_file_available ? <Button size="small" startIcon={<DescriptionOutlinedIcon />} onClick={() => void handleViewReceipt(entry)}>{t('common:actions.view')}</Button> : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {view === 'history' ? '—' : <>
                      {!isPaypal ? (
                        <Button
                          size="small"
                          color="success"
                          variant="outlined"
                          startIcon={
                            isBusy && approveMutation.isPending ? (
                              <CircularProgress size={16} color="inherit" />
                            ) : (
                              <CheckCircleOutlineIcon />
                            )
                          }
                          disabled={isBusy}
                          onClick={() => void handleApprove(entry)}
                          sx={{ mr: 1 }}
                        >
                          {t('paymentApprovals.approve')}
                        </Button>
                      ) : null}
                      {entry.payment_method === 'bank_transfer' ? (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<UploadFileOutlinedIcon />}
                            disabled={isBusy}
                            onClick={() => openReceiptDialog(entry)}
                            sx={{ mr: 1 }}
                          >
                            {entry.receipt_uploaded ? 'Receipt uploaded' : entry.receipt_requested ? 'Request again' : 'Request receipt'}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        disabled={isBusy}
                        onClick={() => openRejectDialog(entry)}
                      >
                        {isPaypal ? 'Cancel PayPal attempt' : 'Reject'}
                      </Button>
                      </>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {paginationEl}
        </TableContainer>
      )}
      <Dialog open={Boolean(receiptTarget)} onClose={() => setReceiptTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{receiptTarget?.receipt_requested ? t('paymentApprovals.receiptDialog.titleAgain') : t('paymentApprovals.receiptDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {t('paymentApprovals.receiptDialog.bodyStart')}{' '}
            <strong>{receiptTarget?.booking_number ?? receiptTarget?.booking_id}</strong>{t('paymentApprovals.receiptDialog.bodyEnd')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label={t('paymentApprovals.receiptDialog.messageLabel')}
            placeholder={t('paymentApprovals.receiptDialog.messagePlaceholder')}
            value={receiptMessage}
            onChange={(event) => setReceiptMessage(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceiptTarget(null)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={receiptMutation.isPending}
            onClick={() => void handleRequestReceipt()}
          >
            {receiptTarget?.receipt_requested ? t('paymentApprovals.receiptDialog.sendAgain') : t('paymentApprovals.receiptDialog.send')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(rejectTarget)} onClose={() => !rejectMutation.isPending && setRejectTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {rejectTarget?.payment_method === 'paypal'
            ? t('paymentApprovals.cancelPaypal')
            : t('paymentApprovals.rejectDialog.title')}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {rejectTarget?.payment_method === 'paypal' ? (
              <>
                {t('paymentApprovals.rejectDialog.paypalBodyStart')}{' '}
                <strong>{rejectTarget?.booking_number ?? rejectTarget?.booking_id}</strong>{t('paymentApprovals.rejectDialog.paypalBodyEnd')}
              </>
            ) : (
              <>
                {t('paymentApprovals.rejectDialog.bodyStart')}{' '}
                <strong>{rejectTarget?.booking_number ?? rejectTarget?.booking_id}</strong>{t('paymentApprovals.rejectDialog.bodyEnd')}
              </>
            )}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            required
            multiline
            minRows={3}
            label={rejectTarget?.payment_method === 'paypal' ? t('paymentApprovals.rejectDialog.labelPaypal') : t('paymentApprovals.rejectDialog.labelReject')}
            placeholder={
              rejectTarget?.payment_method === 'paypal'
                ? t('paymentApprovals.rejectDialog.placeholderPaypal')
                : t('paymentApprovals.rejectDialog.placeholderReject')
            }
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            helperText={t('paymentApprovals.rejectDialog.charsLeft', { count: 1_000 - rejectionReason.length })}
            disabled={rejectMutation.isPending}
            slotProps={{
              htmlInput: { maxLength: 1_000 }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)} disabled={rejectMutation.isPending}>{t('common:actions.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!rejectionReason.trim() || rejectMutation.isPending}
            onClick={() => void handleReject()}
          >
            {rejectMutation.isPending
              ? rejectTarget?.payment_method === 'paypal'
                ? t('paymentApprovals.rejectDialog.cancelling')
                : t('paymentApprovals.rejectDialog.rejecting')
              : rejectTarget?.payment_method === 'paypal'
                ? t('paymentApprovals.cancelPaypal')
                : t('paymentApprovals.rejectDialog.submit')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(receiptPreview)} onClose={closeReceiptPreview} maxWidth="md" fullWidth>
        <DialogTitle>{t('paymentApprovals.receiptPreview.title', { ref: receiptPreview?.bookingNumber ?? '' })}</DialogTitle>
        <DialogContent dividers sx={{ p: 0, height: '75vh' }}>
          {receiptPreview ? (
            <Box
              component="iframe"
              title={t('paymentApprovals.receiptPreview.iframeTitle', { ref: receiptPreview.bookingNumber })}
              src={receiptPreview.url}
              sx={{ border: 0, display: 'block', width: '100%', height: '100%' }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={downloadReceipt}>{t('common:actions.download')}</Button>
          <Button onClick={closeReceiptPreview}>{t('common:actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PaymentApprovalsPage;
