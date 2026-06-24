import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Box,
  Typography,
  Alert,
  Divider,
  Chip,
  Autocomplete,
  CircularProgress,
  InputAdornment,
  MenuItem,
} from '@mui/material';
import {
  Login as CheckInIcon,
  Business as BusinessIcon,
  PersonAdd as PersonAddIcon,
  Person as PersonIcon,
  Hotel as HotelIcon,
} from '@mui/icons-material';
import type { Company, Guest, Room, BookingWithDetails } from '../../../../../types';
import { formatDateForDisplay } from '../helpers';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';

export interface NewCheckInGuestForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  ic_number: string;
  tourism_type: string;
  nationality: string;
  address_line1: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
}

interface CompanyCheckInDialogProps {
  // Dialog state
  open: boolean;
  onClose: () => void;
  // Form values and setters
  checkInCompany: Company | null;
  onCompanyChange: (newValue: Company | null) => void;
  isCreatingNewCheckInGuest: boolean;
  setIsCreatingNewCheckInGuest: React.Dispatch<React.SetStateAction<boolean>>;
  checkInGuest: Guest | null;
  setCheckInGuest: React.Dispatch<React.SetStateAction<Guest | null>>;
  newCheckInGuestForm: NewCheckInGuestForm;
  setNewCheckInGuestForm: React.Dispatch<React.SetStateAction<NewCheckInGuestForm>>;
  checkInDate: string;
  onCheckInDateChange: (newDate: string) => void;
  checkOutDate: string;
  onCheckOutDateChange: (newDate: string) => void;
  checkInRoom: Room | null;
  setCheckInRoom: React.Dispatch<React.SetStateAction<Room | null>>;
  customRoomRate: string;
  setCustomRoomRate: React.Dispatch<React.SetStateAction<string>>;
  // Lookup data
  companies: Company[];
  guests: Guest[];
  availableRooms: Room[];
  companyBookings: BookingWithDetails[];
  // Submission callback and submitting state
  processingCheckIn: boolean;
  onSubmit: () => void;
  // Derived display values
  currencySymbol: string;
  formatCurrency: (value: number) => string;
}

const CompanyCheckInDialog: React.FC<CompanyCheckInDialogProps> = ({
  open,
  onClose,
  checkInCompany,
  onCompanyChange,
  isCreatingNewCheckInGuest,
  setIsCreatingNewCheckInGuest,
  checkInGuest,
  setCheckInGuest,
  newCheckInGuestForm,
  setNewCheckInGuestForm,
  checkInDate,
  onCheckInDateChange,
  checkOutDate,
  onCheckOutDateChange,
  checkInRoom,
  setCheckInRoom,
  customRoomRate,
  setCustomRoomRate,
  companies,
  guests,
  availableRooms,
  companyBookings,
  processingCheckIn,
  onSubmit,
  currencySymbol,
  formatCurrency,
}) => {
  const selectedRoomDefaultRate = checkInRoom ? toMoneyNumber(checkInRoom.price_per_night) : 0;
  const customRateValue = customRoomRate.trim() ? toMoneyNumber(customRoomRate) : undefined;
  const effectiveRoomRate = customRateValue !== undefined && isPositiveMoney(customRateValue)
    ? customRateValue
    : selectedRoomDefaultRate;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>
      <Box display="flex" alignItems="center" gap={1}>
        <CheckInIcon color="success" />
        Company Check-In
      </Box>
    </DialogTitle>
    <DialogContent>
      <Grid container spacing={3} sx={{ mt: 0.5 }}>
        {/* Company Selection */}
        <Grid size={12}>
          <Autocomplete
            value={checkInCompany}
            onChange={(event, newValue) => onCompanyChange(newValue)}
            options={companies}
            getOptionLabel={(option) => option.company_name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <li key={key} {...otherProps}>
                  <Box>
                    <Typography fontWeight="medium">{option.company_name}</Typography>
                    {option.contact_person && (
                      <Typography variant="caption" color="text.secondary">
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
                required
                label="Select Company"
                placeholder="Search for a company"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <BusinessIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        </Grid>

        {/* Company Info */}
        {checkInCompany && (
          <Grid size={12}>
            <Alert severity="info" icon={<BusinessIcon />}>
              <Typography variant="subtitle2">{checkInCompany.company_name}</Typography>
              {checkInCompany.contact_person && (
                <Typography variant="body2">Contact: {checkInCompany.contact_person}</Typography>
              )}
              {checkInCompany.contact_email && (
                <Typography variant="body2">Email: {checkInCompany.contact_email}</Typography>
              )}
              {companyBookings.length > 0 && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Active Bookings: {companyBookings.filter(b => b.status === 'checked_in').length}
                </Typography>
              )}
            </Alert>
          </Grid>
        )}

        <Grid size={12}>
          <Divider>
            <Chip label="Guest Details" size="small" />
          </Divider>
        </Grid>

        {/* Guest Selection */}
        <Grid size={12}>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Button
              variant={!isCreatingNewCheckInGuest ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setIsCreatingNewCheckInGuest(false)}
            >
              Select Existing Guest
            </Button>
            <Button
              variant={isCreatingNewCheckInGuest ? 'contained' : 'outlined'}
              size="small"
              startIcon={<PersonAddIcon />}
              onClick={() => setIsCreatingNewCheckInGuest(true)}
            >
              New Guest
            </Button>
          </Box>

          {!isCreatingNewCheckInGuest ? (
            <Autocomplete
              value={checkInGuest}
              onChange={(event, newValue) => setCheckInGuest(newValue)}
              options={guests}
              getOptionLabel={(option) => option.full_name}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                return (
                  <li key={key} {...otherProps}>
                    <Box>
                      <Typography>{option.full_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.email} {option.phone && `| ${option.phone}`}
                      </Typography>
                    </Box>
                  </li>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select Guest"
                  placeholder="Search for a guest"
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <>
                        <PersonIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                        {params.InputProps.startAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          ) : (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="First Name"
                  value={newCheckInGuestForm.first_name}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, first_name: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="Last Name"
                  value={newCheckInGuestForm.last_name}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, last_name: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={newCheckInGuestForm.email}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, email: e.target.value })}
                  helperText="Used for sending booking confirmations and invoices"
                  error={newCheckInGuestForm.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCheckInGuestForm.email)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={newCheckInGuestForm.phone}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, phone: e.target.value })}
                  required={!newCheckInGuestForm.email.trim()}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  required
                  label="IC/Passport Number"
                  value={newCheckInGuestForm.ic_number}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, ic_number: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Nationality"
                  value={newCheckInGuestForm.nationality}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, nationality: e.target.value })}
                  placeholder="e.g. Malaysian"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  select
                  label="Tourism Type"
                  value={newCheckInGuestForm.tourism_type || 'local'}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, tourism_type: e.target.value })}
                >
                  <MenuItem value="local">Local - no tourism tax</MenuItem>
                  <MenuItem value="foreign">Foreign - tourism tax applies</MenuItem>
                </TextField>
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Address"
                  value={newCheckInGuestForm.address_line1}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, address_line1: e.target.value })}
                  placeholder="Street address"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="City"
                  value={newCheckInGuestForm.city}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, city: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="State/Province"
                  value={newCheckInGuestForm.state_province}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, state_province: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Postal Code"
                  value={newCheckInGuestForm.postal_code}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, postal_code: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Country"
                  value={newCheckInGuestForm.country}
                  onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, country: e.target.value })}
                />
              </Grid>
            </Grid>
          )}
        </Grid>

        <Grid size={12}>
          <Divider>
            <Chip label="Room & Dates" size="small" />
          </Divider>
        </Grid>

        {/* Dates */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            label="Check-In Date"
            type="date"
            value={checkInDate}
            onChange={(e) => onCheckInDateChange(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            label="Check-Out Date"
            type="date"
            value={checkOutDate}
            onChange={(e) => onCheckOutDateChange(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: checkInDate }}
          />
        </Grid>

        {/* Room Selection */}
        <Grid size={12}>
          <Autocomplete
            value={checkInRoom}
            onChange={(event, newValue) => {
              setCheckInRoom(newValue);
              setCustomRoomRate('');
            }}
            options={availableRooms}
            getOptionLabel={(option) => `Room ${option.room_number} - ${option.room_type}`}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              const price = toMoneyNumber(option.price_per_night);
              return (
                <li key={key} {...otherProps}>
                  <Box display="flex" justifyContent="space-between" width="100%">
                    <Box>
                      <Typography fontWeight="medium">Room {option.room_number}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.room_type} | Max: {option.max_occupancy} guests
                      </Typography>
                    </Box>
                    <Typography color="primary.main" fontWeight="medium">
                      {formatCurrency(price)}/night
                    </Typography>
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                required
                label="Select Room"
                placeholder="Choose an available room"
                helperText={availableRooms.length === 0 ? 'No rooms available for selected dates' : `${availableRooms.length} room(s) available`}
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <HotelIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        </Grid>

        {checkInRoom && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Room Rate"
              type="number"
              value={customRoomRate}
              onChange={(e) => setCustomRoomRate(e.target.value)}
              placeholder={Number.isFinite(selectedRoomDefaultRate) ? selectedRoomDefaultRate.toFixed(2) : ''}
              helperText={`Default ${formatCurrency(selectedRoomDefaultRate)} / night`}
              InputProps={{
                startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
              }}
              inputProps={{
                min: 0.01,
                step: 0.01,
              }}
            />
          </Grid>
        )}

        {/* Summary */}
        {checkInCompany && checkInRoom && (checkInGuest || (isCreatingNewCheckInGuest && newCheckInGuestForm.first_name)) && (
          <Grid size={12}>
            <Alert severity="success">
              <Typography variant="subtitle2">Ready to Check-In</Typography>
              <Typography variant="body2">
                Guest: {isCreatingNewCheckInGuest ? `${newCheckInGuestForm.first_name} ${newCheckInGuestForm.last_name}` : checkInGuest?.full_name}
              </Typography>
              <Typography variant="body2">
                Email: {isCreatingNewCheckInGuest ? newCheckInGuestForm.email : checkInGuest?.email}
              </Typography>
              <Typography variant="body2">
                Room: {checkInRoom.room_number} ({checkInRoom.room_type})
              </Typography>
              <Typography variant="body2">
                Rate: {formatCurrency(effectiveRoomRate)} / night
              </Typography>
              <Typography variant="body2">
                Company: {checkInCompany.company_name}
              </Typography>
              <Typography variant="body2">
                Dates: {formatDateForDisplay(checkInDate)} to {formatDateForDisplay(checkOutDate)}
              </Typography>
            </Alert>
          </Grid>
        )}
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>
        Cancel
      </Button>
      <Button
        onClick={onSubmit}
        variant="contained"
        color="success"
        disabled={
          processingCheckIn ||
          !checkInCompany ||
          !checkInRoom ||
          (!checkInGuest && !isCreatingNewCheckInGuest) ||
          (isCreatingNewCheckInGuest && (
            !newCheckInGuestForm.first_name ||
            !newCheckInGuestForm.last_name ||
            !newCheckInGuestForm.ic_number.trim() ||
            (!newCheckInGuestForm.email.trim() && !newCheckInGuestForm.phone.trim()) ||
            Boolean(newCheckInGuestForm.email && newCheckInGuestForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCheckInGuestForm.email))
          ))
        }
        startIcon={processingCheckIn ? <CircularProgress size={20} /> : <CheckInIcon />}
      >
        {processingCheckIn ? 'Processing...' : 'Check-In Guest'}
      </Button>
    </DialogActions>
    </Dialog>
  );
};

export default CompanyCheckInDialog;
