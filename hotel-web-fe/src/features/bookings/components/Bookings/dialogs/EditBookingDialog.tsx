import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { Business as BusinessIcon } from '@mui/icons-material';
import type { BookingEditFormData, BookingWithDetails, Room, RoomType } from '../../../../../types';
import { RoomsService } from '../../../../../api';
import { ReportsService, type BookingChannel } from '../../../../../api/reports.service';
import { queryKeys } from '../../../../../api/queryKeys';
import { queryStaleTime } from '../../../../../api/queryConfig';
import { useAuth } from '../../../../../auth/AuthContext';
import { useCurrency } from '../../../../../hooks/useCurrency';
import { useActiveCompanies, useUpdateBooking } from '../../../hooks/useBookingQueries';
import { isPositiveMoney, multiplyMoney, subtractMoney, toMoneyNumber } from '../../../../../utils/money';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import {
  getErrorMessage,
  sortRoomsByNumber,
  type BookingCompanyOption,
} from '../../../utils/bookingPageUtils';

interface EditBookingDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  rooms: Room[];
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

// Edit Booking Dialog (Admin Only)
const EditBookingDialog: React.FC<EditBookingDialogProps> = ({ open, booking, rooms, onClose, onError, onCompleted }) => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage');
  const updateBookingMutation = useUpdateBooking();

  const [editFormData, setEditFormData] = useState<BookingEditFormData>({});
  const [editRoomTypeConfig, setEditRoomTypeConfig] = useState<RoomType | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [bookingChannels, setBookingChannels] = useState<BookingChannel[]>([]);
  const [updating, setUpdating] = useState(false);

  const activeCompaniesQuery = useActiveCompanies(isAdmin && open);
  const activeCompanies: BookingCompanyOption[] = useMemo(
    () => activeCompaniesQuery.data ?? [],
    [activeCompaniesQuery.data]
  );
  const selectedEditCompany = useMemo<BookingCompanyOption | null>(() => {
    const companyName = String(editFormData.company_name || '').trim();
    const companyId = editFormData.company_id == null || editFormData.company_id === ''
      ? null
      : Number(editFormData.company_id);

    if (!companyId && !companyName) return null;

    const matchedCompany = activeCompanies.find((company) => (
      (companyId != null && company.id === companyId)
      || (companyName !== '' && company.company_name.toLowerCase() === companyName.toLowerCase())
    ));

    return matchedCompany || { id: companyId ?? undefined, company_name: companyName };
  }, [activeCompanies, editFormData.company_id, editFormData.company_name]);

  useEffect(() => {
    if (!isAdmin) return;
    ReportsService.listBookingChannels()
      .then((channels) => setBookingChannels(channels.filter((channel) => channel.is_active)))
      .catch(() => setBookingChannels([]));
  }, [isAdmin]);

  const selectedEditBookingChannel = useMemo(() => {
    const channelId = editFormData.booking_channel_id == null || editFormData.booking_channel_id === ''
      ? null
      : Number(editFormData.booking_channel_id);
    return bookingChannels.find((channel) => channel.id === channelId) || null;
  }, [bookingChannels, editFormData.booking_channel_id]);

  const editBookingUsesOta = selectedEditBookingChannel?.channel_type === 'ota'
    || String(editFormData.source || '').toLowerCase() === 'online';

  // Initialise the form from the booking each time the dialog opens.
  useEffect(() => {
    if (!open || !booking) return;

    // Get the booking's room rate (price_per_night) - this contains the override if one was set
    const bookingRate = toMoneyNumber(booking.price_per_night);

    setEditFormData({
      status: booking.status,
      payment_status: booking.payment_status || 'unpaid',
      payment_method: booking.payment_method
        ? booking.payment_method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : '',
      source: booking.source || 'walk_in',
      booking_channel_id: booking.booking_channel_id ?? '',
      ota_reference: booking.ota_reference || '',
      check_in_date: booking.check_in_date.split('T')[0],
      check_out_date: booking.check_out_date.split('T')[0],
      // Actual checkout date (date portion only) — editable so staff can correct
      // a backdated / mis-recorded stay. Empty until the booking is checked out.
      actual_check_out: booking.actual_check_out ? booking.actual_check_out.split('T')[0] : '',
      post_type: booking.post_type || 'normal_stay',
      rate_code: booking.rate_code || 'RACK',
      deposit_paid: booking.deposit_paid || false,
      remarks: booking.remarks || '',
      special_requests: booking.special_requests || '',
      // Use the booking's room rate directly (this is the override rate if one was set)
      price_per_night: bookingRate,
      has_override: isPositiveMoney(bookingRate),
      extra_bed_count: booking.extra_bed_count || 0,
      extra_bed_charge: toMoneyNumber(booking.extra_bed_charge),
      room_id: booking.room_id,
      company_id: booking.company_id ?? null,
      company_name: booking.company_name || '',
    });

    // Load room type config for extra bed settings
    queryClient.ensureQueryData({
      queryKey: queryKeys.roomTypes.list(),
      queryFn: () => RoomsService.getAllRoomTypes(),
      staleTime: queryStaleTime.long,
    }).then(roomTypes => {
      const matched = roomTypes.find(rt => rt.name === booking.room_type);
      setEditRoomTypeConfig(matched || null);
    }).catch(() => setEditRoomTypeConfig(null));
  }, [open, booking, queryClient]);

  // Re-fetch available rooms when dates change in the edit dialog (this also
  // covers the initial load when the form dates are first populated).
  useEffect(() => {
    if (!open || !booking) return;
    const checkInDate = editFormData.check_in_date;
    const checkOutDate = editFormData.check_out_date;
    if (!checkInDate || !checkOutDate) return;
    const isNotCheckedIn = !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(booking.status);
    if (!isNotCheckedIn) return;

    const bookingId = typeof booking.id === 'string' ? parseInt(booking.id, 10) : booking.id;
    queryClient.ensureQueryData({
      queryKey: queryKeys.rooms.available(checkInDate, checkOutDate, bookingId),
      queryFn: () => RoomsService.getAvailableRoomsForDates(checkInDate, checkOutDate, bookingId),
      staleTime: queryStaleTime.short,
    }).then(available => {
      setAvailableRooms(sortRoomsByNumber(available));
    }).catch(() => {
      // Fallback: show all rooms
      setAvailableRooms(sortRoomsByNumber(rooms));
    });
  }, [open, booking, editFormData.check_in_date, editFormData.check_out_date, queryClient, rooms]);

  const handleUpdateBooking = async () => {
    if (!booking) return;

    try {
      setUpdating(true);

      // Get the original booking rate
      const originalPrice = toMoneyNumber(booking.price_per_night);

      const newPrice = toMoneyNumber(editFormData.price_per_night);
      const priceChanged = isPositiveMoney(Math.abs(subtractMoney(newPrice, originalPrice)));

      // Include room_id only if it changed (compare as strings to avoid type mismatch)
      const roomChanged = editFormData.room_id && String(editFormData.room_id) !== String(booking.room_id);
      const companyCleared = Boolean(booking.company_id || booking.company_name) &&
        !editFormData.company_id &&
        !String(editFormData.company_name || '').trim();

      const updateData = {
        ...editFormData,
        payment_method: editFormData.payment_method || null,
        // Always send room_rate_override if there's a price value
        room_rate_override: isPositiveMoney(newPrice) ? newPrice : undefined,
        extra_bed_count: editFormData.extra_bed_count || 0,
        extra_bed_charge: editFormData.extra_bed_charge || 0,
        company_id: editFormData.company_id || undefined,
        company_name: String(editFormData.company_name || '').trim() || undefined,
        clear_company: companyCleared || undefined,
      };
      // Remove fields that are not valid backend fields
      delete updateData.price_per_night;
      delete updateData.has_override;
      if (!editFormData.booking_channel_id) {
        delete updateData.booking_channel_id;
      }
      if (!String(editFormData.ota_reference || '').trim()) {
        delete updateData.ota_reference;
      }
      // Only send actual_check_out when a value is set; an empty string would
      // fail backend date parsing and must not clobber the stored timestamp.
      if (!editFormData.actual_check_out) {
        delete updateData.actual_check_out;
      }
      // Only include room_id if room was changed, and send as string for backend compatibility
      if (roomChanged) {
        updateData.room_id = String(editFormData.room_id);
      } else {
        delete updateData.room_id;
      }

      await updateBookingMutation.mutateAsync({ bookingId: booking.id, data: updateData });
      emitApiNotification({ severity: 'success', message: 'Booking updated successfully!' });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to update booking');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Booking #{booking?.folio_number || booking?.id.toString().substring(0, 8)}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Check-In Date"
              type="date"
              value={editFormData.check_in_date || ''}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, check_in_date: e.target.value }))}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Scheduled Check-Out Date"
              type="date"
              value={editFormData.check_out_date || ''}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, check_out_date: e.target.value }))}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>
          {(['checked_out', 'late_checkout', 'completed'].includes(editFormData.status || '') || booking?.actual_check_out) && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Actual Check-Out Date"
                type="date"
                value={editFormData.actual_check_out || ''}
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, actual_check_out: e.target.value }))}
                helperText="The date the guest actually checked out (shown on the invoice)"
                slotProps={{
                  inputLabel: { shrink: true }
                }}
              />
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              fullWidth
              label="Status"
              value={editFormData.status || 'pending'}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, status: e.target.value }))}

            >
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="confirmed">Confirmed</MenuItem>
              <MenuItem value="checked_in">Checked In</MenuItem>
              <MenuItem value="auto_checked_in">Auto Checked In</MenuItem>
              <MenuItem value="checked_out">Checked Out</MenuItem>
              <MenuItem value="late_checkout">Late Checkout</MenuItem>
              <MenuItem value="voided">Voided</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              fullWidth
              label="Channel"
              value={editFormData.source || 'walk_in'}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, source: e.target.value }))}
            >
              <MenuItem value="walk_in">Walk-in</MenuItem>
              <MenuItem value="phone">Phone Reservation</MenuItem>
              <MenuItem value="direct">Direct Booking</MenuItem>
              <MenuItem value="online">Online (OTA)</MenuItem>
              <MenuItem value="website">Website</MenuItem>
              <MenuItem value="mobile">Mobile App</MenuItem>
              <MenuItem value="agent">Travel Agent</MenuItem>
              <MenuItem value="corporate">Corporate</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              fullWidth
              label="Booking Platform"
              value={editFormData.booking_channel_id || ''}
              onChange={(e) => {
                const channel = bookingChannels.find((item) => String(item.id) === e.target.value);
                setEditFormData((prev: BookingEditFormData) => ({
                  ...prev,
                  booking_channel_id: e.target.value ? Number(e.target.value) : '',
                  source: channel?.channel_type === 'ota' ? 'online' : prev.source,
                }));
              }}
            >
              <MenuItem value="">None</MenuItem>
              {bookingChannels.map((channel) => (
                <MenuItem key={channel.id} value={channel.id}>
                  {channel.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          {editBookingUsesOta && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="OTA Ref No"
                value={editFormData.ota_reference || ''}
                onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, ota_reference: e.target.value }))}
              />
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6 }}>
            <Autocomplete<BookingCompanyOption>
              options={activeCompanies}
              value={selectedEditCompany}
              loading={activeCompaniesQuery.isLoading || activeCompaniesQuery.isFetching}
              onChange={(_, company) => setEditFormData((prev: BookingEditFormData) => ({
                ...prev,
                company_id: company?.id ?? null,
                company_name: company?.company_name || '',
              }))}
              getOptionLabel={(option) => option.company_name}
              isOptionEqualToValue={(option, value) => {
                if (option.id != null && value.id != null) return option.id === value.id;
                return option.company_name.toLowerCase() === value.company_name.toLowerCase();
              }}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                return (
                  <li key={key} {...otherProps}>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BusinessIcon color="action" fontSize="small" />
                        <Typography>{option.company_name}</Typography>
                      </Box>
                      {option.contact_person && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: "text.secondary",
                            ml: 3.5
                          }}>
                          Contact: {option.contact_person}
                        </Typography>
                      )}
                    </Box>
                  </li>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Company (optional)"
                  placeholder="Search company (optional)"
                  helperText="Leave empty for normal guest billing."
                  slotProps={{
                    ...params.slotProps,

                    input: {
                      ...params.slotProps.input,
                      startAdornment: (
                        <>
                          <BusinessIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                          {params.slotProps.input.startAdornment}
                        </>
                      ),
                      endAdornment: (
                        <>
                          {(activeCompaniesQuery.isLoading || activeCompaniesQuery.isFetching) ? (
                            <CircularProgress color="inherit" size={18} />
                          ) : null}
                          {params.slotProps.input.endAdornment}
                        </>
                      ),
                    }
                  }}
                />
              )}
            />
          </Grid>
          {/* Payment Status is intentionally read-only here. It's derived
              live from the payments table on every list query, and any
              override the user types in this form is wiped on the next
              payment touch (record/refund/void/total change). Use the
              "Accept Payment" or "Take Payment" actions to record real
              payment rows — those flip the chip automatically. */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Room Rate (Before Tax)"
              type="number"
              value={editFormData.price_per_night || 0}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({
                ...prev,
                price_per_night: toMoneyNumber(e.target.value),
              }))}
              helperText="Rate per night (before tax) - modifying will recalculate total"
              slotProps={{
                input: {
                  startAdornment: <span style={{ marginRight: 4 }}>RM</span>,
                }
              }}
            />
          </Grid>
          {editRoomTypeConfig?.allows_extra_bed && (editRoomTypeConfig?.max_extra_beds || 0) > 0 && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Number of Extra Beds"
                  type="number"
                  value={editFormData.extra_bed_count || 0}
                  onChange={(e) => {
                    const maxBeds = editRoomTypeConfig?.max_extra_beds || 0;
                    const chargePerBed = editRoomTypeConfig ? toMoneyNumber(editRoomTypeConfig.extra_bed_charge) : 0;
                    const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxBeds);
                    setEditFormData((prev: BookingEditFormData) => ({
                      ...prev,
                      extra_bed_count: count,
                      extra_bed_charge: multiplyMoney(chargePerBed, count),
                    }));
                  }}
                  helperText={`${formatCurrency(
                    toMoneyNumber(editRoomTypeConfig?.extra_bed_charge)
                  )} per extra bed (max ${editRoomTypeConfig?.max_extra_beds || 0})`}
                  slotProps={{
                    htmlInput: { min: 0, max: editRoomTypeConfig?.max_extra_beds || 0 }
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Extra Bed Charge"
                  type="number"
                  value={editFormData.extra_bed_charge || 0}
                  onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({
                    ...prev,
                    extra_bed_charge: toMoneyNumber(e.target.value),
                  }))}
                  helperText="Auto-calculated or manually adjust"
                  slotProps={{
                    input: {
                      startAdornment: <span style={{ marginRight: 4 }}>RM</span>,
                    }
                  }}
                />
              </Grid>
            </>
          )}
          <Grid size={12}>
            <TextField
              fullWidth
              label="Notes / Remarks"
              multiline
              rows={2}
              value={editFormData.remarks || ''}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Enter any notes or remarks for this booking..."
            />
          </Grid>
          <Grid size={12}>
            <TextField
              fullWidth
              label="Special Requests"
              multiline
              rows={2}
              value={editFormData.special_requests || ''}
              onChange={(e) => setEditFormData((prev: BookingEditFormData) => ({ ...prev, special_requests: e.target.value }))}
              placeholder="Enter any special requests..."
            />
          </Grid>
          {booking && !['checked_in', 'auto_checked_in', 'checked_out', 'completed'].includes(booking.status) ? (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  fullWidth
                  label="Assigned Room"
                  value={editFormData.room_id || ''}
                  onChange={(e) => {
                    const selectedRoom = availableRooms.find(r => r.id === e.target.value);
                    const newRate = selectedRoom
                      ? toMoneyNumber(selectedRoom.price_per_night)
                      : editFormData.price_per_night;
                    setEditFormData((prev: BookingEditFormData) => ({
                      ...prev,
                      room_id: e.target.value,
                      price_per_night: newRate,
                    }));
                  }}
                >
                  {availableRooms.map((room) => (
                    <MenuItem key={room.id} value={room.id}>
                      Room {room.room_number} - {room.room_type} ({formatCurrency(toMoneyNumber(room.price_per_night))}/night)
                      {room.id === booking.room_id ? ' (current)' : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Alert severity="info" sx={{ height: '100%', display: 'flex', alignItems: 'center' }}>
                  Guest: <strong>{booking?.guest_name}</strong>
                </Alert>
              </Grid>
            </>
          ) : (
            <Grid size={12}>
              <Alert severity="info">
                Guest: <strong>{booking?.guest_name}</strong><br />
                Room: <strong>{booking?.room_type} - Room {booking?.room_number}</strong>
              </Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleUpdateBooking} variant="contained" disabled={updating}>
          {updating ? 'Updating...' : 'Update Booking'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditBookingDialog;
