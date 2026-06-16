import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Tabs,
  Tab,
  Grid,
  Divider,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Paper,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormGroup,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  Person as PersonIcon,
  CardGiftcard as GiftIcon,
  Login as LoginIcon,
  Block as BlockIcon,
} from '@mui/icons-material';
import { Guest, Room } from '../../../../../types';

interface GuestCredits {
  guest_id: number;
  guest_name: string;
  total_nights: number;
  credits_by_room_type: {
    id: number;
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}

interface CreditsBookingForm {
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  special_requests: string;
}

interface CreditsBookingSuccess {
  booking_id: number;
  booking_number: string;
  complimentary_nights: number;
}

interface GuestDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  guest: Guest | null;
  tab: number;
  onTabChange: (value: number) => void;
  guestCredits: GuestCredits | null;
  loadingCredits: boolean;
  creditsBookingSuccess: CreditsBookingSuccess | null;
  creditsBookingForm: CreditsBookingForm;
  availableRoomsForCredits: Room[];
  roomBlockedDates: unknown[];
  selectedComplimentaryDates: string[];
  bookingWithCredits: boolean;
  getCreditsBookingDates: () => string[];
  getTotalCreditsForRoom: (roomId: string) => number;
  isDateBlocked: (date: string) => boolean;
  onCheckInFromCreditsBooking: () => void;
  onBookAnother: () => void;
  onCheckInDateChange: (value: string) => void;
  onCheckOutDateChange: (value: string) => void;
  onRoomChange: (value: string) => void;
  onAdultsChange: (value: number) => void;
  onChildrenChange: (value: number) => void;
  onSelectAllAvailable: () => void;
  onToggleDate: (date: string) => void;
  onBookWithCredits: () => void;
}

const GuestDetailsDialog: React.FC<GuestDetailsDialogProps> = ({
  open,
  onClose,
  guest,
  tab,
  onTabChange,
  guestCredits,
  loadingCredits,
  creditsBookingSuccess,
  creditsBookingForm,
  availableRoomsForCredits,
  roomBlockedDates,
  selectedComplimentaryDates,
  bookingWithCredits,
  getCreditsBookingDates,
  getTotalCreditsForRoom,
  isDateBlocked,
  onCheckInFromCreditsBooking,
  onBookAnother,
  onCheckInDateChange,
  onCheckOutDateChange,
  onRoomChange,
  onAdultsChange,
  onChildrenChange,
  onSelectAllAvailable,
  onToggleDate,
  onBookWithCredits,
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
          <PersonIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {guest?.full_name || 'Guest Details'}
          </Typography>
        </Box>
      </DialogTitle>

      <Tabs
        value={tab}
        onChange={(_, v) => onTabChange(v)}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          px: 3,
          '& .MuiTab-root': {
            textTransform: 'none',
            fontSize: '0.95rem',
            fontWeight: 500,
            minHeight: 56,
            px: 3,
          }
        }}
      >
        <Tab label="Guest Info" icon={<PersonIcon />} iconPosition="start" />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>Free Gift Credits</span>
              {guestCredits && guestCredits.total_nights > 0 && (
                <Chip
                  label={guestCredits.total_nights}
                  size="small"
                  color="secondary"
                />
              )}
            </Box>
          }
          icon={<GiftIcon />}
          iconPosition="start"
        />
      </Tabs>

      <DialogContent sx={{ pt: 3, pb: 3, minHeight: 400 }}>
        {/* Tab 0: Guest Info */}
        {tab === 0 && guest && (
          <Grid container spacing={2}>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Email</Typography>
              <Typography variant="body2">{guest.email}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" color="text.secondary">Phone</Typography>
              <Typography variant="body2">{guest.phone || 'N/A'}</Typography>
            </Grid>
            {guest.address_line1 && (
              <Grid size={12}>
                <Typography variant="caption" color="text.secondary">Address</Typography>
                <Typography variant="body2">
                  {guest.address_line1}
                  {guest.city && `, ${guest.city}`}
                  {guest.state_province && `, ${guest.state_province}`}
                  {guest.postal_code && ` ${guest.postal_code}`}
                </Typography>
              </Grid>
            )}
            {guest.country && (
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Country</Typography>
                <Typography variant="body2">{guest.country}</Typography>
              </Grid>
            )}
            {guest.nationality && (
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Nationality</Typography>
                <Typography variant="body2">{guest.nationality}</Typography>
              </Grid>
            )}
            {guest.ic_number && (
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">IC Number</Typography>
                <Typography variant="body2">{guest.ic_number}</Typography>
              </Grid>
            )}
            {guest.company_name && (
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Company</Typography>
                <Typography variant="body2">{guest.company_name}</Typography>
              </Grid>
            )}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>
            <Grid size={12}>
              <Typography variant="caption" color="text.secondary">Member Since</Typography>
              <Typography variant="body2">
                {new Date(guest.created_at).toLocaleDateString()}
              </Typography>
            </Grid>
          </Grid>
        )}

        {/* Tab 1: Free Gift Credits */}
        {tab === 1 && (
          <Box>
            {loadingCredits ? (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
              </Box>
            ) : creditsBookingSuccess ? (
              /* Booking Success - Show Check-in Option */
              <Box>
                <Alert severity="success" sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    🎉 Booking Created Successfully!
                  </Typography>
                  <Typography variant="body2">
                    Booking #{creditsBookingSuccess.booking_number} - {creditsBookingSuccess.complimentary_nights} night(s) are complimentary
                  </Typography>
                </Alert>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    startIcon={<LoginIcon />}
                    onClick={onCheckInFromCreditsBooking}
                  >
                    Check In Now
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={onBookAnother}
                  >
                    Book Another Room
                  </Button>
                </Box>
              </Box>
            ) : (
              <Grid container spacing={3}>
                {/* Credits Summary */}
                <Grid size={12}>
                  <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <GiftIcon /> Available Free Gift Credits
                    </Typography>
                    {guestCredits && guestCredits.total_nights > 0 ? (
                      <Box>
                        {guestCredits.credits_by_room_type.map((credit) => (
                          <Chip
                            key={credit.id}
                            icon={<GiftIcon />}
                            label={`${credit.room_type_name}: ${credit.nights_available} night(s)`}
                            color="success"
                            sx={{ mr: 1, mb: 1 }}
                          />
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No complimentary credits available
                      </Typography>
                    )}
                  </Paper>
                </Grid>

                {/* Booking Form */}
                {guestCredits && guestCredits.total_nights > 0 && (
                  <>
                    <Grid size={12}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        Book a Room with Free Gift Credits
                      </Typography>
                    </Grid>

                    <Grid size={6}>
                      <TextField
                        label="Check-in Date"
                        type="date"
                        fullWidth
                        value={creditsBookingForm.check_in_date}
                        onChange={(e) => onCheckInDateChange(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                    <Grid size={6}>
                      <TextField
                        label="Check-out Date"
                        type="date"
                        fullWidth
                        value={creditsBookingForm.check_out_date}
                        onChange={(e) => onCheckOutDateChange(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>

                    <Grid size={12}>
                      <FormControl fullWidth>
                        <InputLabel>Select Room</InputLabel>
                        <Select
                          value={creditsBookingForm.room_id}
                          onChange={(e) => onRoomChange(e.target.value)}
                          label="Select Room"
                        >
                          {[...availableRoomsForCredits]
                            .sort((a, b) => {
                              const numA = parseInt(a.room_number, 10);
                              const numB = parseInt(b.room_number, 10);
                              if (!isNaN(numA) && !isNaN(numB)) {
                                return numA - numB;
                              }
                              return a.room_number.localeCompare(b.room_number);
                            })
                            .map((room) => (
                              <MenuItem key={room.id} value={room.id.toString()}>
                                Room {room.room_number} - {room.room_type}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                    </Grid>

                    {/* Date Selection for Complimentary Nights */}
                    {creditsBookingForm.room_id && getCreditsBookingDates().length > 0 && (
                      <Grid size={12}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Typography variant="subtitle2">
                            Select Complimentary Dates (Available: {getTotalCreditsForRoom(creditsBookingForm.room_id)})
                          </Typography>
                          <Button size="small" onClick={onSelectAllAvailable}>
                            Select All Available
                          </Button>
                        </Box>
                        <Paper variant="outlined" sx={{ p: 2, maxHeight: 180, overflow: 'auto' }}>
                          {roomBlockedDates.length > 0 && (
                            <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 12, height: 12, backgroundColor: 'error.light', borderRadius: 0.5 }} />
                              <Typography variant="caption" color="text.secondary">
                                Reserved (unavailable)
                              </Typography>
                            </Box>
                          )}
                          <FormGroup row>
                            {getCreditsBookingDates().map((date) => {
                              const isSelected = selectedComplimentaryDates.includes(date);
                              const isBlocked = isDateBlocked(date);
                              const canSelect = !isBlocked && (isSelected || selectedComplimentaryDates.length < getTotalCreditsForRoom(creditsBookingForm.room_id));

                              // Show blocked dates with a block icon instead of checkbox
                              if (isBlocked) {
                                return (
                                  <Box
                                    key={date}
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 0.5,
                                      backgroundColor: 'rgba(211, 47, 47, 0.12)',
                                      borderRadius: 1,
                                      mr: 1,
                                      mb: 1,
                                      px: 1,
                                      py: 0.5,
                                      border: '1px solid rgba(211, 47, 47, 0.4)',
                                      cursor: 'not-allowed',
                                    }}
                                  >
                                    <BlockIcon sx={{ fontSize: 18, color: 'error.main' }} />
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        textDecoration: 'line-through',
                                        color: 'error.main',
                                        fontSize: '0.85rem',
                                      }}
                                    >
                                      {new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </Typography>
                                  </Box>
                                );
                              }

                              return (
                                <FormControlLabel
                                  key={date}
                                  control={
                                    <Checkbox
                                      checked={isSelected}
                                      onChange={() => onToggleDate(date)}
                                      disabled={!canSelect && !isSelected}
                                      color="secondary"
                                    />
                                  }
                                  label={new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                  sx={{
                                    backgroundColor: isSelected ? 'rgba(156, 39, 176, 0.1)' : 'transparent',
                                    borderRadius: 1,
                                    mr: 1,
                                    mb: 1,
                                    px: 1,
                                  }}
                                />
                              );
                            })}
                          </FormGroup>
                        </Paper>
                        {selectedComplimentaryDates.length > 0 && (
                          <Alert severity="success" sx={{ mt: 1 }}>
                            {selectedComplimentaryDates.length} night(s) will be complimentary (Free Gift)
                          </Alert>
                        )}
                      </Grid>
                    )}

                    <Grid size={6}>
                      <TextField
                        label="Adults"
                        type="number"
                        fullWidth
                        value={creditsBookingForm.adults}
                        onChange={(e) => onAdultsChange(parseInt(e.target.value) || 1)}
                        inputProps={{ min: 1, max: 10 }}
                      />
                    </Grid>
                    <Grid size={6}>
                      <TextField
                        label="Children"
                        type="number"
                        fullWidth
                        value={creditsBookingForm.children}
                        onChange={(e) => onChildrenChange(parseInt(e.target.value) || 0)}
                        inputProps={{ min: 0, max: 10 }}
                      />
                    </Grid>

                    <Grid size={12}>
                      <Button
                        variant="contained"
                        color="secondary"
                        fullWidth
                        size="large"
                        startIcon={bookingWithCredits ? <CircularProgress size={20} color="inherit" /> : <GiftIcon />}
                        onClick={onBookWithCredits}
                        disabled={
                          bookingWithCredits ||
                          !creditsBookingForm.room_id ||
                          selectedComplimentaryDates.length === 0 ||
                          getCreditsBookingDates().length === 0
                        }
                      >
                        {bookingWithCredits ? 'Creating Booking...' : 'Book with Free Gift Credits'}
                      </Button>
                    </Grid>
                  </>
                )}
              </Grid>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestDetailsDialog;
