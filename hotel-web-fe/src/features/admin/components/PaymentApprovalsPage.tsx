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
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { PendingPaymentEntry } from '../../../api';
import { formatCurrency } from '../../../utils/currency';
import {
  useApprovePayment,
  usePendingPayments,
  useRejectPayment,
  useRequestPaymentReceipt,
} from '../hooks/usePaymentApprovalsQueries';

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingPaymentEntry | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pendingQuery = usePendingPayments({ page: page + 1, pageSize });
  const approveMutation = useApprovePayment();
  const rejectMutation = useRejectPayment();
  const receiptMutation = useRequestPaymentReceipt();

  const items = pendingQuery.data?.items ?? [];
  const total = pendingQuery.data?.total ?? 0;
  const loading = pendingQuery.isPending;
  const queryError = pendingQuery.error;
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

  const openRejectDialog = (entry: PendingPaymentEntry) => {
    setError(null);
    setSuccess(null);
    setRejectReason('');
    setRejectTarget(entry);
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setError(null);
    try {
      await rejectMutation.mutateAsync({
        paymentId: rejectTarget.id,
        reason: rejectReason.trim(),
      });
      setSuccess(
        `Payment for booking ${rejectTarget.booking_number ?? rejectTarget.booking_id} rejected.`
      );
      setRejectTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reject this payment.');
    }
  };

  const handleRequestReceipt = async (entry: PendingPaymentEntry) => {
    setError(null);
    setSuccess(null);
    try {
      await receiptMutation.mutateAsync({ paymentId: entry.id });
      setSuccess(`Receipt requested from the guest for booking ${entry.booking_number ?? entry.booking_id}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request a receipt.');
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ mb: 1 }}>
        Payment Approvals
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review guest-submitted bank-transfer and PayPal payment claims. Approving a claim marks
        the payment complete and confirms the booking; rejecting leaves the booking as-is.
      </Typography>

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
        <Alert severity="info">No pending payment claims right now.</Alert>
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
                    <TableCell align="right">
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
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<UploadFileOutlinedIcon />}
                          disabled={isBusy}
                          onClick={() => void handleRequestReceipt(entry)}
                          sx={{ mr: 1 }}
                        >
                          {entry.receipt_uploaded ? 'Receipt uploaded' : entry.receipt_requested ? 'Request again' : 'Request receipt'}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        startIcon={<CancelOutlinedIcon />}
                        disabled={isBusy}
                        onClick={() => openRejectDialog(entry)}
                      >
                        Reject
                      </Button>
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

      <Dialog open={Boolean(rejectTarget)} onClose={() => setRejectTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject payment claim</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Reject the {rejectTarget?.payment_method} claim for booking{' '}
            <strong>{rejectTarget?.booking_number ?? rejectTarget?.booking_id}</strong>? The
            booking will remain in its current status.
          </Typography>
          <TextField
            label="Reason"
            multiline
            rows={3}
            fullWidth
            required
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Explain why this claim is being rejected..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!rejectReason.trim() || rejectMutation.isPending}
            startIcon={
              rejectMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
            }
            onClick={() => void handleReject()}
          >
            Reject claim
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PaymentApprovalsPage;
