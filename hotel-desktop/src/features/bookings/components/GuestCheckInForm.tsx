import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  TextField,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { HotelAPIService } from '../../../api';
import { Booking, Guest, GuestUpdateRequest } from '../../../types';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`guest-tabpanel-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const GuestCheckInForm: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [booking, setBooking] = useState<Booking | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  // Form data
  const [formData, setFormData] = useState<GuestUpdateRequest>({});
  const [marketCode, setMarketCode] = useState('WKII');
  const [specialRequests, setSpecialRequests] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing token');
      setLoading(false);
      return;
    }

    loadBookingData();
  }, [token]);

  const loadBookingData = async () => {
    try {
      const response = await HotelAPIService.guestPortalGetBooking(token!);
      setBooking(response.booking);
      setGuest(response.guest);

      // Initialize form with guest data
      const nameParts = response.guest.full_name?.split(' ') || [];
      setFormData({
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' ') || '',
        email: response.guest.email || '',
        phone: response.guest.phone || '',
        alt_phone: response.guest.alt_phone || '',
        nationality: response.guest.nationality || '',
        address_line1: response.guest.address_line1 || '',
        city: response.guest.city || '',
        state_province: response.guest.state_province || '',
        postal_code: response.guest.postal_code || '',
        country: response.guest.country || '',
        title: response.guest.title || '',
        ic_number: response.guest.ic_number || '',
      });

      setMarketCode(response.booking.market_code || 'WKII');
      setSpecialRequests(response.booking.special_requests || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load booking');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof GuestUpdateRequest, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await HotelAPIService.guestPortalSubmitPreCheckin(token!, {
        guest_update: formData,
        market_code: marketCode,
        special_requests: specialRequests,
      });

      navigate('/guest-checkin/confirm');
    } catch (err: any) {
      setError(err.message || 'Failed to submit pre-check-in');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading...</Typography>
      </Container>
    );
  }

  if (error && !booking) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Alert severity="error">{error}</Alert>
          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 3 }}
            onClick={() => navigate('/guest-checkin')}
          >
            Back to Start
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Update Your Information
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Please review and update your details for a smooth check-in
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab label="Personal Information" />
          <Tab label="Stay Details" />
        </Tabs>

        {/* Tab 1: Personal Information */}
        <TabPanel value={activeTab} index={0}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth>
                <InputLabel>Title</InputLabel>
                <Select
                  value={formData.title || ''}
                  onChange={(e) => handleChange('title', e.target.value)}
                  label="Title"
                >
                  <MenuItem value="Mr">Mr</MenuItem>
                  <MenuItem value="Mrs">Mrs</MenuItem>
                  <MenuItem value="Ms">Ms</MenuItem>
                  <MenuItem value="Dr">Dr</MenuItem>
                  <MenuItem value="Prof">Prof</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4.5}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.first_name || ''}
                onChange={(e) => handleChange('first_name', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={4.5}>
              <TextField
                fullWidth
                label="Last Name"
                value={formData.last_name || ''}
                onChange={(e) => handleChange('last_name', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => handleChange('email', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone"
                value={formData.phone || ''}
                onChange={(e) => handleChange('phone', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Alternate Phone"
                value={formData.alt_phone || ''}
                onChange={(e) => handleChange('alt_phone', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Nationality"
                value={formData.nationality || ''}
                onChange={(e) => handleChange('nationality', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Street Address"
                value={formData.address_line1 || ''}
                onChange={(e) => handleChange('address_line1', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="City"
                value={formData.city || ''}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="State/Province"
                value={formData.state_province || ''}
                onChange={(e) => handleChange('state_province', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Postal Code"
                value={formData.postal_code || ''}
                onChange={(e) => handleChange('postal_code', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Country"
                value={formData.country || ''}
                onChange={(e) => handleChange('country', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="IC/Passport Number"
                value={formData.ic_number || ''}
                onChange={(e) => handleChange('ic_number', e.target.value)}
              />
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 2: Stay Details */}
        <TabPanel value={activeTab} index={1}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                The following information is read-only. Please contact the hotel if you need to make changes.
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-in Date"
                value={booking?.check_in_date || ''}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Check-out Date"
                value={booking?.check_out_date || ''}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Room Type"
                value={booking?.room_type || 'Standard'}
                disabled
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Number of Guests"
                value={booking?.number_of_guests || 1}
                disabled
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Booking Type</InputLabel>
                <Select
                  value={marketCode}
                  onChange={(e) => setMarketCode(e.target.value)}
                  label="Booking Type"
                >
                  <MenuItem value="DIRECT">Direct Booking</MenuItem>
                  <MenuItem value="OTA">Online Travel Agency</MenuItem>
                  <MenuItem value="WKII">Walk-in</MenuItem>
                  <MenuItem value="CORP">Corporate</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Special Requests"
                multiline
                rows={4}
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Enter any special requests or preferences"
              />
            </Grid>
          </Grid>
        </TabPanel>

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button
            variant="outlined"
            onClick={() => navigate(`/guest-checkin/verify?token=${token}`)}
            disabled={submitting}
            sx={{ flex: 1 }}
          >
            Back
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
            startIcon={submitting && <CircularProgress size={20} />}
            sx={{ flex: 1 }}
            size="large"
          >
            {submitting ? 'Submitting...' : 'Submit Pre-Check-In'}
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default GuestCheckInForm;
