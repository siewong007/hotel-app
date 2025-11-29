import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  Hotel as HotelIcon,
  MonetizationOn as MoneyIcon,
  BarChart as ChartIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';

interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string[];
    borderColor?: string;
    borderWidth?: number;
  }>;
}

interface OccupancyReport {
  totalRooms: number;
  occupiedRooms: number;
  occupancyRate: number;
  availableRooms: number;
  utilization: number;
  revenue: number;
}

interface BookingAnalytics {
  totalBookings: number;
  averageBookingValue: number;
  totalRevenue: number;
  bookingsByRoomType: Record<string, number>;
  peakBookingHours: number[];
  monthlyTrends: Array<{ month: string; bookings: number; revenue: number }>;
}

const SimpleChart: React.FC<{ data: ChartData; type: 'bar' | 'line' | 'pie' }> = ({ data, type }) => {
  // Simple SVG-based chart since we don't have Chart.js in this demo
  return (
    <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', borderRadius: 1 }}>
      <Box textAlign="center">
        <ChartIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" color="text.secondary">
          Chart Preview
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {type.toUpperCase()} Chart
        </Typography>
        <Box mt={2}>
          <Typography variant="body2" fontFamily="monospace">
            Labels: {data.labels.slice(0, 3).join(', ')}...
          </Typography>
          <Typography variant="body2" fontFamily="monospace">
            Data: {data.datasets[0]?.data.slice(0, 3).join(', ')}...
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

const AnalyticsDashboard: React.FC = () => {
  const [occupancyReport, setOccupancyReport] = useState<OccupancyReport | null>(null);
  const [bookingAnalytics, setBookingAnalytics] = useState<BookingAnalytics | null>(null);
  const [occupancyChart, setOccupancyChart] = useState<ChartData | null>(null);
  const [revenueChart, setRevenueChart] = useState<ChartData | null>(null);
  const [roomTypeChart, setRoomTypeChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load analytics data from backend API (which uses MCP-compatible analytics logic)
    loadAnalyticsData();
  }, []);

  const loadAnalyticsData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Call real analytics endpoints (backed by MCP-compatible logic)
      const [occupancyData, analyticsData] = await Promise.all([
        HotelAPIService.getOccupancyReport(),
        HotelAPIService.getBookingAnalytics()
      ]);

      // Convert to expected format
      const occupancy: OccupancyReport = {
        totalRooms: occupancyData.totalRooms || 0,
        occupiedRooms: occupancyData.occupiedRooms || 0,
        occupancyRate: occupancyData.occupancyRate || 0,
        availableRooms: occupancyData.availableRooms || 0,
        utilization: occupancyData.utilization || 0,
        revenue: occupancyData.revenue || 0
      };

      const analytics: BookingAnalytics = {
        totalBookings: analyticsData.totalBookings || 0,
        averageBookingValue: analyticsData.averageBookingValue || 0,
        totalRevenue: analyticsData.totalRevenue || 0,
        bookingsByRoomType: analyticsData.bookingsByRoomType || {},
        peakBookingHours: analyticsData.peakBookingHours || [9, 10, 11, 14, 15, 16],
        monthlyTrends: analyticsData.monthlyTrends || []
      };

      // Generate chart data
      const occupancyChartData: ChartData = {
        labels: ['Occupied', 'Available'],
        datasets: [{
          label: 'Room Status',
          data: [occupancy.occupiedRooms, occupancy.availableRooms],
          backgroundColor: ['#f44336', '#4caf50'],
          borderWidth: 1
        }]
      };

      const revenueChartData: ChartData = {
        labels: analytics.monthlyTrends.map(t => t.month) || ['Current Month'],
        datasets: [{
          label: 'Revenue ($)',
          data: analytics.monthlyTrends.map(t => t.revenue) || [analytics.totalRevenue],
          borderColor: '#2196f3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          borderWidth: 2
        }]
      };

      const roomTypeChartData: ChartData = {
        labels: Object.keys(analytics.bookingsByRoomType),
        datasets: [{
          label: 'Bookings by Room Type',
          data: Object.values(analytics.bookingsByRoomType) as number[],
          backgroundColor: ['#2196f3', '#4caf50', '#ff9800', '#f44336', '#9c27b0'].slice(0, Object.keys(analytics.bookingsByRoomType).length),
          borderWidth: 1
        }]
      };

      setOccupancyReport(occupancy);
      setBookingAnalytics(analytics);
      setOccupancyChart(occupancyChartData);
      setRevenueChart(revenueChartData);
      setRoomTypeChart(roomTypeChartData);

    } catch (err: any) {
      console.error('Failed to load analytics data:', err);
      setError(err.response?.data?.error || 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
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
      <Box display="flex" alignItems="center" mb={3}>
        <TrendingUpIcon sx={{ mr: 2, fontSize: 32 }} />
        <Typography variant="h4" component="h1">
          Analytics Dashboard
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* KPI Cards */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <HotelIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6">Occupancy Rate</Typography>
              </Box>
              <Typography variant="h3" color="primary">
                {occupancyReport?.occupancyRate.toFixed(1)}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {occupancyReport?.occupiedRooms}/{occupancyReport?.totalRooms} rooms occupied
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <MoneyIcon color="success" sx={{ mr: 1 }} />
                <Typography variant="h6">Total Revenue</Typography>
              </Box>
              <Typography variant="h3" color="success.main">
                ${bookingAnalytics?.totalRevenue.toLocaleString()}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                From {bookingAnalytics?.totalBookings} bookings
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <ChartIcon color="secondary" sx={{ mr: 1 }} />
                <Typography variant="h6">Avg Booking Value</Typography>
              </Box>
              <Typography variant="h3" color="secondary.main">
                ${bookingAnalytics?.averageBookingValue.toFixed(0)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Per booking average
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={1}>
                <HotelIcon color="warning" sx={{ mr: 1 }} />
                <Typography variant="h6">Available Rooms</Typography>
              </Box>
              <Typography variant="h3" color="warning.main">
                {occupancyReport?.availableRooms}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Ready for booking
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts Section */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Room Occupancy Distribution
              </Typography>
              {occupancyChart && <SimpleChart data={occupancyChart} type="pie" />}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Revenue Trends
              </Typography>
              {revenueChart && <SimpleChart data={revenueChart} type="line" />}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Bookings by Room Type
              </Typography>
              {roomTypeChart && <SimpleChart data={roomTypeChart} type="bar" />}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Room Type Performance */}
      {bookingAnalytics && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Room Type Performance
            </Typography>
            <Box display="flex" gap={1} flexWrap="wrap">
              {Object.entries(bookingAnalytics.bookingsByRoomType).map(([type, count]) => (
                <Chip
                  key={type}
                  label={`${type}: ${count} bookings`}
                  color="primary"
                  variant="outlined"
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Performance Insights */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Performance Insights
          </Typography>
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              • <strong>Occupancy Rate:</strong> {occupancyReport?.occupancyRate.toFixed(1)}% - Target: 78.5%
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              • <strong>Revenue Performance:</strong> ${bookingAnalytics?.totalRevenue} generated this period
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              • <strong>Peak Hours:</strong> Bookings most active during {bookingAnalytics?.peakBookingHours.join(', ')}
            </Typography>
            <Typography variant="body2">
              • <strong>Recommendation:</strong> Focus on increasing occupancy rate through targeted marketing
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default AnalyticsDashboard;
