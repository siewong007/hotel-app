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
  Stack,
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
import { useIsPhone } from '../../../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../../../components/data-table/MobileCardRow';
import { useTranslation } from '../../../../../i18n';

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
}) => {
  const isPhone = useIsPhone();
  const { t } = useTranslation('finance');
  return (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1
        }}>
        <InvoiceIcon color="secondary" />
        {showInvoicePreview ? t('ledger.invoice.previewTitle') : t('ledger.invoice.title')}
      </Box>
    </DialogTitle>
    <DialogContent>
      {invoiceCompany && !showInvoicePreview && (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{
              fontWeight: 600
            }}>
              {invoiceCompany.company_name}
            </Typography>
            {invoiceCompany.contact_person && (
              <Typography variant="caption">{t('ledger.field.contactPerson')}: {invoiceCompany.contact_person}</Typography>
            )}
          </Alert>

          {/* Invoice Details */}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                required
                label={t('ledger.invoice.number')}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                required
                label={t('ledger.field.invoiceDate')}
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                required
                label={t('ledger.field.dueDate')}
                type="date"
                value={invoiceDueDate}
                onChange={(e) => setInvoiceDueDate(e.target.value)}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
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
                    { key: 'billable', label: t('status:ledger.uninvoiced'), count: invoiceFilterCounts.billable },
                    { key: 'all', label: t('ledger.invoice.filterAll'), count: invoiceFilterCounts.all },
                    { key: 'invoiced', label: t('ledger.invoice.filterInvoiced'), count: invoiceFilterCounts.invoiced },
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
                                bgcolor: on ? 'color-mix(in srgb, var(--hotel-bg) 30%, transparent)' : 'action.selected',
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
                    ? t('ledger.invoice.deselectAll')
                    : t('ledger.invoice.selectAllBillable')}
                </Button>
              </Box>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: 'block',
                  mb: 0.5
                }}>
                {t('ledger.invoice.protectedNote')}
              </Typography>
            </Grid>

            {visibleInvoiceLedgerEntries.length === 0 ? (
              <Grid size={12}>
                <Alert severity="warning">
                  {t('ledger.invoice.noEligible')}
                </Alert>
              </Grid>
            ) : (
              <Grid size={12}>
                {isPhone ? (
                  <Paper variant="outlined" sx={{ maxHeight: 320, overflowY: 'auto' }}>
                    {visibleInvoiceLedgerEntries.map((ledger) => {
                      const amount = toMoneyNumber(ledger.amount);
                      const balanceDue = toMoneyNumber(ledger.balance_due);
                      const eligible = isInvoiceEligible(ledger);
                      return (
                        <Box
                          key={ledger.id}
                          sx={{
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            opacity: eligible ? 1 : 0.62,
                            '&:last-child': { borderBottom: 0 },
                          }}
                        >
                          <MobileCardRow
                            selected={selectedInvoiceLedgers.includes(ledger.id)}
                            title={ledger.description}
                            subtitle={`${formatDateForDisplay(ledger.created_at)}${ledger.invoice_number ? ` · ${t('ledger.invoice.alreadyInvoiced', { number: ledger.invoice_number })}` : ''}`}
                            meta={t('ledger.invoice.entryMeta', { amount: formatCurrency(amount), balance: formatCurrency(balanceDue) })}
                            status={
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <LedgerStatusBadge status={getLedgerUiStatus(ledger)} />
                                <Checkbox
                                  checked={selectedInvoiceLedgers.includes(ledger.id)}
                                  disabled={!eligible}
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  onChange={() => onToggleLedgerSelection(ledger.id)}
                                  slotProps={{ input: { 'aria-label': t('ledger.invoice.selectEntryAria', { description: ledger.description }) } }}
                                />
                              </Stack>
                            }
                            onClick={eligible ? () => onToggleLedgerSelection(ledger.id) : undefined}
                          />
                        </Box>
                      );
                    })}
                  </Paper>
                ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">{t('common:actions.select')}</TableCell>
                        <TableCell>{t('common:field.description')}</TableCell>
                        <TableCell>{t('common:field.date')}</TableCell>
                        <TableCell>{t('common:field.status')}</TableCell>
                        <TableCell align="right">{t('common:field.amount')}</TableCell>
                        <TableCell align="right">{t('ledger.col.balance')}</TableCell>
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
                                <Typography variant="caption" sx={{
                                  color: "text.secondary"
                                }}>
                                  {t('ledger.invoice.alreadyInvoiced', { number: ledger.invoice_number })}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>{formatDateForDisplay(ledger.created_at)}</TableCell>
                            <TableCell>
                              <LedgerStatusBadge status={getLedgerUiStatus(ledger)} />
                            </TableCell>
                            <TableCell align="right">{formatCurrency(amount)}</TableCell>
                            <TableCell align="right">
                              <Typography color={isPositiveMoney(balanceDue) ? 'error.main' : 'success.main'} sx={{
                                fontWeight: 500
                              }}>
                                {formatCurrency(balanceDue)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                )}

                {/* Summary */}
                <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>{t('ledger.invoice.selectedItems')}</Typography>
                      <Typography variant="h6">{getSelectedInvoiceLedgers().length}</Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>{t('ledger.payment.totalAmount')}</Typography>
                      <Typography variant="h6" sx={{
                        color: "primary.main"
                      }}>
                        {formatCurrency(getSelectedLedgerTotal())}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>{t('ledger.payment.alreadyPaid')}</Typography>
                      <Typography variant="h6" sx={{
                        color: "success.main"
                      }}>
                        {formatCurrency(getSelectedLedgerPaidTotal())}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>{t('ledger.payment.balanceDue')}</Typography>
                      <Typography variant="h6" sx={{
                        color: "error.main"
                      }}>
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
                    {t('ledger.invoice.ineligibleWarning')}
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
                label={t('ledger.invoice.notesLabel')}
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                placeholder={t('ledger.invoice.notesPlaceholder')}
              />
            </Grid>
          </Grid>
        </>
      )}

      {/* Invoice Preview — renders the paper document on a paper surface
          (print identity is intentionally light; see docs/DESIGN_SYSTEM.md). */}
      {invoiceCompany && showInvoicePreview && (
        <Box id="company-invoice-content" sx={{ bgcolor: '#FFFFFF', color: '#1C1E24', p: 3, borderRadius: 1 }}>
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
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {hotelSettings.hotel_address}
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('common:field.phone')}: {hotelSettings.hotel_phone} | {t('common:field.email')}: {hotelSettings.hotel_email}
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
              {t('ledger.invoice.docTitle')}
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
                {t('ledger.invoice.billTo')}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{invoiceCompany.company_name}</Typography>
              {invoiceCompany.registration_number && (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('ledger.invoice.regNo', { number: invoiceCompany.registration_number })}</Typography>
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
                  <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>{t('ledger.invoice.attn')}:</Box>
                  <Box component="span" sx={{ fontWeight: 600 }}>{invoiceCompany.contact_person}</Box>
                </Typography>
              )}
              {invoiceCompany.contact_email && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>{t('common:field.email')}:</Box>
                  <Box component="span">{invoiceCompany.contact_email}</Box>
                </Typography>
              )}
              {invoiceCompany.contact_phone && (
                <Typography variant="body2">
                  <Box component="span" sx={{ color: '#666', minWidth: 60, display: 'inline-block' }}>{t('common:field.phone')}:</Box>
                  <Box component="span">{invoiceCompany.contact_phone}</Box>
                </Typography>
              )}
            </Box>

            {/* Invoice Details */}
            <Box sx={{ minWidth: 220, textAlign: 'right' }}>
              <Typography variant="overline" sx={{ color: '#1976d2', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>
                {t('ledger.invoice.docDetails')}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#666' }}>{t('ledger.field.invoiceDate')}:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{formatDateForDisplay(invoiceDate)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#666' }}>{t('ledger.field.dueDate')}:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{formatDateForDisplay(invoiceDueDate)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: '#666' }}>{t('ledger.invoice.terms')}:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2 }}>{t('ledger.paymentTermsDays', { days: invoiceCompany.payment_terms_days || 30 })}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ color: '#666' }}>{t('common:field.status')}:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, ml: 2, color: isPositiveMoney(getSelectedLedgerBalanceDue()) ? '#d32f2f' : '#2e7d32' }}>
                  {isPositiveMoney(getSelectedLedgerBalanceDue()) ? t('status:ledger.outstanding') : t('status:ledger.settled')}
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
                    {t('common:field.description')}
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    {t('common:field.date')}
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    {t('ledger.field.room')}
                  </TableCell>
                  <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    {t('common:field.amount')}
                  </TableCell>
                  <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    {t('ledger.col.paid')}
                  </TableCell>
                  <TableCell align="right" sx={{ bgcolor: '#1976d2', color: 'white', fontWeight: 700, textTransform: 'uppercase', fontSize: 13 }}>
                    {t('ledger.col.balance')}
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
                    {t('ledger.invoice.subtotal')}:
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
                      {t('ledger.invoice.totalDue')}:
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
              <Typography variant="subtitle2" sx={{ color: '#856404', mb: 0.5 }}>{t('common:field.notes')}:</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: '#856404' }}>
                {invoiceNotes}
              </Typography>
            </Box>
          )}

          {/* Footer */}
          <Box sx={{ mt: 5, pt: 2, borderTop: '1px solid #ddd', textAlign: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#1976d2', mb: 0.5 }}>
              {t('ledger.invoice.thanks')}
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('ledger.invoice.paymentTermsNote', { days: invoiceCompany.payment_terms_days || 30 })}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                mt: 1
              }}>
              {t('ledger.invoice.generated')} | {hotelSettings.hotel_name}
            </Typography>
          </Box>
        </Box>
      )}
    </DialogContent>
    {/* The preview state shows three icon buttons; let the row wrap on
        narrow viewports rather than clip the ms labels. */}
    <DialogActions sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      {!showInvoicePreview ? (
        <>
          <Button onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={onPreview}
            variant="contained"
            disabled={getSelectedInvoiceLedgers().length === 0 || !invoiceNumber}
            startIcon={<InvoiceIcon />}
          >
            {t('ledger.invoice.preview')}
          </Button>
        </>
      ) : (
        <>
          <Button onClick={onBackToEdit}>
            {t('ledger.invoice.backToEdit')}
          </Button>
          <Button
            onClick={onPrint}
            variant="outlined"
            startIcon={<PrintIcon />}
          >
            {t('common:actions.print')}
          </Button>
          <Button
            onClick={onDownload}
            variant="contained"
            startIcon={<DownloadIcon />}
          >
            {t('common:actions.download')}
          </Button>
        </>
      )}
    </DialogActions>
  </Dialog>
  );
};

export default CompanyInvoiceDialog;
