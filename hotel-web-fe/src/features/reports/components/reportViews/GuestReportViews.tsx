import {
  Box,
  Typography,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import type { HotelSettings } from '../../../../utils/hotelSettings';
import type {
  ComplimentaryBooking,
  NationalityStat,
  OtaStatement,
  OtaStatementRow,
  OverduePayment,
  PaymentStatusBreakdown,
  TopGuestStat,
} from '../../../../types/report.types';

export interface ReportViewProps {
  reportData: any;
  hotelSettings: HotelSettings;
  currencySymbol: string;
  startDate: string;
  endDate: string;
}

export function OtaMonthlyStatementReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  const formatMoney = (value: unknown) => `${currencySymbol}${Number(value || 0).toFixed(2)}`;
  if (!reportData) return <Typography>No data available</Typography>;

  const statements = reportData.statements || [];

  return (
    <Box>
      {statements.length > 0 ? statements.map((statement: OtaStatement) => {
        const commissionLabel = statement.commission_type === 'percentage'
          ? `Comm(${Number(statement.commission_value || 0).toFixed(2)}%)`
          : 'Comm';

        return (
          <Box key={`${statement.channel_id || statement.platform}`} className="ota-statement-page" sx={{ mb: 4 }}>
            <Box className="header" sx={{ textAlign: 'center', mb: 2 }}>
              <Typography variant="h5" sx={{
                fontWeight: "bold"
              }}>{hotelSettings.hotel_name}</Typography>
              <Typography variant="subtitle1">Statement Date: {reportData.statement_date}</Typography>
              <Typography variant="h6">{statement.platform} - {reportData.period?.month_label}</Typography>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell>Ref No</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="right">{commissionLabel}</TableCell>
                    <TableCell align="right">Tax</TableCell>
                    <TableCell align="right">Amount Paid</TableCell>
                    <TableCell>Check in date</TableCell>
                    <TableCell>Check out date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {statement.rows.map((row: OtaStatementRow) => (
                    <TableRow key={`${statement.platform}-${row.booking_id}`}>
                      <TableCell>{row.ref_no}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell align="right">{formatMoney(row.amount)}</TableCell>
                      <TableCell align="right">{formatMoney(row.commission)}</TableCell>
                      <TableCell align="right">{formatMoney(row.tax)}</TableCell>
                      <TableCell align="right">{formatMoney(row.amount_paid)}</TableCell>
                      <TableCell>{row.check_in_date}</TableCell>
                      <TableCell>{row.check_out_date}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell colSpan={2} sx={{ fontWeight: 700 }}>Total</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatMoney(statement.totals?.amount)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatMoney(statement.totals?.commission)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatMoney(statement.totals?.tax)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{formatMoney(statement.totals?.amount_paid)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        );
      }) : (
        <Box className="header" sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h5" sx={{
            fontWeight: "bold"
          }}>OTA Monthly Statement</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            No statement rows found for {reportData.period?.month_label || 'this month'}.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export function PaymentStatusReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData) return <Typography>No data available</Typography>;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Payment Status Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {reportData.period?.start} to {reportData.period?.end}
        </Typography>
      </Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={6}>
          <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#ffebee' }}>
            <Typography variant="h3" sx={{
              color: "error.main"
            }}>
              {currencySymbol}{reportData.outstanding_balance?.toFixed(2)}
            </Typography>
            <Typography variant="subtitle1">Outstanding Balance</Typography>
          </Paper>
        </Grid>
        <Grid size={6}>
          <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#fff3e0' }}>
            <Typography variant="h3" sx={{
              color: "warning.main"
            }}>{reportData.overdue_count || 0}</Typography>
            <Typography variant="subtitle1">Overdue Payments</Typography>
          </Paper>
        </Grid>
      </Grid>
      {/* By Status */}
      <Typography variant="h6" gutterBottom>Breakdown by Status</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell>Payment Status</TableCell>
              <TableCell align="right">Count</TableCell>
              <TableCell align="right">Total Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.by_status?.map((s: PaymentStatusBreakdown, idx: number) => (
              <TableRow key={idx}>
                <TableCell>
                  <Chip label={s.payment_status} size="small"
                    color={s.payment_status === 'paid' ? 'success' : s.payment_status === 'unpaid' ? 'error' : 'warning'} />
                </TableCell>
                <TableCell align="right">{s.count}</TableCell>
                <TableCell align="right">{currencySymbol}{s.total_amount?.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {/* Overdue */}
      {reportData.overdue?.length > 0 && (
        <>
          <Typography variant="h6" gutterBottom color="error">Overdue Payments</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#ffebee' }}>
                  <TableCell>Booking #</TableCell>
                  <TableCell>Guest</TableCell>
                  <TableCell>Room</TableCell>
                  <TableCell>Check-out</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.overdue.map((o: OverduePayment, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{o.booking_number}</TableCell>
                    <TableCell>{o.guest_name}</TableCell>
                    <TableCell>{o.room_number}</TableCell>
                    <TableCell>{o.check_out_date}</TableCell>
                    <TableCell align="right">{currencySymbol}{o.total_amount?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}

export function ComplimentaryReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData) return <Typography>No data available</Typography>;

  const { summary } = reportData;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Complimentary Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {reportData.period?.start} to {reportData.period?.end}
        </Typography>
      </Box>
      {/* Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4">{summary?.total_bookings || 0}</Typography>
            <Typography variant="caption">Total Bookings</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="secondary">{summary?.total_complimentary_nights || 0}</Typography>
            <Typography variant="caption">Comp. Nights</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: "info.main"
            }}>{summary?.partial_complimentary || 0}</Typography>
            <Typography variant="caption">Partial Comp.</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: "success.main"
            }}>{summary?.fully_complimentary || 0}</Typography>
            <Typography variant="caption">Fully Comp.</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#fff3e0' }}>
            <Typography variant="h5" sx={{
              color: "warning.main"
            }}>{currencySymbol}{summary?.discount_given?.toFixed(0) || 0}</Typography>
            <Typography variant="caption">Discount Given</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e8f5e9' }}>
            <Typography variant="h5" sx={{
              color: "success.main"
            }}>{currencySymbol}{summary?.actual_revenue?.toFixed(0) || 0}</Typography>
            <Typography variant="caption">Actual Revenue</Typography>
          </Paper>
        </Grid>
      </Grid>
      {/* Bookings */}
      <Typography variant="h6" gutterBottom>Complimentary Bookings</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell>Booking #</TableCell>
              <TableCell>Guest</TableCell>
              <TableCell>Room</TableCell>
              <TableCell>Nights</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell align="right">Original</TableCell>
              <TableCell align="right">Actual</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.bookings?.length > 0 ? reportData.bookings.map((b: ComplimentaryBooking, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{b.booking_number}</TableCell>
                <TableCell>{b.guest_name}</TableCell>
                <TableCell>{b.room_number}</TableCell>
                <TableCell>{b.complimentary_nights || '-'}</TableCell>
                <TableCell>{b.complimentary_reason || '-'}</TableCell>
                <TableCell align="right">{currencySymbol}{b.original_amount?.toFixed(2)}</TableCell>
                <TableCell align="right">{currencySymbol}{b.actual_amount?.toFixed(2)}</TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={7} align="center">No complimentary bookings</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function GuestStatisticsReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData?.summary) return <Typography>No data available</Typography>;

  const { summary } = reportData;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Guest Statistics</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {reportData.period?.start} to {reportData.period?.end}
        </Typography>
      </Box>
      {/* Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary">{summary.unique_guests}</Typography>
            <Typography variant="caption">Unique Guests</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e8f5e9' }}>
            <Typography variant="h4" sx={{
              color: "success.main"
            }}>{summary.new_guests}</Typography>
            <Typography variant="caption">New Guests</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e3f2fd' }}>
            <Typography variant="h4" sx={{
              color: "info.main"
            }}>{summary.returning_guests}</Typography>
            <Typography variant="caption">Returning</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4">{summary.tourists}</Typography>
            <Typography variant="caption">Tourists</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4">{summary.non_tourists}</Typography>
            <Typography variant="caption">Non-Tourists</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4">{summary.average_stay_nights?.toFixed(1)}</Typography>
            <Typography variant="caption">Avg Stay (nights)</Typography>
          </Paper>
        </Grid>
      </Grid>
      <Grid container spacing={3}>
        {/* Top Guests */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="h6" gutterBottom>Top Guests by Bookings</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell>Guest Name</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Total Spent</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.top_guests?.map((g: TopGuestStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{g.name}</TableCell>
                    <TableCell align="right">{g.bookings}</TableCell>
                    <TableCell align="right">{currencySymbol}{g.total_spent?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        {/* By Nationality */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="h6" gutterBottom>By Nationality</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell>Nationality</TableCell>
                  <TableCell align="right">Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.by_nationality?.length > 0 ? reportData.by_nationality.map((n: NationalityStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{n.nationality}</TableCell>
                    <TableCell align="right">{n.count}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={2} align="center">No nationality data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    </Box>
  );
}
