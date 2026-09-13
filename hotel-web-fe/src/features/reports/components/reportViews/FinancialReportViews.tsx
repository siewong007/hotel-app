import {
  Box,
  Typography,
  Card,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Divider,
  Chip,
} from '@mui/material';
import { formatStatusLabel } from '../../../../utils/formatters';
import type { HotelSettings } from '../../../../utils/hotelSettings';
import type {
  BalanceSheetAccount,
  CompanyLedgerTransaction,
  GeneralJournalEntry,
  GeneralJournalSection,
  RoomsSoldBooking,
  ShiftReportPayment,
  ShiftReportPaymentMethodSummary,
} from '../../../../types/report.types';

export interface ReportViewProps {
  reportData: any;
  hotelSettings: HotelSettings;
  currencySymbol: string;
  startDate: string;
  endDate: string;
}

export function GeneralJournalReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData?.sections) return <Typography>No data available</Typography>;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Guest Ledger</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {new Date(startDate).toLocaleDateString()} to {new Date(endDate).toLocaleDateString()}
        </Typography>
      </Box>
      {reportData.sections.map((section: GeneralJournalSection, idx: number) => (
        <Box key={idx} sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ bgcolor: 'grey.200', p: 1 }}>{section.name}</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Date</strong></TableCell>
                  <TableCell><strong>Room</strong></TableCell>
                  <TableCell><strong>Account</strong></TableCell>
                  <TableCell align="right"><strong>Debit</strong></TableCell>
                  <TableCell align="right"><strong>Credit</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {section.entries?.map((entry: GeneralJournalEntry, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{entry.date}</TableCell>
                    <TableCell>{entry.room_number || '-'}</TableCell>
                    <TableCell>{entry.account}</TableCell>
                    <TableCell align="right">
                      {Number(entry.debit) > 0 ? `${currencySymbol}${Number(entry.debit).toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell align="right">
                      {Number(entry.credit) > 0
                        ? `${currencySymbol}${Number(entry.credit).toFixed(2)}`
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell colSpan={3}><strong>Total</strong></TableCell>
                  <TableCell align="right"><strong>{currencySymbol}{Number(section.total_debit || 0).toFixed(2)}</strong></TableCell>
                  <TableCell align="right"><strong>{currencySymbol}{Number(section.total_credit || 0).toFixed(2)}</strong></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ))}
      <Divider sx={{ my: 2 }} />
      <Typography variant="h6" align="right">
        Balance: {currencySymbol}{Number(reportData.balance || 0).toFixed(2)}
      </Typography>
    </Box>
  );
}

export function CompanyLedgerStatementReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData || reportData.type !== 'company_statement') {
    return <Typography>No data available</Typography>;
  }

  const { company, statement_date, balance_due, last_payment, aging, transactions, totals } = reportData;

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={6}>
          <Typography variant="h4" sx={{
            fontWeight: "bold"
          }}>{hotelSettings.hotel_name}</Typography>
          <Typography variant="body2">{hotelSettings.hotel_address}</Typography>
        </Grid>
        <Grid sx={{ textAlign: 'right' }} size={6}>
          <Typography variant="h4" sx={{
            fontWeight: "bold"
          }}>Account Statement</Typography>
          <Typography variant="body2">Date: {statement_date}</Typography>
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{
              color: "text.secondary"
            }}>Bill To:</Typography>
            <Typography variant="h6" sx={{
              fontWeight: "bold"
            }}>{company?.name}</Typography>
            {company?.contact_person && <Typography>Attn: {company.contact_person}</Typography>}
            {company?.address?.line1 && <Typography variant="body2">{company.address.line1}</Typography>}
          </Paper>
        </Grid>
        <Grid size={6}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography><strong>Balance Due:</strong> {currencySymbol}{Number(balance_due || 0).toFixed(2)}</Typography>
            <Typography><strong>Last Payment:</strong> {last_payment?.date || 'N/A'}</Typography>
          </Paper>
        </Grid>
      </Grid>
      <Typography variant="h6" gutterBottom>Aging Summary</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'white' }} align="center">Current</TableCell>
              <TableCell sx={{ color: 'white' }} align="center">31-60 Days</TableCell>
              <TableCell sx={{ color: 'white' }} align="center">61-90 Days</TableCell>
              <TableCell sx={{ color: 'white' }} align="center">91-120 Days</TableCell>
              <TableCell sx={{ color: 'white' }} align="center">Over 120 Days</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell align="center">{currencySymbol}{Number(aging?.open_balance || 0).toFixed(2)}</TableCell>
              <TableCell align="center">{currencySymbol}{Number(aging?.days_31_60 || 0).toFixed(2)}</TableCell>
              <TableCell align="center">{currencySymbol}{Number(aging?.days_61_90 || 0).toFixed(2)}</TableCell>
              <TableCell align="center">{currencySymbol}{Number(aging?.days_91_120 || 0).toFixed(2)}</TableCell>
              <TableCell align="center">{currencySymbol}{Number(aging?.over_120_days || 0).toFixed(2)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="h6" gutterBottom>Transactions</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell>Date</TableCell>
              <TableCell>Check-in</TableCell>
              <TableCell>Check-out</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Invoice</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Paid</TableCell>
              <TableCell align="right">Balance</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions?.map((txn: CompanyLedgerTransaction, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{txn.invoice_date || '-'}</TableCell>
                <TableCell>{txn.check_in_date || '-'}</TableCell>
                <TableCell>{txn.check_out_date || '-'}</TableCell>
                <TableCell>{txn.voucher}</TableCell>
                <TableCell>{txn.invoice || '-'}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(txn.original_amount || 0).toFixed(2)}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(txn.payments_received || 0).toFixed(2)}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(txn.open_amount || 0).toFixed(2)}</TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ bgcolor: 'grey.200' }}>
              <TableCell colSpan={5}><strong>Total</strong></TableCell>
              <TableCell align="right"><strong>{currencySymbol}{Number(totals?.original_amount || 0).toFixed(2)}</strong></TableCell>
              <TableCell align="right"><strong>{currencySymbol}{Number(totals?.payments_received || 0).toFixed(2)}</strong></TableCell>
              <TableCell align="right"><strong>{currencySymbol}{Number(totals?.open_amount || 0).toFixed(2)}</strong></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function BalanceSheetReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData?.accounts) return <Typography>No data available</Typography>;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Balance Sheet</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2">As of {new Date(endDate).toLocaleDateString()}</Typography>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell><strong>Account</strong></TableCell>
              <TableCell align="right"><strong>Debit</strong></TableCell>
              <TableCell align="right"><strong>Credit</strong></TableCell>
              <TableCell align="right"><strong>Balance</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.accounts.map((acc: BalanceSheetAccount, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{acc.account_name || acc.name}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(acc.debit || 0).toFixed(2)}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(acc.credit || 0).toFixed(2)}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(acc.balance || 0).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function ShiftReportView({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData) return <Typography>No data available</Typography>;

  const { period, payments, summary, by_payment_method } = reportData;

  // Format payment method for display
  const formatPaymentMethod = (method: string) => {
    const methods: Record<string, string> = {
      'cash': 'Cash',
      'card': 'Card',
      'bank_transfer': 'Bank Transfer',
      'e_wallet': 'E-Wallet',
      'company_bill': 'Company Bill',
    };
    return methods[method] || formatStatusLabel(method);
  };

  // Format source for display
  const formatSource = (source: string) => {
    const sources: Record<string, string> = {
      'walk_in': 'Walk-in',
      'booking_com': 'Booking.com',
      'agoda': 'Agoda',
      'expedia': 'Expedia',
      'direct': 'Direct',
      'phone': 'Phone',
      'online': 'Online',
    };
    return sources[source] || formatStatusLabel(source);
  };

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Payment Records Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {period?.start} to {period?.end}
        </Typography>
      </Box>
      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e3f2fd' }}>
            <Typography variant="h3" sx={{
              color: "primary.main"
            }}>{summary?.total_bookings || 0}</Typography>
            <Typography variant="subtitle2">Total Bookings</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e8f5e9' }}>
            <Typography variant="h4" sx={{
              color: "success.main"
            }}>
              {currencySymbol}{Number(summary?.total_revenue || 0).toFixed(2)}
            </Typography>
            <Typography variant="subtitle2">Total Revenue</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#fff3e0' }}>
            <Typography variant="h4" sx={{
              color: "warning.main"
            }}>
              {currencySymbol}{Number(summary?.total_deposits || 0).toFixed(2)}
            </Typography>
            <Typography variant="subtitle2">Deposits Collected</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#f3e5f5' }}>
            <Typography variant="h4" sx={{
              color: "secondary.main"
            }}>
              {by_payment_method?.length || 0}
            </Typography>
            <Typography variant="subtitle2">Payment Methods</Typography>
          </Paper>
        </Grid>
      </Grid>
      {/* Payment Method Summary */}
      {by_payment_method && by_payment_method.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ bgcolor: 'info.main', color: 'white', p: 1, mb: 1 }}>
            Summary by Payment Method
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell><strong>Payment Method</strong></TableCell>
                  <TableCell align="center"><strong>Count</strong></TableCell>
                  <TableCell align="right"><strong>Amount</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {by_payment_method.map((pm: ShiftReportPaymentMethodSummary, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{formatPaymentMethod(pm.method)}</TableCell>
                    <TableCell align="center">{pm.count}</TableCell>
                    <TableCell align="right">{currencySymbol}{Number(pm.amount || 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
      {/* Detailed Payment Records */}
      <Typography variant="h6" sx={{ bgcolor: 'primary.main', color: 'white', p: 1, mb: 1 }}>
        Payment Records ({payments?.length || 0})
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell><strong>Date</strong></TableCell>
              <TableCell><strong>Booking #</strong></TableCell>
              <TableCell><strong>Guest</strong></TableCell>
              <TableCell><strong>Room</strong></TableCell>
              <TableCell><strong>Source</strong></TableCell>
              <TableCell><strong>Payment</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell align="right"><strong>Amount</strong></TableCell>
              <TableCell align="right"><strong>Deposit</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payments && payments.length > 0 ? payments.map((p: ShiftReportPayment, idx: number) => (
              <TableRow key={idx} sx={{ '&:nth-of-type(odd)': { bgcolor: 'grey.50' } }}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.booking_number}</TableCell>
                <TableCell>{p.guest_name}</TableCell>
                <TableCell>
                  {p.room_number}
                  {p.room_type && <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "text.secondary"
                    }}>{p.room_type}</Typography>}
                </TableCell>
                <TableCell>{formatSource(p.source)}</TableCell>
                <TableCell>{formatPaymentMethod(p.payment_method)}</TableCell>
                <TableCell>
                  <Chip
                    label={p.payment_status}
                    size="small"
                    color={p.payment_status === 'paid' ? 'success' : p.payment_status === 'partial' ? 'warning' : 'error'}
                  />
                </TableCell>
                <TableCell align="right">{currencySymbol}{Number(p.amount || 0).toFixed(2)}</TableCell>
                <TableCell align="right">
                  {p.deposit_paid ? (
                    <Typography sx={{
                      color: "success.main"
                    }}>{currencySymbol}{Number(p.deposit_amount || 0).toFixed(2)}</Typography>
                  ) : (
                    <Typography sx={{
                      color: "text.secondary"
                    }}>-</Typography>
                  )}
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={9} align="center">No payment records found for this period</TableCell>
              </TableRow>
            )}
            {/* Totals Row */}
            {payments && payments.length > 0 && (
              <TableRow sx={{ bgcolor: 'grey.200' }}>
                <TableCell colSpan={7}><strong>TOTAL</strong></TableCell>
                <TableCell align="right">
                  <strong>{currencySymbol}{Number(summary?.total_revenue || 0).toFixed(2)}</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>{currencySymbol}{Number(summary?.total_deposits || 0).toFixed(2)}</strong>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function RoomsSoldReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData?.bookings) return <Typography>No data available</Typography>;

  // Helper to format date or return '-' for null/undefined
  const formatDate = (date: string | null | undefined) => {
    if (!date) return '-';
    try {
      return new Date(date).toLocaleDateString();
    } catch {
      return '-';
    }
  };

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Rooms Sold Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2">
          {new Date(startDate).toLocaleDateString()} to {new Date(endDate).toLocaleDateString()}
        </Typography>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell>Folio</TableCell>
              <TableCell>Room</TableCell>
              <TableCell>Room Type</TableCell>
              <TableCell>Guest</TableCell>
              <TableCell>Check In</TableCell>
              <TableCell>Check Out</TableCell>
              <TableCell>Rate Plan</TableCell>
              <TableCell align="center">Adults</TableCell>
              <TableCell align="center">Children</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.bookings.map((b: RoomsSoldBooking, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{b.folio || '-'}</TableCell>
                <TableCell>{b.room_number || '-'}</TableCell>
                <TableCell>{b.room_type || '-'}</TableCell>
                <TableCell>{b.guest_name || '-'}</TableCell>
                <TableCell>{formatDate(b.check_in_date)}</TableCell>
                <TableCell>{formatDate(b.check_out_date)}</TableCell>
                <TableCell>{b.rate_plan || '-'}</TableCell>
                <TableCell align="center">{b.adult_count ?? '-'}</TableCell>
                <TableCell align="center">{b.child_count ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="h6" sx={{ mt: 2 }} align="right">
        Total Rooms Sold: {reportData.total_rooms || reportData.bookings.length}
      </Typography>
    </Box>
  );
}
