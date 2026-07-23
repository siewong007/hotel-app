import React, { useState } from 'react';
import {
  Alert,
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
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { PaymentApprovalsService, PendingPaymentEntry } from '../../../api';
import { formatCurrency } from '../../../utils/currency';
import {
  useApprovePayment,
  usePendingPayments,
  usePaymentApprovalHistory,
  useRejectPayment,
  useRequestPaymentReceipt,
} from '../hooks/usePaymentApprovalsQueries';
import { receiptAsPdf } from '../utils/paymentReceiptPdf';

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

  const activeQuery = view === 'pending' ? pendingQuery : historyQuery;
  const items = activeQuery.data?.items ?? [];
  const total = activeQuery.data?.total ?? 0;
  const loading = activeQuery.isPending;
  const queryError = activeQuery.error;
  const effectiveError =
    error || (queryError instanceof Error ? queryError.message : null);

  const handleApprove = async (entry: PendingPaymentEntry) => {
    setError(null);
    setSuccess(null);
    try {
      await approveMutation.mutateAsync(entry.id);
      setSuccess(
        `Payment for booking ${entry.booking_number ?? entry.booking_id} approved — booking confirmed.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to approve this payment.');
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
      setSuccess(`Receipt requested from the guest for booking ${receiptTarget.booking_number ?? receiptTarget.booking_id}.`);
      setReceiptTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request a receipt.');
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
      setSuccess(`Payment for booking ${rejectTarget.booking_number ?? rejectTarget.booking_id} was rejected.`);
      setRejectTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reject this payment.');
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
      setError(caught instanceof Error ? caught.message : 'Unable to open this receipt.');
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
      <Typography variant="h4" sx={{ mb: 1 }}>
        Payment Approvals
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review guest-submitted bank-transfer and PayPal payment claims. Approving a claim marks
        the payment complete and confirms the booking. For bank transfers, request a receipt when
        proof is needed; a claim without a receipt is automatically rejected after 24 hours.
      </Typography>
      <Tabs value={view} onChange={(_, value: 'pending' | 'history') => { setView(value); setPage(0); }} sx={{ mb: 2 }}>
        <Tab value="pending" label="Pending claims" />
        <Tab value="history" label="Approval history" />
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
        <Alert severity="info">{view === 'pending' ? 'No pending payment claims right now.' : 'No payment approvals have been recorded yet.'}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Booking</TableCell>
                <TableCell>Guest</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>Submitted</TableCell>
                <TableCell>Status</TableCell>
                {view === 'history' ? <TableCell>Reviewed</TableCell> : null}
                <TableCell>Receipt</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((entry) => {
                const isBusy =
                  (approveMutation.isPending && approveMutation.variables === entry.id) ||
                  (rejectMutation.isPending && rejectMutation.variables?.paymentId === entry.id) ||
                  (receiptMutation.isPending && receiptMutation.variables?.paymentId === entry.id);
                return (
                  <TableRow key={entry.id} hover>
                    <TableCell>{entry.booking_number ?? `#${entry.booking_id}`}</TableCell>
                    <TableCell>{entry.guest_name ?? '—'}</TableCell>
                    <TableCell align="right">{formatCurrency(entry.amount)}</TableCell>
                    <TableCell>{entry.payment_method}</TableCell>
                    <TableCell>{new Date(entry.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip
                        label={entry.status}
                        size="small"
                        color={statusColor(entry.status)}
                      />
                    </TableCell>
                    {view === 'history' ? (
                      <TableCell>
                        {entry.processed_at ? new Date(entry.processed_at).toLocaleString() : '—'}
                        {entry.processed_by_name ? <Typography variant="caption" display="block">{entry.processed_by_name}</Typography> : null}
                        {entry.decision_reason ? <Typography variant="caption" display="block">{entry.decision_reason}</Typography> : null}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      {entry.receipt_file_available ? <Button size="small" startIcon={<DescriptionOutlinedIcon />} onClick={() => void handleViewReceipt(entry)}>View</Button> : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {view === 'history' ? '—' : <>
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
                        Approve
                      </Button>
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
                        Reject
                      </Button>
                      </>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
            labelRowsPerPage="Claims per page"
          />
        </TableContainer>
      )}
      <Dialog open={Boolean(receiptTarget)} onClose={() => setReceiptTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{receiptTarget?.receipt_requested ? 'Request receipt again' : 'Request payment receipt'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Ask the guest to upload proof of payment for booking{' '}
            <strong>{receiptTarget?.booking_number ?? receiptTarget?.booking_id}</strong>. If no
            receipt is uploaded within 24 hours, the claim will be automatically rejected.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label="Message to guest (optional)"
            placeholder="For example: Please include the bank reference and transfer date."
            value={receiptMessage}
            onChange={(event) => setReceiptMessage(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceiptTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={receiptMutation.isPending}
            onClick={() => void handleRequestReceipt()}
          >
            {receiptTarget?.receipt_requested ? 'Send request again' : 'Send request'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(rejectTarget)} onClose={() => !rejectMutation.isPending && setRejectTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject payment claim</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Explain why the payment for booking <strong>{rejectTarget?.booking_number ?? rejectTarget?.booking_id}</strong> was rejected. This message is sent to the guest.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            required
            multiline
            minRows={3}
            label="Rejection message"
            placeholder="For example: The transfer amount does not match the booking total."
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            inputProps={{ maxLength: 1_000 }}
            helperText={`${1_000 - rejectionReason.length} characters remaining`}
            disabled={rejectMutation.isPending}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)} disabled={rejectMutation.isPending}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!rejectionReason.trim() || rejectMutation.isPending}
            onClick={() => void handleReject()}
          >
            {rejectMutation.isPending ? 'Rejecting…' : 'Reject payment'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(receiptPreview)} onClose={closeReceiptPreview} maxWidth="md" fullWidth>
        <DialogTitle>Payment receipt — booking {receiptPreview?.bookingNumber}</DialogTitle>
        <DialogContent dividers sx={{ p: 0, height: '75vh' }}>
          {receiptPreview ? (
            <Box
              component="iframe"
              title={`Payment receipt for booking ${receiptPreview.bookingNumber}`}
              src={receiptPreview.url}
              sx={{ border: 0, display: 'block', width: '100%', height: '100%' }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={downloadReceipt}>Download</Button>
          <Button onClick={closeReceiptPreview}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PaymentApprovalsPage;
