import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Alert,
  CircularProgress,
  MenuItem
} from '@mui/material';
import {
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Assessment as ReportIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { BookingWithDetails } from '../../../types';

const ReportsPage: React.FC = () => {
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [filterType, setFilterType] = useState<'month' | 'date' | 'year'>('month');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get all bookings
      const allBookings = await HotelAPIService.getBookingsWithDetails();

      // Filter based on selected criteria
      const filtered = allBookings.filter(booking => {
        const bookingDate = new Date(booking.check_in_date);

        switch (filterType) {
          case 'year':
            return bookingDate.getFullYear() === selectedYear;
          case 'month':
            return bookingDate.getFullYear() === selectedYear &&
                   bookingDate.getMonth() + 1 === selectedMonth;
          case 'date':
            return booking.check_in_date === selectedDate;
          default:
            return true;
        }
      });

      setBookings(filtered);
    } catch (err) {
      setError('Failed to load report data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (bookings.length === 0) {
      alert('No data to export');
      return;
    }

    // CSV headers
    const headers = [
      'Date',
      'Room',
      'Type',
      'Folio Number',
      'Guest Name',
      'Post Type',
      'Check-In Date',
      'Check-Out Date',
      'Amount',
      'Rate'
    ];

    // CSV rows
    const rows = bookings.map(booking => [
      booking.created_at ? new Date(booking.created_at).toLocaleDateString() : '',
      booking.room_number,
      booking.room_type,
      booking.folio_number || '-',
      booking.guest_name,
      booking.post_type === 'same_day' ? 'Same Day' : 'Normal Stay',
      booking.check_in_date,
      booking.check_out_date,
      `$${typeof booking.total_amount === 'string' ? parseFloat(booking.total_amount).toFixed(2) : booking.total_amount.toFixed(2)}`,
      booking.rate_code || 'RACK'
    ]);

    // Combine headers and rows
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Create and download file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hotel_report_${filterType}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getFilterDescription = () => {
    switch (filterType) {
      case 'year':
        return `Year: ${selectedYear}`;
      case 'month':
        return `${months[selectedMonth - 1]} ${selectedYear}`;
      case 'date':
        return `Date: ${formatDate(selectedDate)}`;
      default:
        return '';
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
          Booking Reports
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Generate and export comprehensive booking reports with filters
        </Typography>
      </Box>

      {/* Filter Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" mb={3}>
            <ReportIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Report Filters
            </Typography>
          </Box>

          <Grid container spacing={3}>
            <Grid item xs={12} md={3}>
              <TextField
                select
                fullWidth
                label="Filter Type"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'month' | 'date' | 'year')}
              >
                <MenuItem value="date">By Date</MenuItem>
                <MenuItem value="month">By Month</MenuItem>
                <MenuItem value="year">By Year</MenuItem>
              </TextField>
            </Grid>

            {filterType === 'year' && (
              <Grid item xs={12} md={3}>
                <TextField
                  select
                  fullWidth
                  label="Year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                >
                  {years.map(year => (
                    <MenuItem key={year} value={year}>{year}</MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}

            {filterType === 'month' && (
              <>
                <Grid item xs={12} md={3}>
                  <TextField
                    select
                    fullWidth
                    label="Month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  >
                    {months.map((month, index) => (
                      <MenuItem key={index} value={index + 1}>{month}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    select
                    fullWidth
                    label="Year"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                  >
                    {years.map(year => (
                      <MenuItem key={year} value={year}>{year}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
              </>
            )}

            {filterType === 'date' && (
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            )}

            <Grid item xs={12} md={filterType === 'date' ? 6 : 3}>
              <Box display="flex" gap={2} height="100%">
                <Button
                  variant="contained"
                  startIcon={<RefreshIcon />}
                  onClick={loadReport}
                  disabled={loading}
                  fullWidth
                  sx={{ height: '56px' }}
                >
                  {loading ? 'Loading...' : 'Generate Report'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={exportToCSV}
                  disabled={bookings.length === 0}
                  fullWidth
                  sx={{ height: '56px' }}
                >
                  Export CSV
                </Button>
              </Box>
            </Grid>
          </Grid>

          {bookings.length > 0 && (
            <Box mt={2}>
              <Alert severity="info">
                <strong>Report Summary:</strong> {getFilterDescription()} - {bookings.length} booking(s) found
              </Alert>
            </Box>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Report Table */}
      {loading ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      ) : bookings.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <ReportIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Bookings Found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Click "Generate Report" to view booking data
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                <TableCell><strong>Date</strong></TableCell>
                <TableCell><strong>Room</strong></TableCell>
                <TableCell><strong>Type</strong></TableCell>
                <TableCell><strong>Folio Number</strong></TableCell>
                <TableCell><strong>Guest Name</strong></TableCell>
                <TableCell><strong>Post Type</strong></TableCell>
                <TableCell><strong>Check-In</strong></TableCell>
                <TableCell><strong>Check-Out</strong></TableCell>
                <TableCell><strong>Amount</strong></TableCell>
                <TableCell><strong>Rate</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {bookings.map((booking) => (
                <TableRow key={booking.id} hover>
                  <TableCell>{booking.created_at ? formatDate(booking.created_at) : '-'}</TableCell>
                  <TableCell>{booking.room_number}</TableCell>
                  <TableCell>{booking.room_type}</TableCell>
                  <TableCell>{booking.folio_number || '-'}</TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{booking.guest_name}</TableCell>
                  <TableCell>
                    {booking.post_type === 'same_day' ? (
                      <Chip label="Same Day" size="small" color="warning" />
                    ) : (
                      <Chip label="Normal Stay" size="small" color="default" />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(booking.check_in_date)}</TableCell>
                  <TableCell>{formatDate(booking.check_out_date)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>
                    ${typeof booking.total_amount === 'string'
                      ? parseFloat(booking.total_amount).toFixed(2)
                      : booking.total_amount.toFixed(2)}
                  </TableCell>
                  <TableCell>{booking.rate_code || 'RACK'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default ReportsPage;
