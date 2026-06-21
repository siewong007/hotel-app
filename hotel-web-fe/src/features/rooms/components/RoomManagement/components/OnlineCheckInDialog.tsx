import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Grid,
  Stack,
  Button,
  Autocomplete,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  CircularProgress,
} from '@mui/material';
import { EventAvailable as BookingIcon } from '@mui/icons-material';
import { Guest } from '../../../../../types';

interface OnlineGuestForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  ic_number: string;
  nationality: string;
  tourism_type: string;
}

interface BookingChannelOption {
  name: string;
  abbreviation?: string;
}

interface OnlineCheckInDialogProps {
  open: boolean;
  onClose: () => void;
  roomNumber?: string;
  roomPricePerNight?: number | string;
  isCreatingNewGuest: boolean;
  onModeChange: (creatingNew: boolean) => void;
  guests: Guest[];
  selectedGuest: Guest | null;
  onSelectGuest: (guest: Guest | null) => void;
  newGuestForm: OnlineGuestForm;
  onNewGuestFieldChange: (field: keyof OnlineGuestForm, value: string) => void;
  bookingChannels: BookingChannelOption[];
  bookingChannel: string;
  onBookingChannelChange: (value: string) => void;
  reference: string;
  onReferenceChange: (value: string) => void;
  checkInDate: string;
  onCheckInDateChange: (value: string) => void;
  checkOutDate: string;
  onCheckOutDateChange: (value: string) => void;
  numberOfNights: number;
  currencySymbol: string;
  creating: boolean;
  onSubmit: () => void;
}

const OnlineCheckInDialog: React.FC<OnlineCheckInDialogProps> = ({
  open,
  onClose,
  roomNumber,
  roomPricePerNight,
  isCreatingNewGuest,
  onModeChange,
  guests,
  selectedGuest,
  onSelectGuest,
  newGuestForm,
  onNewGuestFieldChange,
  bookingChannels,
  bookingChannel,
  onBookingChannelChange,
  reference,
  onReferenceChange,
  checkInDate,
  onCheckInDateChange,
  checkOutDate,
  onCheckOutDateChange,
  numberOfNights,
  currencySymbol,
  creating,
  onSubmit,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <BookingIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Online Booking - Room {roomNumber || 'N/A'}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Grid container spacing={3}>
          {/* Toggle between existing guest and new guest */}
          <Grid size={12}>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Button
                variant={!isCreatingNewGuest ? 'contained' : 'outlined'}
                onClick={() => onModeChange(false)}
                size="small"
              >
                Select Existing Guest
              </Button>
              <Button
                variant={isCreatingNewGuest ? 'contained' : 'outlined'}
                onClick={() => onModeChange(true)}
                size="small"
              >
                Register New Guest
              </Button>
            </Stack>
          </Grid>

          {/* Guest Selection (Existing Guest) */}
          {!isCreatingNewGuest && (
            <Grid size={12}>
              <Autocomplete
                value={selectedGuest}
                onChange={(_, newValue) => onSelectGuest(newValue)}
                options={guests}
                getOptionLabel={(option) =>
                  option.email ? `${option.full_name} - ${option.email}` : option.full_name
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Guest *"
                    placeholder="Search by name or email"
                  />
                )}
              />
            </Grid>
          )}

          {/* New Guest Registration Form */}
          {isCreatingNewGuest && (
            <>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="First Name"
                  value={newGuestForm.first_name}
                  onChange={(e) => onNewGuestFieldChange('first_name', e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Last Name"
                  value={newGuestForm.last_name}
                  onChange={(e) => onNewGuestFieldChange('last_name', e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={newGuestForm.email}
                  onChange={(e) => onNewGuestFieldChange('email', e.target.value)}
                  required={!newGuestForm.phone.trim()}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={newGuestForm.phone}
                  onChange={(e) => onNewGuestFieldChange('phone', e.target.value)}
                  required={!newGuestForm.email.trim()}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="IC/Passport Number"
                  value={newGuestForm.ic_number}
                  onChange={(e) => onNewGuestFieldChange('ic_number', e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label="Nationality"
                  value={newGuestForm.nationality}
                  onChange={(e) => onNewGuestFieldChange('nationality', e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  select
                  required
                  label="Tourism Type"
                  value={newGuestForm.tourism_type}
                  onChange={(e) => onNewGuestFieldChange('tourism_type', e.target.value)}
                >
                  <MenuItem value="" disabled>Select tourism type</MenuItem>
                  <MenuItem value="local">Local - no tourism tax</MenuItem>
                  <MenuItem value="foreign">Foreign - tourism tax applies</MenuItem>
                </TextField>
              </Grid>
            </>
          )}

          {/* Booking Channel */}
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth required>
              <InputLabel>Booking Channel</InputLabel>
              <Select
                value={bookingChannel}
                onChange={(e) => onBookingChannelChange(e.target.value)}
                label="Booking Channel"
              >
                {bookingChannels.map((channel) => (
                  <MenuItem key={channel.name} value={channel.name}>
                    {channel.abbreviation ? `${channel.name} (${channel.abbreviation})` : channel.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Booking Reference */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Booking Reference"
              value={reference}
              onChange={(e) => onReferenceChange(e.target.value)}
              placeholder="e.g., OL-123456"
            />
          </Grid>

          {/* Check-in Date */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              required
              type="date"
              label="Check-in Date"
              value={checkInDate}
              onChange={(e) => onCheckInDateChange(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* Check-out Date */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              required
              type="date"
              label="Check-out Date"
              value={checkOutDate}
              onChange={(e) => onCheckOutDateChange(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* Summary */}
          <Grid size={12}>
            <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" gutterBottom>
                Booking Summary
              </Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Number of Nights:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {numberOfNights}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Room Rate:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {currencySymbol}{roomPricePerNight || 0} / night
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Total Amount:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" fontWeight="bold">
                    {currencySymbol}{(() => {
                      const price = roomPricePerNight || 0;
                      const numPrice = typeof price === 'string' ? parseFloat(price) : price;
                      return (numPrice * numberOfNights).toFixed(2);
                    })()}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={
            creating ||
            !bookingChannel ||
            (!isCreatingNewGuest && !selectedGuest) ||
            (isCreatingNewGuest && (
              !newGuestForm.first_name ||
              !newGuestForm.last_name ||
              !newGuestForm.ic_number.trim() ||
              (!newGuestForm.email.trim() && !newGuestForm.phone.trim())
            ))
          }
          startIcon={creating ? <CircularProgress size={20} /> : null}
          size="large"
        >
          {creating ? 'Processing...' : 'Create Reservation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OnlineCheckInDialog;
