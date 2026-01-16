import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  LinearProgress,
  Chip,
  Paper,
} from '@mui/material';
import {
  TrendingUp,
  People,
  Hotel,
  AttachMoney,
  CheckCircle,
  Schedule,
  Assessment,
  Star,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { formatCurrency, formatCurrencyCustom } from '../../../utils/currency';

interface DashboardStats {
  totalRooms: number;
  availableRooms: number;
  occupiedRooms: number;
  occupancyRate: number;
  totalGuests: number;
  activeBookings: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  monthlyRevenue: number;
  weeklyRevenue: number;
  averageBookingValue: number;
  totalRevenue: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: {
    value: number;
    label: string;
  };
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color, trend }) => (
  <Card sx={{ height: '100%', position: 'relative', overflow: 'visible' }}>
    <CardContent>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography color="text.secondary" gutterBottom variant="body2">
            {title}
          </Typography>
          <Typography variant="h4" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
          {trend && (
            <Box display="flex" alignItems="center" mt={1}>
              <TrendingUp
                fontSize="small"
                sx={{
                  color: trend.value >= 0 ? 'success.main' : 'error.main',
                  mr: 0.5,
                  transform: trend.value < 0 ? 'rotate(180deg)' : 'none'
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  color: trend.value >= 0 ? 'success.main' : 'error.main',
                  fontWeight: 600
                }}
              >
                {Math.abs(trend.value)}% {trend.label}
              </Typography>
            </Box>
          )}
        </Box>
        <Box
          sx={{
            backgroundColor: color,
            borderRadius: 2,
            p: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const AdminOverviewDashboard: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all required data in parallel
      const [rooms, guests, bookings] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllGuests(),
        HotelAPIService.getAllBookings(),
      ]);

      // Calculate statistics
      const totalRooms = rooms.length;
      const availableRooms = rooms.filter((r: any) => r.available).length;
      const occupiedRooms = rooms.filter((r: any) => r.status === 'occupied').length;
      const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      const todayCheckIns = bookings.filter((b: any) =>
        b.check_in_date?.startsWith(todayStr) && (b.status === 'confirmed' || b.status === 'pending')
      ).length;

      const todayCheckOuts = bookings.filter((b: any) =>
        b.check_out_date?.startsWith(todayStr) && b.status === 'checked_in'
      ).length;

      const activeBookings = bookings.filter((b: any) =>
        ['confirmed', 'pending', 'checked_in'].includes(b.status)
      ).length;

      // Calculate revenue
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);

      const monthlyBookings = bookings.filter((b: any) =>
        new Date(b.created_at) >= monthStart && b.status !== 'cancelled'
      );
      const weeklyBookings = bookings.filter((b: any) =>
        new Date(b.created_at) >= weekStart && b.status !== 'cancelled'
      );

      const monthlyRevenue = monthlyBookings.reduce((sum: number, b: any) =>
        sum + parseFloat(b.total_amount || 0), 0
      );
      const weeklyRevenue = weeklyBookings.reduce((sum: number, b: any) =>
        sum + parseFloat(b.total_amount || 0), 0
      );
      const totalRevenue = bookings
        .filter((b: any) => b.status !== 'cancelled')
        .reduce((sum: number, b: any) => sum + parseFloat(b.total_amount || 0), 0);

      const averageBookingValue = activeBookings > 0
        ? totalRevenue / activeBookings
        : 0;

      setStats({
        totalRooms,
        availableRooms,
        occupiedRooms,
        occupancyRate,
        totalGuests: guests.length,
        activeBookings,
        todayCheckIns,
        todayCheckOuts,
        monthlyRevenue,
        weeklyRevenue,
        averageBookingValue,
        totalRevenue,
      });
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.response?.data?.error || 'Failed to load dashboard data');
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

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!stats) {
    return (
      <Box p={3}>
        <Alert severity="info">No data available</Alert>
      </Box>
    );
  }

  return (
    <Box p={3}>
      {/* Welcome Header */}
      <Box mb={4}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 600 }}>
          Welcome back, {user?.username || 'Admin'}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Here's what's happening with your hotel today
        </Typography>
      </Box>

      {/* Key Metrics - Top Row */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Occupancy Rate"
            value={`${stats.occupancyRate.toFixed(1)}%`}
            subtitle={`${stats.occupiedRooms} of ${stats.totalRooms} rooms`}
            icon={<Hotel sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
            trend={{ value: 5.2, label: 'vs last month' }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Monthly Revenue"
            value={formatCurrencyCustom(stats.monthlyRevenue, 0)}
            subtitle="This month"
            icon={<AttachMoney sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
            trend={{ value: 12.5, label: 'vs last month' }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Active Bookings"
            value={stats.activeBookings}
            subtitle={`Avg: ${formatCurrencyCustom(stats.averageBookingValue, 0)}`}
            icon={<CheckCircle sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Guests"
            value={stats.totalGuests}
            subtitle="Registered"
            icon={<People sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)"
          />
        </Grid>
      </Grid>

      {/* Today's Activity */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Today's Activity
                </Typography>
                <Chip label={new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })} size="small" />
              </Box>

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(76, 175, 80, 0.1)',
                      borderRadius: 2,
                    }}
                  >
                    <Box display="flex" alignItems="center" mb={1}>
                      <CheckCircle sx={{ color: 'success.main', mr: 1 }} />
                      <Typography variant="body2" color="text.secondary">
                        Check-ins Today
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                      {stats.todayCheckIns}
                    </Typography>
                  </Paper>
                </Grid>

                <Grid item xs={6}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(33, 150, 243, 0.1)',
                      borderRadius: 2,
                    }}
                  >
                    <Box display="flex" alignItems="center" mb={1}>
                      <Schedule sx={{ color: 'info.main', mr: 1 }} />
                      <Typography variant="body2" color="text.secondary">
                        Check-outs Today
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                      {stats.todayCheckOuts}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <Star sx={{ color: 'warning.main', mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Room Status
                </Typography>
              </Box>

              <Box mb={2}>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="body2" color="text.secondary">
                    Available
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {stats.availableRooms} rooms
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(stats.availableRooms / stats.totalRooms) * 100}
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: 'success.main',
                    }
                  }}
                />
              </Box>

              <Box>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="body2" color="text.secondary">
                    Occupied
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {stats.occupiedRooms} rooms
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={(stats.occupiedRooms / stats.totalRooms) * 100}
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: 'error.main',
                    }
                  }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Revenue Overview */}
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={3}>
                <Assessment sx={{ color: 'primary.main', mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Revenue Overview
                </Typography>
              </Box>

              <Grid container spacing={3}>
                <Grid item xs={12} sm={4}>
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Total Revenue
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'primary.main' }}>
                      {formatCurrency(stats.totalRevenue)}
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} sm={4}>
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      This Month
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 600 }}>
                      {formatCurrency(stats.monthlyRevenue)}
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} sm={4}>
                  <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Last 7 Days
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 600 }}>
                      {formatCurrency(stats.weeklyRevenue)}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdminOverviewDashboard;
