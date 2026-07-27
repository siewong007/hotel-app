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
  Alert,
  Paper,
  FormControlLabel,
  Checkbox,
  MenuItem,
  CircularProgress,
} from '@mui/material';
import { Payment as PaymentIcon } from '@mui/icons-material';
import type { Company, CustomerLedger } from '../../../../../types';
import { asMoney } from '../helpers';
import { isGreaterMoney, isPositiveMoney, subtractMoney, sumMoney, toMoneyNumber } from '../../../../../utils/money';

export interface CompanyPaymentForm {
  payment_amount: string;
  payment_method: string;
  payment_reference: string;
  receipt_number: string;
  notes: string;
  payment_date: string;
}

interface RecordCompanyPaymentDialogProps {
  // Dialog state
  open: boolean;
  onClose: () => void;
  // Form values and setters
  companyPaymentForm: CompanyPaymentForm;
  setCompanyPaymentForm: React.Dispatch<React.SetStateAction<CompanyPaymentForm>>;
  selectedLedgersForPayment: CustomerLedger[];
  setSelectedLedgersForPayment: React.Dispatch<React.SetStateAction<CustomerLedger[]>>;
  // Lookup data
  paymentCompany: Company | null;
  paymentCompanyLedgers: CustomerLedger[];
  ledgers: CustomerLedger[];
  // Submission callback and submitting state
  processingCompanyPayment: boolean;
  onSubmit: () => void;
  // Derived display values
  currencySymbol: string;
  formatCurrency: (value: number) => string;
}

const RecordCompanyPaymentDialog: React.FC<RecordCompanyPaymentDialogProps> = ({
  open,
  onClose,
  companyPaymentForm,
  setCompanyPaymentForm,
  selectedLedgersForPayment,
  setSelectedLedgersForPayment,
  paymentCompany,
  paymentCompanyLedgers,
  ledgers,
  processingCompanyPayment,
  onSubmit,
  currencySymbol,
  formatCurrency,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1
        }}>
        <PaymentIcon color="primary" />
        Record Payment
      </Box>
    </DialogTitle>
    <DialogContent>
      {paymentCompany && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{
            fontWeight: 600
          }}>
            {paymentCompany.company_name}
          </Typography>
          {paymentCompany.contact_person && (
            <Typography variant="caption">Contact: {paymentCompany.contact_person}</Typography>
          )}
        </Alert>
      )}

      {paymentCompanyLedgers.length === 0 ? (
        <Alert severity="warning">
          No outstanding ledger entries found for this company.
        </Alert>
      ) : (
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {/* Select Ledger Entries */}
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Select Ledger Entries</Typography>
            <Paper variant="outlined" sx={{ maxHeight: 220, overflow: 'auto' }}>
              {/* Select All */}
              <Box sx={{ px: 2, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedLedgersForPayment.length === paymentCompanyLedgers.length}
                      indeterminate={selectedLedgersForPayment.length > 0 && selectedLedgersForPayment.length < paymentCompanyLedgers.length}
                      onChange={(e) => setSelectedLedgersForPayment(e.target.checked ? [...paymentCompanyLedgers] : [])}
                    />
                  }
                  label={<Typography variant="body2" sx={{
                    fontWeight: 600
                  }}>Select All</Typography>}
                />
              </Box>
              {paymentCompanyLedgers.map((ledger) => {
                const amount = asMoney(ledger.amount);
                const balanceDue = ledger.balance_due === null || ledger.balance_due === undefined
                  ? amount
                  : asMoney(ledger.balance_due);
                const isSelected = selectedLedgersForPayment.some(l => l.id === ledger.id);
                return (
                  <Box
                    key={ledger.id}
                    sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', '&:hover': { bgcolor: 'grey.50' } }}
                  >
                    <FormControlLabel
                      sx={{ flex: 1, mr: 0 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedLedgersForPayment(prev =>
                              isSelected ? prev.filter(l => l.id !== ledger.id) : [...prev, ledger]
                            );
                          }}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                          <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                            {ledger.description}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "error.main",
                              fontWeight: 600,
                              ml: 2,
                              whiteSpace: 'nowrap'
                            }}>
                            Due: {formatCurrency(balanceDue)}
                          </Typography>
                        </Box>
                      }
                    />
                  </Box>
                );
              })}
            </Paper>
          </Grid>

          {/* Selected Entries Summary */}
          {selectedLedgersForPayment.length > 0 && (
            <Grid size={12}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Selected Entries</Typography>
                    <Typography variant="body2">{selectedLedgersForPayment.length} of {paymentCompanyLedgers.length} entries</Typography>
                  </Grid>
                  <Grid size={3}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Total Amount</Typography>
                    <Typography variant="body2">
                      {formatCurrency(selectedLedgersForPayment.reduce((sum, l) => {
                        return sumMoney([sum, l.amount]);
                      }, 0))}
                    </Typography>
                  </Grid>
                  <Grid size={3}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Total Balance Due</Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "error.main",
                        fontWeight: 600
                      }}>
                      {formatCurrency(selectedLedgersForPayment.reduce((sum, l) => {
                        const amount = asMoney(l.amount);
                        const balanceDue = l.balance_due === null || l.balance_due === undefined
                          ? amount
                          : asMoney(l.balance_due);
                        return sumMoney([sum, balanceDue]);
                      }, 0))}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          )}

          {/* Payment overflow warnings (v2) */}
          {(() => {
            const amt = toMoneyNumber(companyPaymentForm.payment_amount);
            const selectedDue = selectedLedgersForPayment.reduce((sum, l) => {
              const amount = asMoney(l.amount);
              const balanceDue = l.balance_due === null || l.balance_due === undefined
                ? amount
                : asMoney(l.balance_due);
              return sumMoney([sum, balanceDue]);
            }, 0);
            const companyDue = paymentCompany
              ? ledgers
                  .filter(l => l.company_name === paymentCompany.company_name)
                  .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0)
              : 0;
            const exceedsSelection = isGreaterMoney(amt, selectedDue) && !isGreaterMoney(amt, companyDue);
            const exceedsOutstanding = isGreaterMoney(amt, companyDue);
            if (!exceedsSelection && !exceedsOutstanding) return null;
            return (
              <Grid size={12}>
                {exceedsSelection && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    Payment amount exceeds selected entries by{' '}
                    <strong>{formatCurrency(subtractMoney(amt, selectedDue))}</strong>. The excess will be parked as
                    credit on account.
                  </Alert>
                )}
                {exceedsOutstanding && (
                  <Alert severity="error">
                    Payment amount exceeds the company's total outstanding balance of{' '}
                    <strong>{formatCurrency(companyDue)}</strong>. Reduce the amount, or issue a credit note instead.
                  </Alert>
                )}
              </Grid>
            );
          })()}

          {/* Payment Amount */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              required
              label="Payment Amount"
              type="number"
              value={companyPaymentForm.payment_amount}
              onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_amount: e.target.value })}
              helperText={
                paymentCompany
                  ? `Max ${formatCurrency(
                      ledgers
                        .filter(l => l.company_name === paymentCompany.company_name)
                        .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0),
                    )}`
                  : undefined
              }
              slotProps={{
                input: {
                  startAdornment: <Typography sx={{ mr: 1 }}>{currencySymbol}</Typography>,
                  inputProps: paymentCompany
                    ? {
                        min: 0,
                        max: ledgers
                          .filter(l => l.company_name === paymentCompany.company_name)
                          .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0)
                          .toFixed(2),
                      }
                    : { min: 0 },
                }
              }}
            />
          </Grid>

          {/* Payment Method */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              fullWidth
              label="Payment Method"
              value={companyPaymentForm.payment_method}
              onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_method: e.target.value })}
            >
              <MenuItem value="cash">Cash</MenuItem>
              <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
              <MenuItem value="credit_card">Credit Card</MenuItem>
              <MenuItem value="cheque">Cheque</MenuItem>
              <MenuItem value="online">Online Payment</MenuItem>
            </TextField>
          </Grid>

          {/* Payment Reference */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Payment Reference"
              value={companyPaymentForm.payment_reference}
              onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_reference: e.target.value })}
              placeholder="Transaction ID, cheque number, etc."
            />
          </Grid>

          {/* Receipt Number */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Receipt Number"
              value={companyPaymentForm.receipt_number}
              onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, receipt_number: e.target.value })}
            />
          </Grid>

          {/* Payment Date */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Payment Date"
              type="date"
              value={companyPaymentForm.payment_date}
              onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, payment_date: e.target.value })}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>

          {/* Notes */}
          <Grid size={12}>
            <TextField
              fullWidth
              multiline
              rows={2}
              label="Notes"
              value={companyPaymentForm.notes}
              onChange={(e) => setCompanyPaymentForm({ ...companyPaymentForm, notes: e.target.value })}
              placeholder="Additional notes about this payment..."
            />
          </Grid>
        </Grid>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        onClick={onSubmit}
        variant="contained"
        disabled={(() => {
          if (processingCompanyPayment) return true;
          if (selectedLedgersForPayment.length === 0) return true;
          const amt = toMoneyNumber(companyPaymentForm.payment_amount);
          if (!isPositiveMoney(amt)) return true;
          // v2: only block when payment exceeds the company's TOTAL outstanding
          // (exceeding the current selection is allowed — handled as credit on account).
          const companyDue = paymentCompany
            ? ledgers
                .filter(l => l.company_name === paymentCompany.company_name)
                .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0)
            : 0;
          return isGreaterMoney(amt, companyDue);
        })()}
        startIcon={processingCompanyPayment ? <CircularProgress size={20} /> : <PaymentIcon />}
      >
        {processingCompanyPayment ? 'Processing...' : 'Record Payment'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default RecordCompanyPaymentDialog;
