import React from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Alert,
  Paper,
  LinearProgress,
  Skeleton,
} from '@mui/material';
import {
  Hotel as HotelIcon,
  Person as PersonIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { StatCard } from '../../../components/common/StatCard';
import { useCurrency } from '../../../hooks/useCurrency';
import { useDashboardAnalytics } from '../hooks/useDashboardAnalytics';

// Color palette
const COLORS = {
  available: '#4caf50',
  occupied: '#ff9800',
  reserved: '#2196f3',
  maintenance: '#9e9e9e',
  cleaning: '#00bcd4',
  dirty: '#f44336',
};

const CHART_COLORS = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9c27b0', '#00bcd4'];

// Occupancy Gauge Component
const OccupancyGauge = ({ occupancyRate }: { occupancyRate: number }) => {
  const data = [
    { name: 'Occupied', value: occupancyRate },
    { name: 'Available', value: 100 - occupancyRate },
  ];

  return (
    <Box sx={{ position: 'relative', width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            startAngle={180}
            endAngle={0}
            dataKey="value"
          >
            <Cell fill={COLORS.occupied} />
            <Cell fill="#e0e0e0" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <Box
        sx={{
          position: 'absolute',
          top: '55%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
        }}
      >
        <Typography variant="h3" sx={{ fontWeight: 700, color: COLORS.occupied }}>
          {occupancyRate}%
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Occupancy
        </Typography>
      </Box>
    </Box>
  );
};

const AnalyticsDashboard: React.FC = () => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const {
    data: {
      roomStats,
      bookingStats,
      roomTypeStats,
      totalGuests,
      revenueData,
    },
    loading,
    error,
  } = useDashboardAnalytics();

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  const occupancyRate = roomStats.totalRooms > 0
    ? Math.round((roomStats.occupiedRooms / roomStats.totalRooms) * 100)
    : 0;

  const roomStatusData = [
    { name: 'Available', value: roomStats.availableRooms, color: COLORS.available },
    { name: 'Occupied', value: roomStats.occupiedRooms, color: COLORS.occupied },
    { name: 'Reserved', value: roomStats.reservedRooms, color: COLORS.reserved },
    { name: 'Maintenance', value: roomStats.maintenanceRooms, color: COLORS.maintenance },
    { name: 'Cleaning', value: roomStats.cleaningRooms, color: COLORS.cleaning },
  ].filter(item => item.value > 0);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
          Hotel Analytics Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Real-time overview of your hotel performance and occupancy metrics
        </Typography>
      </Box>

      {loading ? (
        <Grid container spacing={3}>
          {[1, 2, 3, 4].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
              <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
          <Grid size={{ xs: 12, md: 6 }}>
            <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
          </Grid>
        </Grid>
      ) : (
        <Grid container spacing={3}>
          {/* Key Stats Row */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Total Rooms"
              value={roomStats.totalRooms}
              subtitle={`${roomStats.availableRooms} available`}
              icon={<HotelIcon />}
              color="#1a73e8"
              subtitleVariant="caption"
              valueSx={{ fontWeight: 700 }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Occupancy Rate"
              value={`${occupancyRate}%`}
              subtitle={`${roomStats.occupiedRooms} rooms occupied`}
              icon={<CheckCircleIcon />}
              color="#34a853"
              trend={{ value: 5, label: 'vs last week' }}
              showPositiveTrendSign
              subtitleVariant="caption"
              valueSx={{ fontWeight: 700 }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Today's Check-ins"
              value={bookingStats.todayCheckIns}
              subtitle={`${bookingStats.todayCheckOuts} check-outs`}
              icon={<ScheduleIcon />}
              color="#fbbc04"
              subtitleVariant="caption"
              valueSx={{ fontWeight: 700 }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Total Guests"
              value={totalGuests}
              subtitle={`${bookingStats.pendingBookings} pending bookings`}
              icon={<PersonIcon />}
              color="#9c27b0"
              subtitleVariant="caption"
              valueSx={{ fontWeight: 700 }}
            />
          </Grid>

          {/* Occupancy Gauge & Room Status */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  Current Occupancy
                </Typography>
                <OccupancyGauge occupancyRate={occupancyRate} />
                <Box sx={{ mt: 2 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="body2" color="text.secondary">Available</Typography>
                    <Typography variant="body2" fontWeight={600} color="success.main">
                      {roomStats.availableRooms} rooms
                    </Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">Occupied</Typography>
                    <Typography variant="body2" fontWeight={600} color="warning.main">
                      {roomStats.occupiedRooms} rooms
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Room Status Distribution */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  Room Status Distribution
                </Typography>
                <Box sx={{ height: 200 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={roomStatusData}
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {roomStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2, justifyContent: 'center' }}>
                  {roomStatusData.map((item) => (
                    <Box key={item.name} display="flex" alignItems="center" gap={0.5}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                      <Typography variant="caption">{item.name}</Typography>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Revenue Chart */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  Weekly Revenue
                </Typography>
                <Box sx={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${currencySymbol}${v / 1000}k`} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="revenue" fill="#1a73e8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Room Type Breakdown */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                  Room Type Occupancy
                </Typography>
                <Box sx={{ height: 250 }}>
                  <ResponsiveContainer>
                    <BarChart data={roomTypeStats} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={100} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="occupied" stackId="a" fill={COLORS.occupied} name="Occupied" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="available" stackId="a" fill={COLORS.available} name="Available" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Quick Stats */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                  Quick Stats
                </Typography>
                <Box sx={{ '& > *': { mb: 2.5 } }}>
                  <Box>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="text.secondary">Room Utilization</Typography>
                      <Typography variant="body2" fontWeight={600}>{occupancyRate}%</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={occupancyRate}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': { bgcolor: COLORS.occupied, borderRadius: 4 },
                      }}
                    />
                  </Box>
                  <Box>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="text.secondary">Reserved Today</Typography>
                      <Typography variant="body2" fontWeight={600}>{roomStats.reservedRooms} rooms</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={roomStats.totalRooms > 0 ? (roomStats.reservedRooms / roomStats.totalRooms) * 100 : 0}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': { bgcolor: COLORS.reserved, borderRadius: 4 },
                      }}
                    />
                  </Box>
                  <Box>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="text.secondary">Under Maintenance</Typography>
                      <Typography variant="body2" fontWeight={600}>{roomStats.maintenanceRooms} rooms</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={roomStats.totalRooms > 0 ? (roomStats.maintenanceRooms / roomStats.totalRooms) * 100 : 0}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': { bgcolor: COLORS.maintenance, borderRadius: 4 },
                      }}
                    />
                  </Box>
                  <Box>
                    <Box display="flex" justifyContent="space-between" mb={0.5}>
                      <Typography variant="body2" color="text.secondary">Total Bookings</Typography>
                      <Typography variant="body2" fontWeight={600}>{bookingStats.totalBookings}</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={100}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': { bgcolor: '#9c27b0', borderRadius: 4 },
                      }}
                    />
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default AnalyticsDashboard;
