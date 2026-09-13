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
  DailyOperationsGuestEntry,
  DailyOperationsInHouseEntry,
  RevenueByPaymentStatusStat,
  RevenueBySourceStat,
  RoomPerformanceStat,
  RoomTypePerformanceStat,
  RoomTypeRevenueStat,
  UnderperformingRoomStat,
} from '../../../../types/report.types';

export interface ReportViewProps {
  reportData: any;
  hotelSettings: HotelSettings;
  currencySymbol: string;
  startDate: string;
  endDate: string;
}

export function DailyOperationsReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData) return <Typography>No data available</Typography>;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Daily Operations Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>Date: {reportData.date}</Typography>
      </Box>
      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'var(--hotel-success-bg)' }}>
            <Typography variant="h3" sx={{
              color: "success.main"
            }}>{reportData.arrivals_count || 0}</Typography>
            <Typography variant="subtitle2">Arrivals Today</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'var(--hotel-warning-bg)' }}>
            <Typography variant="h3" sx={{
              color: "warning.main"
            }}>{reportData.departures_count || 0}</Typography>
            <Typography variant="subtitle2">Departures Today</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'var(--hotel-info-bg)' }}>
            <Typography variant="h3" sx={{
              color: "primary.main"
            }}>{reportData.in_house_count || 0}</Typography>
            <Typography variant="subtitle2">In-House Guests</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'var(--hotel-primary-subtle)' }}>
            <Typography variant="h3" sx={{
              color: "secondary.main"
            }}>{reportData.occupancy_rate?.toFixed(1) || 0}%</Typography>
            <Typography variant="subtitle2">Occupancy Rate</Typography>
          </Paper>
        </Grid>
      </Grid>
      {/* Arrivals */}
      <Typography variant="h6" sx={{ bgcolor: 'var(--hotel-success-bg)', color: 'var(--hotel-success)', p: 1, mb: 1 }}>
        Today's Arrivals ({reportData.arrivals?.length || 0})
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell>Booking #</TableCell>
              <TableCell>Guest Name</TableCell>
              <TableCell>Room</TableCell>
              <TableCell>Payment Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.arrivals?.length > 0 ? reportData.arrivals.map((a: DailyOperationsGuestEntry, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{a.booking_number}</TableCell>
                <TableCell>{a.guest_name}</TableCell>
                <TableCell>{a.room_number}</TableCell>
                <TableCell>
                  <Chip label={a.payment_status || 'unpaid'} size="small"
                    color={a.payment_status === 'paid' ? 'success' : 'warning'} />
                </TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={4} align="center">No arrivals today</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {/* Departures */}
      <Typography variant="h6" sx={{ bgcolor: 'var(--hotel-warning-bg)', color: 'var(--hotel-warning)', p: 1, mb: 1 }}>
        Today's Departures ({reportData.departures?.length || 0})
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell>Booking #</TableCell>
              <TableCell>Guest Name</TableCell>
              <TableCell>Room</TableCell>
              <TableCell>Payment Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.departures?.length > 0 ? reportData.departures.map((d: DailyOperationsGuestEntry, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{d.booking_number}</TableCell>
                <TableCell>{d.guest_name}</TableCell>
                <TableCell>{d.room_number}</TableCell>
                <TableCell>
                  <Chip label={d.payment_status || 'unpaid'} size="small"
                    color={d.payment_status === 'paid' ? 'success' : 'error'} />
                </TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={4} align="center">No departures today</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {/* In-House */}
      <Typography variant="h6" sx={{ bgcolor: 'var(--hotel-primary-subtle)', color: 'var(--hotel-primary-text)', p: 1, mb: 1 }}>
        In-House Guests ({reportData.in_house?.length || 0})
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell>Booking #</TableCell>
              <TableCell>Guest Name</TableCell>
              <TableCell>Room</TableCell>
              <TableCell>Check-in</TableCell>
              <TableCell>Check-out</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.in_house?.length > 0 ? reportData.in_house.map((g: DailyOperationsInHouseEntry, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{g.booking_number}</TableCell>
                <TableCell>{g.guest_name}</TableCell>
                <TableCell>{g.room_number}</TableCell>
                <TableCell>{g.check_in_date}</TableCell>
                <TableCell>{g.check_out_date}</TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={5} align="center">No in-house guests</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function OccupancyReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData?.summary) return <Typography>No data available</Typography>;

  const { summary, by_room_type } = reportData;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Occupancy Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {reportData.period?.start} to {reportData.period?.end}
        </Typography>
      </Box>
      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary">{summary.occupancy_rate?.toFixed(1)}%</Typography>
            <Typography variant="caption">Occupancy Rate</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: "success.main"
            }}>{summary.rooms_sold}</Typography>
            <Typography variant="caption">Rooms Sold</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4">{summary.total_rooms}</Typography>
            <Typography variant="caption">Total Rooms</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: "info.main"
            }}>{currencySymbol}{summary.adr?.toFixed(2)}</Typography>
            <Typography variant="caption">ADR</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: "warning.main"
            }}>{currencySymbol}{summary.revpar?.toFixed(2)}</Typography>
            <Typography variant="caption">RevPAR</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: "success.main"
            }}>{currencySymbol}{summary.total_revenue?.toFixed(0)}</Typography>
            <Typography variant="caption">Total Revenue</Typography>
          </Paper>
        </Grid>
      </Grid>
      {/* By Room Type */}
      <Typography variant="h6" gutterBottom>Occupancy by Room Type</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell>Room Type</TableCell>
              <TableCell align="right">Bookings</TableCell>
              <TableCell align="right">Revenue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {by_room_type?.map((rt: RoomTypeRevenueStat, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{rt.room_type}</TableCell>
                <TableCell align="right">{rt.bookings}</TableCell>
                <TableCell align="right">{currencySymbol}{rt.revenue?.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function RevenueReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData) return <Typography>No data available</Typography>;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Revenue Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {reportData.period?.start} to {reportData.period?.end}
        </Typography>
      </Box>
      <Paper sx={{ p: 3, mb: 3, textAlign: 'center', bgcolor: 'var(--hotel-success-bg)' }}>
        <Typography variant="h3" sx={{
          color: "success.main"
        }}>
          {currencySymbol}{reportData.total_revenue?.toFixed(2)}
        </Typography>
        <Typography variant="subtitle1">Total Revenue</Typography>
      </Paper>
      <Grid container spacing={3}>
        {/* By Room Type */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="h6" gutterBottom>By Room Type</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.by_room_type?.map((rt: RoomTypeRevenueStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{rt.room_type}</TableCell>
                    <TableCell align="right">{currencySymbol}{rt.revenue?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        {/* By Source */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="h6" gutterBottom>By Booking Source</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <TableCell>Source</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.by_source?.map((s: RevenueBySourceStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{s.source}</TableCell>
                    <TableCell align="right">{currencySymbol}{s.revenue?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        {/* By Payment Status */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Typography variant="h6" gutterBottom>By Payment Status</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.by_payment_status?.map((ps: RevenueByPaymentStatusStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{ps.payment_status}</TableCell>
                    <TableCell align="right">{currencySymbol}{ps.revenue?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    </Box>
  );
}

export function RoomPerformanceReport({ reportData, hotelSettings, currencySymbol, startDate, endDate }: ReportViewProps) {
  if (!reportData) return <Typography>No data available</Typography>;

  return (
    <Box>
      <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>Room Performance Report</Typography>
        <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {reportData.period?.start} to {reportData.period?.end}
        </Typography>
      </Box>
      <Grid container spacing={3}>
        {/* By Room Type */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="h6" gutterBottom>Performance by Room Type</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <TableCell>Room Type</TableCell>
                  <TableCell align="right">Rooms</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.by_type?.map((rt: RoomTypePerformanceStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{rt.room_type}</TableCell>
                    <TableCell align="right">{rt.room_count}</TableCell>
                    <TableCell align="right">{rt.bookings}</TableCell>
                    <TableCell align="right">{currencySymbol}{rt.revenue?.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>

        {/* Underperforming */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="h6" gutterBottom sx={{
            color: "warning.main"
          }}>Underperforming Rooms</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'var(--hotel-warning-bg)' }}>
                  <TableCell>Room #</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.underperforming?.length > 0 ? reportData.underperforming.map((r: UnderperformingRoomStat, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{r.room_number}</TableCell>
                    <TableCell>{r.room_type}</TableCell>
                    <TableCell align="right">{r.bookings}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={3} align="center">All rooms performing well</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
      {/* By Room */}
      <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>All Rooms Performance</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell>Room #</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Bookings</TableCell>
              <TableCell align="right">Revenue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reportData.by_room?.map((r: RoomPerformanceStat, idx: number) => (
              <TableRow key={idx}>
                <TableCell>{r.room_number}</TableCell>
                <TableCell>{r.room_type}</TableCell>
                <TableCell align="right">{r.bookings}</TableCell>
                <TableCell align="right">{currencySymbol}{r.revenue?.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
