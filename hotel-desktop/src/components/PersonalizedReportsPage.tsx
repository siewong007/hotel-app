import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip
} from '@mui/material';
import {
  Person as PersonIcon,
  Assessment as ReportIcon,
  TrendingUp as TrendingUpIcon,
  CalendarToday as CalendarIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { useAuth } from '../auth/AuthContext';

interface PersonalizedReport {
  reportScope: string;
  userRoles: string[];
  period: string;
  summary: {
    totalRooms: number;
    occupiedRooms: number;
    occupancyRate: number;
    totalBookings: number;
    totalRevenue: number;
    averageBookingValue: number;
  };
  recentBookings: Array<{
    id: number;
    guest_name: string;
    room_number: string;
    room_type: string;
    check_in: string;
    check_out: string;
    total_price: string;
    status: string;
  }>;
  insights: string[];
  generatedAt: string;
}

const PersonalizedReportsPage: React.FC = () => {
  const { user } = useAuth();
  const [report, setReport] = useState<PersonalizedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('month');

  useEffect(() => {
    loadReport();
  }, [period]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await HotelAPIService.getPersonalizedReport(period);
      setReport(data);
    } catch (err: any) {
      console.error('Failed to load personalized report:', err);
      setError(err.response?.data?.error || 'Failed to load personalized report');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center">
          <PersonIcon sx={{ mr: 2, fontSize: 32 }} />
          <Typography variant="h4" component="h1">
            Personalized Report
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Period</InputLabel>
          <Select
            value={period}
            label="Period"
            onChange={(e) => setPeriod(e.target.value)}
          >
            <MenuItem value="week">Last Week</MenuItem>
            <MenuItem value="month">Last Month</MenuItem>
            <MenuItem value="year">Last Year</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {report && (
        <>
          {/* User Context */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <PersonIcon sx={{ mr: 1 }} />
                <Typography variant="h6">Report Context</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Report Scope: <strong>{report.reportScope === 'all' ? 'System-wide' : 'Personal'}</strong>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Your Roles: {report.userRoles.map(role => (
                      <Chip key={role} label={role} size="small" sx={{ ml: 0.5 }} />
                    ))}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" color="text.secondary">
                    Generated: {formatDate(report.generatedAt)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Period: {period.charAt(0).toUpperCase() + period.slice(1)}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <Grid container spacing={3} mb={3}>
            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <ReportIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="h6">Total Bookings</Typography>
                  </Box>
                  <Typography variant="h3" color="primary">
                    {report.summary.totalBookings}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {report.reportScope === 'all' ? 'System-wide' : 'Your bookings'}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <TrendingUpIcon color="success" sx={{ mr: 1 }} />
                    <Typography variant="h6">Total Revenue</Typography>
                  </Box>
                  <Typography variant="h3" color="success.main">
                    {formatCurrency(report.summary.totalRevenue)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {report.reportScope === 'all' ? 'All revenue' : 'Your generated revenue'}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <ReportIcon color="secondary" sx={{ mr: 1 }} />
                    <Typography variant="h6">Avg Booking</Typography>
                  </Box>
                  <Typography variant="h3" color="secondary.main">
                    {formatCurrency(report.summary.averageBookingValue)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Average booking value
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <CalendarIcon color="warning" sx={{ mr: 1 }} />
                    <Typography variant="h6">Occupancy</Typography>
                  </Box>
                  <Typography variant="h3" color="warning.main">
                    {report.summary.occupancyRate.toFixed(1)}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {report.summary.occupiedRooms}/{report.summary.totalRooms} rooms
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Insights */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Key Insights
              </Typography>
              {report.insights.map((insight, index) => (
                <Alert key={index} severity="info" sx={{ mb: 1 }}>
                  {insight}
                </Alert>
              ))}
            </CardContent>
          </Card>

          {/* Recent Bookings */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Bookings
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Guest</TableCell>
                      <TableCell>Room</TableCell>
                      <TableCell>Check-in</TableCell>
                      <TableCell>Check-out</TableCell>
                      <TableCell align="right">Total Price</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.recentBookings.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          No bookings found
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.recentBookings.map((booking) => (
                        <TableRow key={booking.id}>
                          <TableCell>{booking.guest_name}</TableCell>
                          <TableCell>
                            {booking.room_number} ({booking.room_type})
                          </TableCell>
                          <TableCell>{formatDate(booking.check_in)}</TableCell>
                          <TableCell>{formatDate(booking.check_out)}</TableCell>
                          <TableCell align="right">
                            {formatCurrency(parseFloat(booking.total_price))}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={booking.status}
                              size="small"
                              color={
                                booking.status === 'confirmed' ? 'success' :
                                booking.status === 'checked_in' ? 'primary' :
                                booking.status === 'cancelled' ? 'error' : 'default'
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          {/* Refresh Button */}
          <Box mt={3} display="flex" justifyContent="center">
            <Button
              variant="contained"
              onClick={loadReport}
              startIcon={<ReportIcon />}
            >
              Refresh Report
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
};

export default PersonalizedReportsPage;

