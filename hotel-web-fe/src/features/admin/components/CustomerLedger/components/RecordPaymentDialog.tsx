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
  Paper,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Close as CloseIcon,
  Payment as PaymentIcon,
} from '@mui/icons-material';
import type {
  Company,
  CustomerLedger,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
} from '../../../../../types';
import { asMoney, formatDateForDisplay, formatDateForInput } from '../helpers';
import { PAYMENT_METHODS } from '../constants';
import { isGreaterMoney, isPositiveMoney, subtractMoney, sumMoney, toMoneyNumber } from '../../../../../utils/money';

export interface CompanyPaymentForm {
  payment_amount: string;
  payment_method: string;
  payment_reference: string;
  receipt_number: string;
  notes: string;
  payment_date: string;
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
}

interface EntryModeProps extends BaseProps {
  mode: 'entry';
  paymentTab: number;
  setPaymentTab: React.Dispatch<React.SetStateAction<number>>;
  paymentFormData: CustomerLedgerPaymentRequest;
  setPaymentFormData: React.Dispatch<React.SetStateAction<CustomerLedgerPaymentRequest>>;
  paymentLedger: CustomerLedger | null;
  paymentHistory: CustomerLedgerPayment[];
  editingPaymentId: number | null;
  setEditingPaymentId: React.Dispatch<React.SetStateAction<number | null>>;
  editingPaymentDate: string;
  setEditingPaymentDate: React.Dispatch<React.SetStateAction<string>>;
  savingPaymentDate: boolean;
  processingPayment: boolean;
  onRecordPayment: () => void;
  onSavePaymentDate: (payment: CustomerLedgerPayment) => void;
  onDeletePayment: (payment: CustomerLedgerPayment) => void;
  getLedgerBalanceDue: (ledger: CustomerLedger) => number;
}

interface CompanyModeProps extends BaseProps {
  mode: 'company';
  companyPaymentForm: CompanyPaymentForm;
  setCompanyPaymentForm: React.Dispatch<React.SetStateAction<CompanyPaymentForm>>;
  selectedLedgersForPayment: CustomerLedger[];
  setSelectedLedgersForPayment: React.Dispatch<React.SetStateAction<CustomerLedger[]>>;
  paymentCompany: Company | null;
  paymentCompanyLedgers: CustomerLedger[];
  ledgers: CustomerLedger[];
  processingCompanyPayment: boolean;
  onSubmit: () => void;
}

export type RecordPaymentDialogProps = EntryModeProps | CompanyModeProps;

interface PaymentFieldsProps {
  amount: string;
  onAmountChange: (value: string) => void;
  method: string;
  onMethodChange: (value: string) => void;
  reference: string;
  onReferenceChange: (value: string) => void;
  receipt: string;
  onReceiptChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  currencySymbol: string;
  amountError?: boolean;
  amountHelperText?: string;
  amountMax?: number;
}

/** The payment field grid both modes share — one layout, one method list. */
const PaymentFields: React.FC<PaymentFieldsProps> = ({
  amount,
  onAmountChange,
  method,
  onMethodChange,
  reference,
  onReferenceChange,
  receipt,
  onReceiptChange,
  date,
  onDateChange,
  notes,
  onNotesChange,
  currencySymbol,
  amountError,
  amountHelperText,
  amountMax,
}) => (
  <Grid container spacing={2}>
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField
        fullWidth
        required
        label="Payment Amount"
        type="number"
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        error={amountError}
        helperText={amountHelperText}
        slotProps={{
          input: {
            startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
          },
          htmlInput: { min: 0, max: amountMax, step: 0.01 },
        }}
      />
    </Grid>
    <Grid size={{ xs: 12, sm: 6 }}>
      <FormControl fullWidth required>
        <InputLabel>Payment Method</InputLabel>
        <Select
          value={method}
          label="Payment Method"
          onChange={(e) => onMethodChange(e.target.value)}
        >
          {PAYMENT_METHODS.map((m) => (
            <MenuItem key={m.value} value={m.value}>
              {m.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Grid>
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField
        fullWidth
        label="Payment Reference"
        value={reference}
        onChange={(e) => onReferenceChange(e.target.value)}
        placeholder="Transaction ID, cheque number, etc."
      />
    </Grid>
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField
        fullWidth
        label="Receipt Number"
        value={receipt}
        onChange={(e) => onReceiptChange(e.target.value)}
      />
    </Grid>
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField
        fullWidth
        label="Payment Date"
        type="date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Grid>
    <Grid size={12}>
      <TextField
        fullWidth
        label="Notes"
        multiline
        rows={2}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
      />
    </Grid>
  </Grid>
);

const EntryModeBody: React.FC<EntryModeProps> = (props) => {
  const {
    paymentTab, setPaymentTab, paymentFormData, setPaymentFormData, paymentLedger,
    paymentHistory, editingPaymentId, setEditingPaymentId, editingPaymentDate,
    setEditingPaymentDate, savingPaymentDate, onSavePaymentDate, onDeletePayment,
    currencySymbol, formatCurrency, getLedgerBalanceDue,
  } = props;
  return (
    <>
      <Tabs value={paymentTab} onChange={(_e, v) => setPaymentTab(v)} sx={{ mb: 2 }}>
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

          <PaymentFields
            amount={String(paymentFormData.payment_amount ?? '')}
            onAmountChange={(v) => setPaymentFormData({ ...paymentFormData, payment_amount: toMoneyNumber(v) })}
            method={paymentFormData.payment_method}
            onMethodChange={(v) => setPaymentFormData({ ...paymentFormData, payment_method: v })}
            reference={paymentFormData.payment_reference || ''}
            onReferenceChange={(v) => setPaymentFormData({ ...paymentFormData, payment_reference: v })}
            receipt={paymentFormData.receipt_number || ''}
            onReceiptChange={(v) => setPaymentFormData({ ...paymentFormData, receipt_number: v })}
            date={paymentFormData.payment_date || ''}
            onDateChange={(v) => setPaymentFormData({ ...paymentFormData, payment_date: v })}
            notes={paymentFormData.notes || ''}
            onNotesChange={(v) => setPaymentFormData({ ...paymentFormData, notes: v })}
            currencySymbol={currencySymbol}
            amountError={!!paymentLedger && isGreaterMoney(paymentFormData.payment_amount, getLedgerBalanceDue(paymentLedger))}
            amountHelperText={
              paymentLedger
                ? isGreaterMoney(paymentFormData.payment_amount, getLedgerBalanceDue(paymentLedger))
                  ? `Cannot exceed outstanding balance of ${formatCurrency(getLedgerBalanceDue(paymentLedger))}`
                  : `Outstanding balance: ${formatCurrency(getLedgerBalanceDue(paymentLedger))}`
                : undefined
            }
            amountMax={paymentLedger ? getLedgerBalanceDue(paymentLedger) : undefined}
          />
        </Box>
      )}

      {paymentTab === 1 && (
        <Box>
          {paymentHistory.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 3 }}>
              No payment history yet
            </Typography>
          ) : (
            <List>
              {paymentHistory.map((payment, index) => (
                <React.Fragment key={payment.id}>
                  <ListItem
                    secondaryAction={
                      editingPaymentId === payment.id ? (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => onSavePaymentDate(payment)}
                            disabled={savingPaymentDate}
                            aria-label="Save payment date"
                          >
                            {savingPaymentDate ? <CircularProgress size={16} /> : <SaveIcon fontSize="small" />}
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => setEditingPaymentId(null)}
                            aria-label="Cancel edit"
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <IconButton
                            size="small"
                            color="primary"
                            aria-label="Edit payment date"
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
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 6 }}>
                          <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
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
                              sx={{ mt: 1 }}
                              slotProps={{ inputLabel: { shrink: true } }}
                            />
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              {formatDateForDisplay(payment.payment_date)}
                            </Typography>
                          )}
                          {payment.payment_reference && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              Ref: {payment.payment_reference}
                            </Typography>
                          )}
                          {payment.notes && (
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
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
    </>
  );
};

const CompanyModeBody: React.FC<CompanyModeProps> = (props) => {
  const {
    companyPaymentForm, setCompanyPaymentForm, selectedLedgersForPayment,
    setSelectedLedgersForPayment, paymentCompany, paymentCompanyLedgers, ledgers,
    currencySymbol, formatCurrency,
  } = props;

  const selectedDue = selectedLedgersForPayment.reduce((sum, l) => {
    const amount = asMoney(l.amount);
    const balanceDue = l.balance_due === null || l.balance_due === undefined ? amount : asMoney(l.balance_due);
    return sumMoney([sum, balanceDue]);
  }, 0);
  const companyDue = paymentCompany
    ? ledgers
        .filter((l) => l.company_name === paymentCompany.company_name)
        .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0)
    : 0;
  const amount = toMoneyNumber(companyPaymentForm.payment_amount);
  const exceedsSelection = isGreaterMoney(amount, selectedDue) && !isGreaterMoney(amount, companyDue);
  const exceedsOutstanding = isGreaterMoney(amount, companyDue);

  return (
    <>
      {paymentCompany && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
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
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Select Ledger Entries</Typography>
            <Paper variant="outlined" sx={{ maxHeight: 220, overflow: 'auto' }}>
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
                  label={<Typography variant="body2" sx={{ fontWeight: 600 }}>Select All</Typography>}
                />
              </Box>
              {paymentCompanyLedgers.map((ledger) => {
                const ledgerAmount = asMoney(ledger.amount);
                const balanceDue = ledger.balance_due === null || ledger.balance_due === undefined
                  ? ledgerAmount
                  : asMoney(ledger.balance_due);
                const isSelected = selectedLedgersForPayment.some((l) => l.id === ledger.id);
                return (
                  <Box
                    key={ledger.id}
                    sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', '&:hover': { bgcolor: 'var(--hotel-surface-sunken)' } }}
                  >
                    <FormControlLabel
                      sx={{ flex: 1, mr: 0 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedLedgersForPayment((prev) =>
                              isSelected ? prev.filter((l) => l.id !== ledger.id) : [...prev, ledger]
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
                            sx={{ color: 'error.main', fontWeight: 600, ml: 2, whiteSpace: 'nowrap' }}
                          >
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

          {selectedLedgersForPayment.length > 0 && (
            <Grid size={12}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)' }}>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Selected Entries</Typography>
                    <Typography variant="body2">{selectedLedgersForPayment.length} of {paymentCompanyLedgers.length} entries</Typography>
                  </Grid>
                  <Grid size={3}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Total Amount</Typography>
                    <Typography variant="body2">
                      {formatCurrency(selectedLedgersForPayment.reduce((sum, l) => sumMoney([sum, l.amount]), 0))}
                    </Typography>
                  </Grid>
                  <Grid size={3}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Total Balance Due</Typography>
                    <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>
                      {formatCurrency(selectedDue)}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          )}

          {(exceedsSelection || exceedsOutstanding) && (
            <Grid size={12}>
              {exceedsSelection && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Payment amount exceeds selected entries by{' '}
                  <strong>{formatCurrency(subtractMoney(amount, selectedDue))}</strong>. The excess will be parked as
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
          )}

          <Grid size={12}>
            <PaymentFields
              amount={companyPaymentForm.payment_amount}
              onAmountChange={(v) => setCompanyPaymentForm({ ...companyPaymentForm, payment_amount: v })}
              method={companyPaymentForm.payment_method}
              onMethodChange={(v) => setCompanyPaymentForm({ ...companyPaymentForm, payment_method: v })}
              reference={companyPaymentForm.payment_reference}
              onReferenceChange={(v) => setCompanyPaymentForm({ ...companyPaymentForm, payment_reference: v })}
              receipt={companyPaymentForm.receipt_number}
              onReceiptChange={(v) => setCompanyPaymentForm({ ...companyPaymentForm, receipt_number: v })}
              date={companyPaymentForm.payment_date}
              onDateChange={(v) => setCompanyPaymentForm({ ...companyPaymentForm, payment_date: v })}
              notes={companyPaymentForm.notes}
              onNotesChange={(v) => setCompanyPaymentForm({ ...companyPaymentForm, notes: v })}
              currencySymbol={currencySymbol}
              amountHelperText={
                paymentCompany ? `Max ${formatCurrency(companyDue)}` : undefined
              }
              amountMax={paymentCompany ? companyDue : undefined}
            />
          </Grid>
        </Grid>
      )}
    </>
  );
};

/**
 * The single "record a company-ledger payment" dialog. `entry` mode posts one
 * payment against a specific ledger row (POST ledgers/{id}/payments, with the
 * payment-history tab); `company` mode distributes one payment across selected
 * entries (POST ledgers/company-payments, with credit-on-account overflow).
 */
const RecordPaymentDialog: React.FC<RecordPaymentDialogProps> = (props) => {
  const { mode, open, onClose } = props;

  const submitDisabled =
    mode === 'entry'
      ? props.processingPayment ||
        !isPositiveMoney(props.paymentFormData.payment_amount) ||
        (props.paymentLedger
          ? isGreaterMoney(props.paymentFormData.payment_amount, props.getLedgerBalanceDue(props.paymentLedger))
          : true)
      : (() => {
          if (props.processingCompanyPayment) return true;
          if (props.selectedLedgersForPayment.length === 0) return true;
          const amt = toMoneyNumber(props.companyPaymentForm.payment_amount);
          if (!isPositiveMoney(amt)) return true;
          // Only block when payment exceeds the company's TOTAL outstanding —
          // exceeding the current selection is allowed (parked as credit).
          const companyDue = props.paymentCompany
            ? props.ledgers
                .filter((l) => l.company_name === props.paymentCompany!.company_name)
                .reduce((sum, l) => sumMoney([sum, l.balance_due]), 0)
            : 0;
          return isGreaterMoney(amt, companyDue);
        })();

  const busy = mode === 'entry' ? props.processingPayment : props.processingCompanyPayment;
  const submitLabel = busy ? 'Processing...' : 'Record Payment';
  const entryOnRecordTab = mode === 'entry' && props.paymentTab === 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={mode === 'entry' ? 'md' : 'sm'} fullWidth>
      <DialogTitle>
        {mode === 'entry' ? (
          <>Payment - {props.paymentLedger?.company_name}</>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PaymentIcon color="primary" />
            Record Payment
          </Box>
        )}
      </DialogTitle>
      <DialogContent>
        {mode === 'entry' ? <EntryModeBody {...props} /> : <CompanyModeBody {...props} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{mode === 'entry' ? 'Close' : 'Cancel'}</Button>
        {(mode === 'company' || entryOnRecordTab) && (
          <Button
            onClick={mode === 'entry' ? props.onRecordPayment : props.onSubmit}
            variant="contained"
            disabled={submitDisabled}
            startIcon={mode === 'company' ? (busy ? <CircularProgress size={20} /> : <PaymentIcon />) : undefined}
          >
            {submitLabel}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default RecordPaymentDialog;
