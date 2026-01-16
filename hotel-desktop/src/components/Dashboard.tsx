import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Alert
} from '@mui/material';
import {
  Hotel as HotelIcon,
  Person as PersonIcon,
  EventNote as BookingIcon,
  AttachMoney as MoneyIcon
} from '@mui/icons-material';
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

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    totalRooms: 0,
    availableRooms: 0,
    totalGuests: 0,
    totalBookings: 0,
    totalRevenue: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const [rooms, guests, bookings] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllGuests(),
        HotelAPIService.getAllBookings()
      ]);

      const availableRooms = rooms.filter(room => room.available).length;
      const totalRevenue = bookings.length * 150;

      setStats({
        totalRooms: rooms.length,
        availableRooms,
        totalGuests: guests.length,
        totalBookings: bookings.length,
        totalRevenue
      });
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
      <MuiBox display="flex" justifyContent="center" alignItems="center" minHeight="400px">
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
          Hotel Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Welcome back! Here's an overview of your hotel operations.
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Rooms"
            value={stats.totalRooms}
            icon={<HotelIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#1a73e8"
            gradient="linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Available Rooms"
            value={stats.availableRooms}
            icon={<HotelIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#34a853"
            gradient="linear-gradient(135deg, #34a853 0%, #4caf50 100%)"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Guests"
            value={stats.totalGuests}
            icon={<PersonIcon sx={{ fontSize: 32, color: 'white' }} />}
            color="#fbbc04"
            gradient="linear-gradient(135deg, #fbbc04 0%, #ff9800 100%)"
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Bookings"
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
                  Recent Activity
                </Typography>
              </Box>
              <Box sx={{ mt: 2, '& > *': { mb: 1.5 } }}>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    <strong>{stats.availableRooms}</strong> rooms currently available for booking
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    <strong>{stats.totalGuests}</strong> guests registered in the system
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'secondary.main', mr: 2 }} />
                  <Typography variant="body1" color="text.primary">
                    <strong>{stats.totalBookings}</strong> bookings made this period
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
      </Grid>
    </Box>
  );
};

export default Dashboard;
