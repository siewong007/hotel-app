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
import { LogoLoader } from '../../../../../components';
import { Guest, Room } from '../../../../../types';
import { useTranslation } from '../../../../../i18n/useTranslation';
import { intlTag } from '../../../../../i18n/format';
import { formatHotelDate, parseLocalDate } from '../../../../../utils/date';

const formatStayDay = (value: string): string =>
  parseLocalDate(value).toLocaleDateString(intlTag(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

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
  const { t } = useTranslation('rooms');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'var(--hotel-on-primary)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PersonIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {guest?.nick_name || t('guestDetails.title')}
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
        <Tab label={t('guestDetails.tabInfo')} icon={<PersonIcon />} iconPosition="start" />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>{t('guestDetails.tabCredits')}</span>
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
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{t('common:field.email')}</Typography>
              <Typography variant="body2">{guest.email}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{t('common:field.phone')}</Typography>
              <Typography variant="body2">{guest.phone || 'N/A'}</Typography>
            </Grid>
            {guest.address_line1 && (
              <Grid size={12}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('common:field.address')}</Typography>
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
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('bookings:checkInForm.personal.country')}</Typography>
                <Typography variant="body2">{guest.country}</Typography>
              </Grid>
            )}
            {guest.nationality && (
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('bookings:checkInForm.personal.nationality')}</Typography>
                <Typography variant="body2">{guest.nationality}</Typography>
              </Grid>
            )}
            {guest.ic_number && (
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('guestDetails.icNumber')}</Typography>
                <Typography variant="body2">{guest.ic_number}</Typography>
              </Grid>
            )}
            {guest.company_name && (
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('guestDetails.company')}</Typography>
                <Typography variant="body2">{guest.company_name}</Typography>
              </Grid>
            )}
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>
            <Grid size={12}>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{t('guestDetails.memberSince')}</Typography>
              <Typography variant="body2">
                {formatHotelDate(guest.created_at)}
              </Typography>
            </Grid>
          </Grid>
        )}

        {/* Tab 1: Free Gift Credits */}
        {tab === 1 && (
          <Box>
            {loadingCredits ? (
              <LogoLoader variant="page" minHeight={120} />
            ) : creditsBookingSuccess ? (
              /* Booking Success - Show Check-in Option */
              (<Box>
                <Alert severity="success" sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" sx={{
                    fontWeight: 600
                  }}>
                    {t('guestDetails.bookingCreated')}
                  </Typography>
                  <Typography variant="body2">
                    {t('guestDetails.bookingCreatedDetail', { number: creditsBookingSuccess.booking_number, count: creditsBookingSuccess.complimentary_nights })}
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
                    {t('bookings:checkIn.checkInNow')}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={onBookAnother}
                  >
                    {t('guestDetails.bookAnother')}
                  </Button>
                </Box>
              </Box>)
            ) : (
              <Grid container spacing={3}>
                {/* Credits Summary */}
                <Grid size={12}>
                  <Paper sx={{ p: 2, bgcolor: 'secondary.light' }}>
                    <Typography
                      variant="subtitle1"
                      gutterBottom
                      sx={{
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                      }}>
                      <GiftIcon /> {t('guestDetails.availableCredits')}
                    </Typography>
                    {guestCredits && guestCredits.total_nights > 0 ? (
                      <Box>
                        {guestCredits.credits_by_room_type.map((credit) => (
                          <Chip
                            key={credit.id}
                            icon={<GiftIcon />}
                            label={`${credit.room_type_name}: ${t('guestDetails.creditNights', { count: credit.nights_available })}`}
                            color="success"
                            sx={{ mr: 1, mb: 1 }}
                          />
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {t('guestDetails.noCredits')}
                      </Typography>
                    )}
                  </Paper>
                </Grid>

                {/* Booking Form */}
                {guestCredits && guestCredits.total_nights > 0 && (
                  <>
                    <Grid size={12}>
                      <Typography variant="subtitle1" sx={{
                        fontWeight: 600
                      }}>
                        {t('guestDetails.bookWithCreditsTitle')}
                      </Typography>
                    </Grid>

                    <Grid size={6}>
                      <TextField
                        label={t('complimentary.checkInDate')}
                        type="date"
                        fullWidth
                        value={creditsBookingForm.check_in_date}
                        onChange={(e) => onCheckInDateChange(e.target.value)}
                        slotProps={{
                          inputLabel: { shrink: true }
                        }}
                      />
                    </Grid>
                    <Grid size={6}>
                      <TextField
                        label={t('complimentary.checkOutDate')}
                        type="date"
                        fullWidth
                        value={creditsBookingForm.check_out_date}
                        onChange={(e) => onCheckOutDateChange(e.target.value)}
                        slotProps={{
                          inputLabel: { shrink: true }
                        }}
                      />
                    </Grid>

                    <Grid size={12}>
                      <FormControl fullWidth>
                        <InputLabel>{t('guestDetails.selectRoom')}</InputLabel>
                        <Select
                          value={creditsBookingForm.room_id}
                          onChange={(e) => onRoomChange(e.target.value)}
                          label={t('guestDetails.selectRoom')}
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
                                {t('guestDetails.roomOption', { number: room.room_number, type: room.room_type })}
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
                            {t('guestDetails.selectCompDates', { count: getTotalCreditsForRoom(creditsBookingForm.room_id) })}
                          </Typography>
                          <Button size="small" onClick={onSelectAllAvailable}>
                            {t('guestDetails.selectAllAvailable')}
                          </Button>
                        </Box>
                        <Paper variant="outlined" sx={{ p: 2, maxHeight: 180, overflow: 'auto' }}>
                          {roomBlockedDates.length > 0 && (
                            <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ width: 12, height: 12, backgroundColor: 'error.light', borderRadius: 0.5 }} />
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>
                                {t('guestDetails.reservedUnavailable')}
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
                                      backgroundColor: 'var(--hotel-danger-bg)',
                                      borderRadius: 1,
                                      mr: 1,
                                      mb: 1,
                                      px: 1,
                                      py: 0.5,
                                      border: '1px solid var(--hotel-danger-border)',
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
                                      {formatStayDay(date)}
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
                                  label={formatStayDay(date)}
                                  sx={{
                                    backgroundColor: isSelected ? 'var(--hotel-selected)' : 'transparent',
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
                            {t('guestDetails.compNightsInfo', { count: selectedComplimentaryDates.length })}
                          </Alert>
                        )}
                      </Grid>
                    )}

                    <Grid size={6}>
                      <TextField
                        label={t('bookings:checkInForm.stay.adults')}
                        type="number"
                        fullWidth
                        value={creditsBookingForm.adults}
                        onChange={(e) => onAdultsChange(parseInt(e.target.value) || 1)}
                        slotProps={{
                          htmlInput: { min: 1, max: 10 }
                        }}
                      />
                    </Grid>
                    <Grid size={6}>
                      <TextField
                        label={t('guestDetails.children')}
                        type="number"
                        fullWidth
                        value={creditsBookingForm.children}
                        onChange={(e) => onChildrenChange(parseInt(e.target.value) || 0)}
                        slotProps={{
                          htmlInput: { min: 0, max: 10 }
                        }}
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
                        {bookingWithCredits ? t('guestDetails.creatingBooking') : t('guestDetails.bookWithCredits')}
                      </Button>
                    </Grid>
                  </>
                )}
              </Grid>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestDetailsDialog;
