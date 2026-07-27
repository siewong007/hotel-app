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
  People,
  Hotel,
  AttachMoney,
  CheckCircle,
  Schedule,
  Assessment,
  Star,
} from '@mui/icons-material';
import { BookingsService, GuestsService, RoomsService } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { StatCard } from '../../../components/common/StatCard';
import { formatCurrency, formatCurrencyCustom } from '../../../utils/currency';
import { formatLocalDate } from '../../../utils/date';

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
        RoomsService.getAllRooms(),
        GuestsService.getAllGuests(),
        BookingsService.getAllBookings(),
      ]);

      // Calculate statistics
      const totalRooms = rooms.length;
      const availableRooms = rooms.filter((r) => r.available).length;
      const occupiedRooms = rooms.filter((r) => r.status === 'occupied').length;
      const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = formatLocalDate(today);

      const todayCheckIns = bookings.filter((b) =>
        b.check_in_date?.startsWith(todayStr) && (b.status === 'confirmed' || b.status === 'pending')
      ).length;

      const todayCheckOuts = bookings.filter((b) =>
        b.check_out_date?.startsWith(todayStr) && b.status === 'checked_in'
      ).length;

      const activeBookings = bookings.filter((b) =>
        ['confirmed', 'pending', 'checked_in'].includes(b.status)
      ).length;

      // Calculate revenue
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);

      const monthlyBookings = bookings.filter((b) =>
        new Date(b.created_at as string) >= monthStart && b.status !== 'voided'
      );
      const weeklyBookings = bookings.filter((b) =>
        new Date(b.created_at as string) >= weekStart && b.status !== 'voided'
      );

      const monthlyRevenue = monthlyBookings.reduce((sum: number, b) =>
        sum + parseFloat(String(b.total_amount || 0)), 0
      );
      const weeklyRevenue = weeklyBookings.reduce((sum: number, b) =>
        sum + parseFloat(String(b.total_amount || 0)), 0
      );
      const totalRevenue = bookings
        .filter((b) => b.status !== 'voided')
        .reduce((sum: number, b) => sum + parseFloat(String(b.total_amount || 0)), 0);

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
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      // NOTE: this app's API client (ky) never throws an axios-style
      // `{ response: { data: { error } } }` shape — see src/api/client.ts
      // `APIError`/ky `HTTPError`. This branch is preserved as-is (type-only
      // change) but is suspected dead code; flagged in the task report.
      const legacyMessage = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(legacyMessage || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px"
        }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{
        p: 3
      }}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!stats) {
    return (
      <Box sx={{
        p: 3
      }}>
        <Alert severity="info">No data available</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{
      p: 3
    }}>
      {/* Welcome Header */}
      <Box sx={{
        mb: 4
      }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 600 }}>
          Welcome back, {user?.username || 'Admin'}
        </Typography>
        <Typography variant="body1" sx={{
          color: "text.secondary"
        }}>
          Here's what's happening with your hotel today
        </Typography>
      </Box>
      {/* Key Metrics - Top Row */}
      <Grid container spacing={3} sx={{
        mb: 3
      }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Occupancy Rate"
            value={`${stats.occupancyRate.toFixed(1)}%`}
            subtitle={`${stats.occupiedRooms} of ${stats.totalRooms} rooms`}
            icon={<Hotel sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
            iconBackground="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
            sx={{ overflow: 'visible' }}
            trend={{ value: 5.2, label: 'vs last month' }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Monthly Revenue"
            value={formatCurrencyCustom(stats.monthlyRevenue, 0)}
            subtitle="This month"
            icon={<AttachMoney sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
            iconBackground="linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
            sx={{ overflow: 'visible' }}
            trend={{ value: 12.5, label: 'vs last month' }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Active Bookings"
            value={stats.activeBookings}
            subtitle={`Avg: ${formatCurrencyCustom(stats.averageBookingValue, 0)}`}
            icon={<CheckCircle sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
            iconBackground="linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
            sx={{ overflow: 'visible' }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Guests"
            value={stats.totalGuests}
            subtitle="Registered"
            icon={<People sx={{ color: 'white', fontSize: 28 }} />}
            color="linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)"
            iconBackground="linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)"
            sx={{ overflow: 'visible' }}
          />
        </Grid>
      </Grid>
      {/* Today's Activity */}
      <Grid container spacing={3} sx={{
        mb: 3
      }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 2
                }}>
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
                <Grid size={6}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(76, 175, 80, 0.1)',
                      borderRadius: 2,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        mb: 1
                      }}>
                      <CheckCircle sx={{ color: 'success.main', mr: 1 }} />
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        Check-ins Today
                      </Typography>
                    </Box>
                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                      {stats.todayCheckIns}
                    </Typography>
                  </Paper>
                </Grid>

                <Grid size={6}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 2,
                      backgroundColor: 'rgba(33, 150, 243, 0.1)',
                      borderRadius: 2,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        mb: 1
                      }}>
                      <Schedule sx={{ color: 'info.main', mr: 1 }} />
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
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

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  mb: 2
                }}>
                <Star sx={{ color: 'warning.main', mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Room Status
                </Typography>
              </Box>

              <Box sx={{
                mb: 2
              }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    mb: 0.5
                  }}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Available
                  </Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 600
                  }}>
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
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    mb: 0.5
                  }}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Occupied
                  </Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 600
                  }}>
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
        <Grid size={12}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  mb: 3
                }}>
                <Assessment sx={{ color: 'primary.main', mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Revenue Overview
                </Typography>
              </Box>

              <Grid container spacing={3}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <Box>
                    <Typography variant="body2" gutterBottom sx={{
                      color: "text.secondary"
                    }}>
                      Total Revenue
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 600, color: 'primary.main' }}>
                      {formatCurrency(stats.totalRevenue)}
                    </Typography>
                  </Box>
                </Grid>

                <Grid size={{ xs: 12, sm: 4 }}>
                  <Box>
                    <Typography variant="body2" gutterBottom sx={{
                      color: "text.secondary"
                    }}>
                      This Month
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 600 }}>
                      {formatCurrency(stats.monthlyRevenue)}
                    </Typography>
                  </Box>
                </Grid>

                <Grid size={{ xs: 12, sm: 4 }}>
                  <Box>
                    <Typography variant="body2" gutterBottom sx={{
                      color: "text.secondary"
                    }}>
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
