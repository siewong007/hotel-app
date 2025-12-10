import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Paper
} from '@mui/material';
import {
  Hotel as HotelIcon,
  Person as PersonIcon,
  EventNote as BookingIcon,
  AttachMoney as MoneyIcon,
  LocalOffer as OfferIcon,
  CardGiftcard as VoucherIcon,
  Event as EventIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { HotelAPIService } from '../api';
import { Room, Guest, Booking } from '../types';
import { CircularProgress, Box as MuiBox } from '@mui/material';

// Memoized StatCard component to prevent unnecessary re-renders
const StatCard = React.memo(({
  title,
  value,
  icon,
  color,
  gradient
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  gradient?: string;
}) => (
  <Card sx={{
    height: '100%',
    background: gradient || `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
    color: 'white',
    position: 'relative',
    overflow: 'hidden',
    '&::before': {
      content: '""',
      position: 'absolute',
      top: -50,
      right: -50,
      width: 150,
      height: 150,
      borderRadius: '50%',
      background: 'rgba(255, 255, 255, 0.1)',
    },
  }}>
    <CardContent sx={{ position: 'relative', zIndex: 1 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Typography variant="h4" component="div" sx={{ fontWeight: 700, mb: 0.5 }}>
            {value}
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.9)', fontWeight: 500 }}>
            {title}
          </Typography>
        </Box>
        <Box sx={{
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
          borderRadius: 2,
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
));

interface UpcomingBooking {
  id: number;
  room_type: string;
  room_number: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
}

const Dashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const [stats, setStats] = useState({
    totalRooms: 0,
    availableRooms: 0,
    totalGuests: 0,
    totalBookings: 0,
    totalRevenue: 0
  });
  const [upcomingBookings, setUpcomingBookings] = useState<UpcomingBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const [rooms, guests, bookings, myBookings] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllGuests(),
        HotelAPIService.getAllBookings(),
        HotelAPIService.getMyBookings().catch(() => []) // Fallback to empty array if fails
      ]);

      const availableRooms = rooms.filter(room => room.available).length;
      const totalRevenue = bookings.length * 150;

      // Filter upcoming bookings (check-in date is today or in the future, or currently checked in)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const upcoming = (myBookings as any[]).filter((booking: any) => {
        const checkInDate = new Date(booking.check_in_date);
        checkInDate.setHours(0, 0, 0, 0);
        return (
          (checkInDate >= today || booking.status === 'checked_in') &&
          booking.status !== 'cancelled' &&
          booking.status !== 'completed'
        );
      }).slice(0, 5).map((b: any) => ({
        id: b.id,
        room_type: b.room_type,
        room_number: b.room_number,
        check_in_date: b.check_in_date,
        check_out_date: b.check_out_date,
        status: b.status
      }));

      setStats({
        totalRooms: rooms.length,
        availableRooms,
        totalGuests: guests.length,
        totalBookings: bookings.length,
        totalRevenue
      });
      setUpcomingBookings(upcoming);
      setLoading(false);
    } catch (err) {
      setError('Failed to load dashboard statistics');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (loading) {
    return (
      <MuiBox sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </MuiBox>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
          {t('title')}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t('subtitle')}
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title={t('stats.totalRooms')}
            value={stats.totalRooms}
            icon={<HotelIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#1a73e8"
            gradient="linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title={t('stats.availableRooms')}
            value={stats.availableRooms}
            icon={<HotelIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#34a853"
            gradient="linear-gradient(135deg, #34a853 0%, #4caf50 100%)"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title={t('stats.totalGuests')}
            value={stats.totalGuests}
            icon={<PersonIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#fbbc04"
            gradient="linear-gradient(135deg, #fbbc04 0%, #ff9800 100%)"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title={t('stats.totalBookings')}
            value={stats.totalBookings}
            icon={<BookingIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#9c27b0"
            gradient="linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)"
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <BookingIcon sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {t('recentActivity')}
                </Typography>
              </Box>
              <Box sx={{ mt: 2, '& > *': { mb: 1.5 } }}>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    {t('messages.roomsAvailable', { count: stats.availableRooms })}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    {t('messages.guestsRegistered', { count: stats.totalGuests })}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'secondary.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    {t('messages.bookingsMade', { count: stats.totalBookings })}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    Estimated revenue: <strong>${stats.totalRevenue.toLocaleString()}</strong>
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" mb={2}>
                <HotelIcon sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  System Status
                </Typography>
              </Box>
              <Box sx={{ mt: 2, '& > *': { mb: 1.5 } }}>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    Backend API: <strong>Connected</strong>
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    Database: <strong>Active</strong>
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    Mobile App: <strong>Integration Ready</strong>
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Upcoming Bookings Section */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" mb={3}>
                <EventIcon sx={{ mr: 1, color: 'primary.main', fontSize: 28 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Upcoming Bookings
                </Typography>
              </Box>

              {upcomingBookings.length > 0 ? (
                <Paper variant="outlined">
                  <Table>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Booking ID</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Room</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Check-in</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Check-out</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {upcomingBookings.map((booking) => (
                        <TableRow key={booking.id} sx={{ '&:hover': { backgroundColor: '#fafafa' } }}>
                          <TableCell>#{booking.id}</TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                {booking.room_type}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Room {booking.room_number}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>{new Date(booking.check_in_date).toLocaleDateString()}</TableCell>
                          <TableCell>{new Date(booking.check_out_date).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Chip
                              label={booking.status}
                              color={
                                booking.status === 'confirmed' ? 'success' :
                                booking.status === 'checked_in' ? 'info' :
                                booking.status === 'pending' ? 'warning' : 'default'
                              }
                              size="small"
                              sx={{ fontWeight: 500 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              ) : (
                <Alert severity="info">
                  No upcoming bookings. Visit the Rooms tab to make a reservation!
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Promotions and Vouchers Section */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" mb={3}>
                <OfferIcon sx={{ mr: 1, color: 'secondary.main', fontSize: 28 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Active Promotions
                </Typography>
              </Box>

              <Box sx={{ '& > *': { mb: 2 } }}>
                <Card variant="outlined" sx={{ p: 2, borderLeft: '4px solid', borderColor: 'secondary.main' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'secondary.main' }}>
                    Weekend Special - 20% Off
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Book 2+ nights on weekends and save 20%
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Valid until: Dec 31, 2025
                  </Typography>
                </Card>

                <Card variant="outlined" sx={{ p: 2, borderLeft: '4px solid', borderColor: 'primary.main' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'primary.main' }}>
                    Early Bird Discount
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Book 30 days in advance for 15% off
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Valid until: Mar 31, 2026
                  </Typography>
                </Card>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box display="flex" alignItems="center" mb={3}>
                <VoucherIcon sx={{ mr: 1, color: 'success.main', fontSize: 28 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Available Rewards
                </Typography>
              </Box>

              <Box sx={{ '& > *': { mb: 2 } }}>
                <Card variant="outlined" sx={{ p: 2, borderLeft: '4px solid', borderColor: 'success.main' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="start">
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'success.main' }}>
                        Free Room Upgrade
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Upgrade to next room category
                      </Typography>
                    </Box>
                    <Chip label="500 pts" size="small" color="success" />
                  </Box>
                </Card>

                <Card variant="outlined" sx={{ p: 2, borderLeft: '4px solid', borderColor: 'info.main' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="start">
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'info.main' }}>
                        Complimentary Breakfast
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Free breakfast for 2 guests
                      </Typography>
                    </Box>
                    <Chip label="200 pts" size="small" color="info" />
                  </Box>
                </Card>

                <Card variant="outlined" sx={{ p: 2, borderLeft: '4px solid', borderColor: 'warning.main' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="start">
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'warning.main' }}>
                        Late Checkout
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Checkout up to 2pm
                      </Typography>
                    </Box>
                    <Chip label="100 pts" size="small" sx={{ bgcolor: 'warning.light', color: 'warning.dark' }} />
                  </Box>
                </Card>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
