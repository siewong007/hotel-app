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
  Divider,
  Chip,
  Checkbox,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  Description as InvoiceIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import type { Company, CustomerLedger } from '../../../../../types';
import type { HotelSettings } from '../../../../../utils/hotelSettings';
import { formatDateForDisplay, getLedgerUiStatus } from '../helpers';
import { LedgerStatusBadge } from '../StatusPill';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';

type InvoiceListFilter = 'billable' | 'all' | 'invoiced';

interface CompanyInvoiceDialogProps {
  // Dialog state
  open: boolean;
  onClose: () => void;
  showInvoicePreview: boolean;
  onPreview: () => void;
  onBackToEdit: () => void;
  // Form values and setters
  invoiceNumber: string;
  setInvoiceNumber: React.Dispatch<React.SetStateAction<string>>;
  invoiceDate: string;
  setInvoiceDate: React.Dispatch<React.SetStateAction<string>>;
  invoiceDueDate: string;
  setInvoiceDueDate: React.Dispatch<React.SetStateAction<string>>;
  invoiceNotes: string;
  setInvoiceNotes: React.Dispatch<React.SetStateAction<string>>;
  invoiceListFilter: InvoiceListFilter;
  setInvoiceListFilter: React.Dispatch<React.SetStateAction<InvoiceListFilter>>;
  selectedInvoiceLedgers: number[];
  onToggleLedgerSelection: (ledgerId: number) => void;
  onSelectAllEligible: () => void;
  // Lookup / derived data
  invoiceCompany: Company | null;
  invoiceLedgerEntries: CustomerLedger[];
  visibleInvoiceLedgerEntries: CustomerLedger[];
  invoiceFilterCounts: { billable: number; all: number; invoiced: number };
  eligibleInvoiceCount: number;
  hotelSettings: HotelSettings;
  isInvoiceEligible: (ledger: CustomerLedger) => boolean;
  getSelectedInvoiceLedgers: () => CustomerLedger[];
  getSelectedLedgerTotal: () => number;
  getSelectedLedgerPaidTotal: () => number;
  getSelectedLedgerBalanceDue: () => number;
  // Print / download actions
  onPrint: () => void;
  onDownload: () => void;
  // Derived display values
  formatCurrency: (value: number) => string;
}

const CompanyInvoiceDialog: React.FC<CompanyInvoiceDialogProps> = ({
  open,
  onClose,
  showInvoicePreview,
  onPreview,
  onBackToEdit,
  invoiceNumber,
  setInvoiceNumber,
  invoiceDate,
  setInvoiceDate,
  invoiceDueDate,
  setInvoiceDueDate,
  invoiceNotes,
  setInvoiceNotes,
  invoiceListFilter,
  setInvoiceListFilter,
  selectedInvoiceLedgers,
  onToggleLedgerSelection,
  onSelectAllEligible,
  invoiceCompany,
  invoiceLedgerEntries,
  visibleInvoiceLedgerEntries,
  invoiceFilterCounts,
  eligibleInvoiceCount,
  hotelSettings,
  isInvoiceEligible,
  getSelectedInvoiceLedgers,
  getSelectedLedgerTotal,
  getSelectedLedgerPaidTotal,
  getSelectedLedgerBalanceDue,
  onPrint,
  onDownload,
  formatCurrency,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>
      <Box display="flex" alignItems="center" gap={1}>
        <InvoiceIcon color="secondary" />
        {showInvoicePreview ? 'Invoice Preview' : 'Generate Company Invoice'}
      </Box>
    </DialogTitle>
    <DialogContent>
      {invoiceCompany && !showInvoicePreview && (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>
              {invoiceCompany.company_name}
            </Typography>
            {invoiceCompany.contact_person && (
              <Typography variant="caption">Contact: {invoiceCompany.contact_person}</Typography>
            )}
          </Alert>

          {/* Invoice Details */}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                required
                label="Invoice Number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                required
                label="Invoice Date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                required
                label="Due Date"
                type="date"
                value={invoiceDueDate}
                onChange={(e) => setInvoiceDueDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Select Ledger Entries — v2: tri-state chip filter */}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  mb: 1,
                  flexWrap: 'wrap',
                }}
              >
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {([
                    { key: 'billable', label: 'Uninvoiced', count: invoiceFilterCounts.billable },
                    { key: 'all', label: 'All entries', count: invoiceFilterCounts.all },
                    { key: 'invoiced', label: 'Already invoiced', count: invoiceFilterCounts.invoiced },
                  ] as const).map(f => {
                    const on = invoiceListFilter === f.key;
                    return (
                      <Chip
                        key={f.key}
                        size="small"
                        label={
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                            <span>{f.label}</span>
                            <Box
                              component="span"
                              sx={{
                                fontSize: 10,
                                fontWeight: 700,
                                px: 0.6,
                                py: 0.05,
                                borderRadius: '999px',
                                bgcolor: on ? 'rgba(255,255,255,0.25)' : 'action.selected',
                              }}
                            >
                              {f.count}
                            </Box>
                          </Box>
                        }
                        onClick={() => setInvoiceListFilter(f.key)}
                        sx={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          height: 26,
                          bgcolor: on ? 'text.primary' : 'background.paper',
                          color: on ? 'background.paper' : 'text.secondary',
                          border: '1px solid',
                          borderColor: on ? 'text.primary' : 'divider',
                          '&:hover': { bgcolor: on ? 'text.primary' : 'action.hover' },
                        }}
                      />
                    );
                  })}
                </Box>
                <Button
                  size="small"
                  variant="text"
                  onClick={onSelectAllEligible}
                  disabled={eligibleInvoiceCount === 0}
                >
                  {eligibleInvoiceCount > 0 && selectedInvoiceLedgers.length === eligibleInvoiceCount
                    ? 'Deselect all'
                    : 'Select all billable'}
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Already-invoiced entries are protected and cannot be added to a new invoice. Use a credit note
                instead.
              </Typography>
            </Grid>

            {visibleInvoiceLedgerEntries.length === 0 ? (
              <Grid size={12}>
                <Alert severity="warning">
                  No uninvoiced outstanding ledger entries are eligible for invoice generation.
                </Alert>
              </Grid>
            ) : (
              <Grid size={12}>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">Select</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell align="right">Balance</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleInvoiceLedgerEntries.map((ledger) => {
                        const amount = toMoneyNumber(ledger.amount);
                        const balanceDue = toMoneyNumber(ledger.balance_due);
                        const eligible = isInvoiceEligible(ledger);
                        return (
                          <TableRow
                            key={ledger.id}
                            hover={eligible}
                            selected={selectedInvoiceLedgers.includes(ledger.id)}
                            onClick={() => onToggleLedgerSelection(ledger.id)}
                            sx={{
                              cursor: eligible ? 'pointer' : 'not-allowed',
                              opacity: eligible ? 1 : 0.62,
                            }}
                          >
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedInvoiceLedgers.includes(ledger.id)}
                                disabled={!eligible}
                                onChange={() => onToggleLedgerSelection(ledger.id)}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                {ledger.description}
                              </Typography>
                              {ledger.invoice_number && (
                                <Typography variant="caption" color="text.secondary">
                                  Already invoiced: {ledger.invoice_number}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>{formatDateForDisplay(ledger.created_at)}</TableCell>
                            <TableCell>
                              <LedgerStatusBadge status={getLedgerUiStatus(ledger)} />
                            </TableCell>
                            <TableCell align="right">{formatCurrency(amount)}</TableCell>
                            <TableCell align="right">
                              <Typography color={isPositiveMoney(balanceDue) ? 'error.main' : 'success.main'} fontWeight={500}>
                                {formatCurrency(balanceDue)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Summary */}
                <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'grey.50' }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary">Selected Items</Typography>
                      <Typography variant="h6">{getSelectedInvoiceLedgers().length}</Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                      <Typography variant="h6" color="primary.main">
                        {formatCurrency(getSelectedLedgerTotal())}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary">Already Paid</Typography>
                      <Typography variant="h6" color="success.main">
                        {formatCurrency(getSelectedLedgerPaidTotal())}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" color="text.secondary">Balance Due</Typography>
                      <Typography variant="h6" color="error.main">
                        {formatCurrency(getSelectedLedgerBalanceDue())}
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
                {selectedInvoiceLedgers.some(id => {
                  const entry = invoiceLedgerEntries.find(l => l.id === id);
                  return !entry || !isInvoiceEligible(entry);
                }) && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Some selected entries are no longer eligible and will be excluded from the invoice preview.
                  </Alert>
                )}
              </Grid>
            )}

            {/* Notes */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Invoice Notes"
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                placeholder="Additional notes to include on the invoice..."
              />
            </Grid>
          </Grid>
        </>
      )}

      {/* Invoice Preview */}
      {invoiceCompany && showInvoicePreview && (
        <Box id="company-invoice-content">
          {/* Invoice Header */}
          <Box
            className="invoice-header"
            sx={{
              textAlign: 'center',
              mb: 3,
              pb: 2,
              borderBottom: '3px solid #1976d2',
            }}
          >
            <Typography variant="h4" sx={{ fontWeight: 700, color: '#1976d2', mb: 0.5 }}>
              {hotelSettings.hotel_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {hotelSettings.hotel_address}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Phone: {hotelSettings.hotel_phone} | Email: {hotelSettings.hotel_email}
            </Typography>
          </Box>

          {/* Invoice Title Bar */}
          <Box
            sx={{
              bgcolor: '#1976d2',
              color: 'white',
              py: 1,
              px: 2,
              mb: 3,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
              Invoice
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              #{invoiceNumber}
            </Typography>
          </Box>

          {/* Two-column: Bill To + Invoice Details */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
            {/* Bill To */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" sx={{ color: '#1976d2', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>
                Bill To
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{invoiceCompany.company_name}</Typography>
              {invoiceCompany.registration_number && (
                <Typography variant="body2" color="text.secondary">Reg No: {invoiceCompany.registration_number}</Typography>
              )}
              {invoiceCompany.billing_address && (
                <Typography variant="body2">{invoiceCompany.billing_address}</Typography>
              )}
              {(invoiceCompany.billing_city || invoiceCompany.billing_state || invoiceCompany.billing_postal_code) && (
                <Typography variant="body2">
                  {[invoiceCompany.billing_city, invoiceCompany.billing_state, invoiceCompany.billing_postal_code].filter(Boolean).join(', ')}
                </Typography>
              )}
              {invoiceCompany.contact_person && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>Attn:</Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>{invoiceCompany.contact_person}</Box>
                </Typography>
              )}
              {invoiceCompany.contact_email && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>Email:</Box>
                  <Box component="span">{invoiceCompany.contact_email}</Box>
                </Typography>
              )}
              {invoiceCompany.contact_phone && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>Phone:</Box>
                  <Box component="span">{invoiceCompany.contact_phone}</Box>
                </Typography>
              )}
            </Box>

            {/* Invoice Details */}
            <Box sx={{ minWidth: 220, textAlign: 'right' }}>
              <Typography variant="overline" sx={{ color: '#1976d2', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>
                Invoice Details
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#666' }}>Invoice Date:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{formatDateForDisplay(invoiceDate)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#666' }}>Due Date:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{formatDateForDisplay(invoiceDueDate)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#666' }}>Terms:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{invoiceCompany.payment_terms_days || 30} days</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ color: '#666' }}>Status:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2, color: isPositiveMoney(getSelectedLedgerBalanceDue()) ? '#d32f2f' : '#2e7d32' }}>
                  {isPositiveMoney(getSelectedLedgerBalanceDue()) ? 'Outstanding' : 'Settled'}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Line Items Table */}
          <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #ddd', borderRadius: 0, mb: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    Description
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    Date
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    Room
                  </TableCell>
                  <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    Amount
                  </TableCell>
                  <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    Paid
                  </TableCell>
                  <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    Balance
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoiceLedgerEntries
                  .filter(l => selectedInvoiceLedgers.includes(l.id))
                  .map((ledger, idx) => {
                    const amount = toMoneyNumber(ledger.amount);
                    const paidAmount = toMoneyNumber(ledger.paid_amount);
                    const balanceDue = toMoneyNumber(ledger.balance_due);
                    return (
                      <TableRow key={ledger.id} sx={{ bgcolor: idx % 2 === 0 ? 'white' : '#fafafa' }}>
                        <TableCell sx={{ py: 1.5, fontSize: 13 }}>{ledger.description}</TableCell>
                        <TableCell sx={{ py: 1.5, fontSize: 13 }}>{formatDateForDisplay(ledger.created_at)}</TableCell>
                        <TableCell sx={{ py: 1.5, fontSize: 13 }}>{ledger.room_number || '-'}</TableCell>
                        <TableCell align="right" sx={{ py: 1.5, fontSize: 13, fontWeight: 600 }}>
                          {formatCurrency(amount)}
                        </TableCell>
                        <TableCell align="right" sx={{ py: 1.5, fontSize: 13, fontWeight: 600, color: '#2e7d32' }}>
                          {isPositiveMoney(paidAmount) ? formatCurrency(paidAmount) : '-'}
                        </TableCell>
                        <TableCell align="right" sx={{ py: 1.5, fontSize: 13, fontWeight: 600, color: isPositiveMoney(balanceDue) ? '#d32f2f' : '#2e7d32' }}>
                          {formatCurrency(balanceDue)}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                {/* Subtotal */}
                <TableRow>
                  <TableCell colSpan={3} align="right" sx={{ borderTop: '2px solid #ddd', pt: 2, fontWeight: 600, fontSize: 13 }}>
                    Subtotal:
                  </TableCell>
                  <TableCell align="right" sx={{ borderTop: '2px solid #ddd', pt: 2, fontWeight: 700, fontSize: 13 }}>
                    {formatCurrency(getSelectedLedgerTotal())}
                  </TableCell>
                  <TableCell colSpan={2} sx={{ borderTop: '2px solid #ddd' }} />
                </TableRow>

                {/* Total Amount Due */}
                <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                  <TableCell colSpan={5} align="right" sx={{ borderTop: '3px double #1976d2', py: 2 }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#1976d2' }}>
                      Total Amount Due:
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ borderTop: '3px double #1976d2', py: 2 }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#1976d2' }}>
                      {formatCurrency(getSelectedLedgerBalanceDue())}
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* Notes */}
          {invoiceNotes && (
            <Box sx={{ mt: 3, p: 2, bgcolor: '#fff3cd', borderLeft: '4px solid #ffc107', borderRadius: 0.5 }}>
              <Typography variant="subtitle2" sx={{ color: '#856404', mb: 0.5 }}>Notes:</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: '#856404' }}>
                {invoiceNotes}
              </Typography>
            </Box>
          )}

          {/* Footer */}
          <Box sx={{ mt: 5, pt: 2, borderTop: '1px solid #ddd', textAlign: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1976d2', mb: 0.5 }}>
              Thank you for your business!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Please make payment within {invoiceCompany.payment_terms_days || 30} days of invoice date.
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              This is a computer-generated invoice. | {hotelSettings.hotel_name}
            </Typography>
          </Box>
        </Box>
      )}
    </DialogContent>
    <DialogActions>
      {!showInvoicePreview ? (
        <>
          <Button onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onPreview}
            variant="contained"
            disabled={getSelectedInvoiceLedgers().length === 0 || !invoiceNumber}
            startIcon={<InvoiceIcon />}
          >
            Preview Invoice
          </Button>
        </>
      ) : (
        <>
          <Button onClick={onBackToEdit}>
            Back to Edit
          </Button>
          <Button
            onClick={onPrint}
            variant="outlined"
            startIcon={<PrintIcon />}
          >
            Print
          </Button>
          <Button
            onClick={onDownload}
            variant="contained"
            startIcon={<DownloadIcon />}
          >
            Download
          </Button>
        </>
      )}
    </DialogActions>
  </Dialog>
);

export default CompanyInvoiceDialog;
