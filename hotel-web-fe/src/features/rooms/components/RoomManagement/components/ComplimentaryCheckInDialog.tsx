import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Grid,
  Alert,
  CircularProgress,
  Autocomplete,
  TextField,
  Chip,
  Paper,
  Button,
} from '@mui/material';
import { CardGiftcard as GiftIcon } from '@mui/icons-material';
import { GuestWithCredits } from '../types';

interface ComplimentaryCheckInDialogProps {
  open: boolean;
  onClose: () => void;
  roomNumber?: string;
  roomPricePerNight?: number | string;
  loadingGuests: boolean;
  guestsWithCredits: GuestWithCredits[];
  selectedGuest: GuestWithCredits | null;
  onSelectGuest: (guest: GuestWithCredits | null) => void;
  checkInDate: string;
  onCheckInDateChange: (value: string) => void;
  checkOutDate: string;
  onCheckOutDateChange: (value: string) => void;
  numberOfNights: number;
  currencySymbol: string;
  creating: boolean;
  onSubmit: () => void;
}

const ComplimentaryCheckInDialog: React.FC<ComplimentaryCheckInDialogProps> = ({
  open,
  onClose,
  roomNumber,
  roomPricePerNight,
  loadingGuests,
  guestsWithCredits,
  selectedGuest,
  onSelectGuest,
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
      <DialogTitle sx={{ bgcolor: 'secondary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <GiftIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Complimentary Booking - Room {roomNumber || 'N/A'}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Grid container spacing={3}>
          {/* Info Banner */}
          <Grid size={12}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                This booking uses the guest's <strong>Free Room Credits</strong>. Only guests with available credits are shown below.
              </Typography>
            </Alert>
          </Grid>

          {/* Guest Selection (Only guests with credits) */}
          <Grid size={12}>
            {loadingGuests ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress size={24} />
                <Typography sx={{ ml: 1 }}>Loading guests with credits...</Typography>
              </Box>
            ) : (
              <Autocomplete
                value={selectedGuest}
                onChange={(_, newValue) => onSelectGuest(newValue)}
                options={guestsWithCredits}
                getOptionLabel={(option) => {
                  return option.email
                    ? `${option.full_name} - ${option.email} (${option.total_complimentary_credits} credits)`
                    : `${option.full_name} (${option.total_complimentary_credits} credits)`;
                }}
                renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  return (
                    <Box component="li" key={key} {...otherProps}>
                      <Box sx={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box>
                            <Typography variant="body1">{option.full_name}</Typography>
                            {option.email && <Typography variant="caption" color="text.secondary">{option.email}</Typography>}
                          </Box>
                          <Chip
                            icon={<GiftIcon sx={{ fontSize: 14 }} />}
                            label={`${option.total_complimentary_credits} night${option.total_complimentary_credits !== 1 ? 's' : ''}`}
                            size="small"
                            color="secondary"
                          />
                        </Box>
                        {/* Show room-type-specific credits breakdown */}
                        {option.credits_by_room_type.length > 0 && (
                          <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {option.credits_by_room_type.map((credit) => (
                              <Chip
                                key={credit.room_type_id}
                                label={`${credit.room_type_name}: ${credit.nights_available}`}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.65rem', height: 20 }}
                              />
                            ))}
                          </Box>
                        )}
                      </Box>
                    </Box>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Guest with Free Room Credits *"
                    placeholder="Search by name or email"
                  />
                )}
                noOptionsText="No guests with free room credits found"
              />
            )}
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
            <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GiftIcon /> Booking Summary
              </Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Number of Nights:</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">{numberOfNights}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Room Rate:</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
                    {currencySymbol}{roomPricePerNight || 0} / night
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">Total Amount:</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" fontWeight="bold" color="success.main">
                    FREE (Complimentary)
                  </Typography>
                </Grid>
                {selectedGuest && (
                  <>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">Credits Available:</Typography>
                    </Grid>
                    <Grid size={6}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selectedGuest.credits_by_room_type.map((credit) => (
                          <Chip
                            key={credit.room_type_id}
                            size="small"
                            label={`${credit.room_type_name}: ${credit.nights_available}`}
                            color="secondary"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem' }}
                          />
                        ))}
                      </Box>
                    </Grid>
                  </>
                )}
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
          color="secondary"
          onClick={onSubmit}
          disabled={creating || !selectedGuest}
          startIcon={creating ? <CircularProgress size={20} /> : <GiftIcon />}
          size="large"
        >
          {creating ? 'Processing...' : 'Create Reservation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ComplimentaryCheckInDialog;
