import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  Alert,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Chip,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import type {
  CustomerLedger,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
} from '../../../../../types';
import { formatDateForDisplay, formatDateForInput } from '../helpers';
import { PAYMENT_METHODS } from '../constants';
import { isGreaterMoney, isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';

interface PaymentDialogProps {
  // Dialog state
  open: boolean;
  onClose: () => void;
  // Form values and setters
  paymentTab: number;
  setPaymentTab: React.Dispatch<React.SetStateAction<number>>;
  paymentFormData: CustomerLedgerPaymentRequest;
  setPaymentFormData: React.Dispatch<React.SetStateAction<CustomerLedgerPaymentRequest>>;
  // Lookup data / record + inline-edit state
  paymentLedger: CustomerLedger | null;
  paymentHistory: CustomerLedgerPayment[];
  editingPaymentId: number | null;
  setEditingPaymentId: React.Dispatch<React.SetStateAction<number | null>>;
  editingPaymentDate: string;
  setEditingPaymentDate: React.Dispatch<React.SetStateAction<string>>;
  savingPaymentDate: boolean;
  // Submission + row-action callbacks
  processingPayment: boolean;
  onRecordPayment: () => void;
  onSavePaymentDate: (payment: CustomerLedgerPayment) => void;
  onDeletePayment: (payment: CustomerLedgerPayment) => void;
  // Derived display values
  currencySymbol: string;
  formatCurrency: (value: number) => string;
  getLedgerBalanceDue: (ledger: CustomerLedger) => number;
}

const PaymentDialog: React.FC<PaymentDialogProps> = ({
  open,
  onClose,
  paymentTab,
  setPaymentTab,
  paymentFormData,
  setPaymentFormData,
  paymentLedger,
  paymentHistory,
  editingPaymentId,
  setEditingPaymentId,
  editingPaymentDate,
  setEditingPaymentDate,
  savingPaymentDate,
  processingPayment,
  onRecordPayment,
  onSavePaymentDate,
  onDeletePayment,
  currencySymbol,
  formatCurrency,
  getLedgerBalanceDue,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>
      Payment - {paymentLedger?.company_name}
    </DialogTitle>
    <DialogContent>
      <Tabs value={paymentTab} onChange={(e, v) => setPaymentTab(v)} sx={{ mb: 2 }}>
        <Tab label="Record Payment" />
        <Tab label="Payment History" />
      </Tabs>

      {paymentTab === 0 && (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Total Amount:</strong> {formatCurrency(toMoneyNumber(paymentLedger?.amount))}<br />
              <strong>Already Paid:</strong> {formatCurrency(toMoneyNumber(paymentLedger?.paid_amount))}<br />
              <strong>Balance Due:</strong> {formatCurrency(toMoneyNumber(paymentLedger?.balance_due))}
            </Typography>
          </Alert>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                required
                label="Payment Amount"
                type="number"
                value={paymentFormData.payment_amount}
                onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: toMoneyNumber(e.target.value) })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
                inputProps={{ min: 0, max: paymentLedger ? getLedgerBalanceDue(paymentLedger) : undefined, step: 0.01 }}
                error={!!paymentLedger && isGreaterMoney(paymentFormData.payment_amount, getLedgerBalanceDue(paymentLedger))}
                helperText={
                  paymentLedger
                    ? isGreaterMoney(paymentFormData.payment_amount, getLedgerBalanceDue(paymentLedger))
                      ? `Cannot exceed outstanding balance of ${formatCurrency(getLedgerBalanceDue(paymentLedger))}`
                      : `Outstanding balance: ${formatCurrency(getLedgerBalanceDue(paymentLedger))}`
                    : undefined
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth required>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  value={paymentFormData.payment_method}
                  label="Payment Method"
                  onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_method: e.target.value })}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method.value} value={method.value}>
                      {method.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Payment Reference"
                value={paymentFormData.payment_reference || ''}
                onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_reference: e.target.value })}
                placeholder="Transaction ID, cheque number, etc."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Receipt Number"
                value={paymentFormData.receipt_number || ''}
                onChange={(e) => setPaymentFormData({ ...paymentFormData, receipt_number: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Payment Date"
                type="date"
                value={paymentFormData.payment_date || ''}
                onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_date: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={2}
                value={paymentFormData.notes || ''}
                onChange={(e) => setPaymentFormData({ ...paymentFormData, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </Box>
      )}

      {paymentTab === 1 && (
        <Box>
          {paymentHistory.length === 0 ? (
            <Typography color="text.secondary" textAlign="center" py={3}>
              No payment history yet
            </Typography>
          ) : (
            <List>
              {paymentHistory.map((payment, index) => (
                <React.Fragment key={payment.id}>
                  <ListItem
                    secondaryAction={
                      editingPaymentId === payment.id ? (
                        <Box display="flex" gap={0.5}>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => onSavePaymentDate(payment)}
                            disabled={savingPaymentDate}
                          >
                            {savingPaymentDate ? <CircularProgress size={16} /> : <SaveIcon fontSize="small" />}
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => setEditingPaymentId(null)}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Box display="flex" gap={0.5}>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => {
                              setEditingPaymentId(payment.id);
                              setEditingPaymentDate(formatDateForInput(payment.payment_date));
                            }}
                            title="Edit payment date"
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => onDeletePayment(payment)}
                            title="Delete payment"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      )
                    }
                  >
                    <ListItemText
                      primary={
                        <Box display="flex" justifyContent="space-between" alignItems="center" pr={6}>
                          <Typography variant="body1" fontWeight="medium">
                            {formatCurrency(toMoneyNumber(payment.payment_amount))}
                          </Typography>
                          <Chip label={payment.payment_method} size="small" variant="outlined" />
                        </Box>
                      }
                      secondary={
                        <>
                          {editingPaymentId === payment.id ? (
                            <TextField
                              size="small"
                              type="date"
                              label="Payment Date"
                              value={editingPaymentDate}
                              onChange={(e) => setEditingPaymentDate(e.target.value)}
                              InputLabelProps={{ shrink: true }}
                              sx={{ mt: 1 }}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {formatDateForDisplay(payment.payment_date)}
                            </Typography>
                          )}
                          {payment.payment_reference && (
                            <Typography variant="caption" color="text.secondary">
                              Ref: {payment.payment_reference}
                            </Typography>
                          )}
                          {payment.notes && (
                            <Typography variant="caption" display="block" color="text.secondary">
                              {payment.notes}
                            </Typography>
                          )}
                        </>
                      }
                    />
                  </ListItem>
                  {index < paymentHistory.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Close</Button>
      {paymentTab === 0 && (
        <Button
          onClick={onRecordPayment}
          variant="contained"
          disabled={
            processingPayment ||
            !isPositiveMoney(paymentFormData.payment_amount) ||
            (paymentLedger ? isGreaterMoney(paymentFormData.payment_amount, getLedgerBalanceDue(paymentLedger)) : true)
          }
        >
          {processingPayment ? 'Processing...' : 'Record Payment'}
        </Button>
      )}
    </DialogActions>
  </Dialog>
);

export default PaymentDialog;
