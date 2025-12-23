import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
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
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  EventNote as BookingIcon,
  Receipt as ReceiptIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { BookingWithDetails } from '../../../types';
import InvoiceModal from '../../invoices/components/InvoiceModal';

const MyBookingsPage: React.FC = () => {
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string>('');

  const loadMyBookings = async () => {
    try {
      setLoading(true);
      setError(null);
      // This will call a new endpoint that returns only the current user's bookings
      const data = await HotelAPIService.getMyBookings();
      setBookings(data);
    } catch (err: any) {
      console.error('Failed to load your bookings:', err);
      setError(err.message || 'Failed to load your bookings. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMyBookings();
  }, []);

  const getStatusColor = (status: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'success';
      case 'pending':
        return 'warning';
      case 'cancelled':
        return 'error';
      case 'completed':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleViewInvoice = (bookingId: string) => {
    setSelectedBookingId(bookingId);
    setInvoiceModalOpen(true);
  };

  const canDownloadInvoice = (booking: BookingWithDetails) => {
    return booking.status === 'checked_out' || booking.status === 'completed';
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
            My Bookings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            View all your hotel room reservations
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadMyBookings}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={loadMyBookings}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" mb={2}>
            <BookingIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Your Reservations ({bookings.length})
            </Typography>
          </Box>

          {bookings.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No bookings yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                You haven't made any reservations yet. Visit the Rooms tab to book a room!
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Folio Number</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Guest Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Room Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Room Number</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Check-in</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Check-out</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow
                      key={booking.id}
                      sx={{
                        '&:hover': { backgroundColor: '#f9f9f9' },
                        transition: 'background-color 0.2s'
                      }}
                    >
                      <TableCell>{booking.folio_number || '-'}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{booking.guest_name}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{booking.room_type}</TableCell>
                      <TableCell>{booking.room_number}</TableCell>
                      <TableCell>{formatDate(booking.check_in_date)}</TableCell>
                      <TableCell>{formatDate(booking.check_out_date)}</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>
                        ${typeof booking.total_amount === 'string'
                          ? parseFloat(booking.total_amount).toFixed(2)
                          : booking.total_amount.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={booking.status}
                          color={getStatusColor(booking.status)}
                          size="small"
                          sx={{ fontWeight: 500 }}
                        />
                      </TableCell>
                      <TableCell>
                        {canDownloadInvoice(booking) && (
                          <Tooltip title="Download Invoice">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleViewInvoice(booking.id)}
                            >
                              <ReceiptIcon />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Box mt={2}>
        <Alert severity="info">
          <Typography variant="body2">
            <strong>Note:</strong> To modify or cancel a booking, please contact our support team or visit the front desk.
            For checked-out bookings, you can download your invoice using the receipt icon in the Actions column.
          </Typography>
        </Alert>
      </Box>

      {/* Invoice Modal */}
      <InvoiceModal
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        bookingId={selectedBookingId}
      />
    </Box>
  );
};

export default MyBookingsPage;
