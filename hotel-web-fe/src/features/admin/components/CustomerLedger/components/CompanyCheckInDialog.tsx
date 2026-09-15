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
import { useTranslation } from '../../../../../i18n';

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
  const { t } = useTranslation('finance');
  const selectedRoomDefaultRate = checkInRoom ? toMoneyNumber(checkInRoom.price_per_night) : 0;
  const customRateValue = customRoomRate.trim() ? toMoneyNumber(customRoomRate) : undefined;
  const effectiveRoomRate = customRateValue !== undefined && isPositiveMoney(customRateValue)
    ? customRateValue
    : selectedRoomDefaultRate;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1
          }}>
          <CheckInIcon color="success" />
          {t('ledger.checkin.title')}
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
                      <Typography sx={{
                        fontWeight: "medium"
                      }}>{option.company_name}</Typography>
                      {option.contact_person && (
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          {t('ledger.field.contactPerson')}: {option.contact_person}
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
                  label={t('ledger.checkin.selectCompany')}
                  placeholder={t('ledger.checkin.companyPlaceholder')}
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
                    }
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
                  <Typography variant="body2">{t('ledger.field.contactPerson')}: {checkInCompany.contact_person}</Typography>
                )}
                {checkInCompany.contact_email && (
                  <Typography variant="body2">{t('common:field.email')}: {checkInCompany.contact_email}</Typography>
                )}
                {companyBookings.length > 0 && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {t('ledger.checkin.activeBookings', { count: companyBookings.filter(b => b.status === 'checked_in').length })}
                  </Typography>
                )}
              </Alert>
            </Grid>
          )}

          <Grid size={12}>
            <Divider>
              <Chip label={t('ledger.checkin.guestDetails')} size="small" />
            </Divider>
          </Grid>

          {/* Guest Selection */}
          <Grid size={12}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                mb: 2
              }}>
              <Button
                variant={!isCreatingNewCheckInGuest ? 'contained' : 'outlined'}
                size="small"
                onClick={() => setIsCreatingNewCheckInGuest(false)}
              >
                {t('ledger.checkin.selectExisting')}
              </Button>
              <Button
                variant={isCreatingNewCheckInGuest ? 'contained' : 'outlined'}
                size="small"
                startIcon={<PersonAddIcon />}
                onClick={() => setIsCreatingNewCheckInGuest(true)}
              >
                {t('ledger.checkin.newGuest')}
              </Button>
            </Box>

            {!isCreatingNewCheckInGuest ? (
              <Autocomplete
                value={checkInGuest}
                onChange={(event, newValue) => setCheckInGuest(newValue)}
                options={guests}
                getOptionLabel={(option) => option.nick_name}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  return (
                    <li key={key} {...otherProps}>
                      <Box>
                        <Typography>{option.nick_name}</Typography>
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          {option.email} {option.phone && `| ${option.phone}`}
                        </Typography>
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('ledger.checkin.selectGuest')}
                    placeholder={t('ledger.checkin.guestPlaceholder')}
                    slotProps={{
                      ...params.slotProps,

                      input: {
                        ...params.slotProps.input,
                        startAdornment: (
                          <>
                            <PersonIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                            {params.slotProps.input.startAdornment}
                          </>
                        ),
                      }
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
                    label={t('guests:form.firstName')}
                    value={newCheckInGuestForm.first_name}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, first_name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label={t('guests:form.lastName')}
                    value={newCheckInGuestForm.last_name}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, last_name: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('common:field.email')}
                    type="email"
                    value={newCheckInGuestForm.email}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, email: e.target.value })}
                    helperText={t('ledger.checkin.emailHelp')}
                    error={newCheckInGuestForm.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCheckInGuestForm.email)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    type="tel"
                    label={t('common:field.phone')}
                    value={newCheckInGuestForm.phone}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, phone: e.target.value })}
                    required={!newCheckInGuestForm.email.trim()}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    required
                    label={t('ledger.checkin.icNumber')}
                    value={newCheckInGuestForm.ic_number}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, ic_number: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guests:form.nationality')}
                    value={newCheckInGuestForm.nationality}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, nationality: e.target.value })}
                    placeholder={t('ledger.checkin.nationalityPlaceholder')}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    select
                    label={t('guests:form.tourismType')}
                    value={newCheckInGuestForm.tourism_type || 'local'}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, tourism_type: e.target.value })}
                  >
                    <MenuItem value="local">{t('guests:tourismType.local')} - {t('guests:tourismType.noTax')}</MenuItem>
                    <MenuItem value="foreign">{t('guests:tourismType.foreign')} - {t('guests:tourismType.taxApplies')}</MenuItem>
                  </TextField>
                </Grid>
                <Grid size={12}>
                  <TextField
                    fullWidth
                    label={t('common:field.address')}
                    value={newCheckInGuestForm.address_line1}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, address_line1: e.target.value })}
                    placeholder={t('ledger.checkin.addressPlaceholder')}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('ledger.field.city')}
                    value={newCheckInGuestForm.city}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, city: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guests:form.stateProvince')}
                    value={newCheckInGuestForm.state_province}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, state_province: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('ledger.field.postalCode')}
                    value={newCheckInGuestForm.postal_code}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, postal_code: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guests:form.country')}
                    value={newCheckInGuestForm.country}
                    onChange={(e) => setNewCheckInGuestForm({ ...newCheckInGuestForm, country: e.target.value })}
                  />
                </Grid>
              </Grid>
            )}
          </Grid>

          <Grid size={12}>
            <Divider>
              <Chip label={t('ledger.checkin.roomDates')} size="small" />
            </Divider>
          </Grid>

          {/* Dates */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              required
              label={t('ledger.checkin.checkInDate')}
              type="date"
              value={checkInDate}
              onChange={(e) => onCheckInDateChange(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              required
              label={t('ledger.checkin.checkOutDate')}
              type="date"
              value={checkOutDate}
              onChange={(e) => onCheckOutDateChange(e.target.value)}
              slotProps={{
                htmlInput: { min: checkInDate },
                inputLabel: { shrink: true }
              }} />
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
              getOptionLabel={(option) => t('ledger.roomOption', { number: option.room_number, type: option.room_type })}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                const price = toMoneyNumber(option.price_per_night);
                return (
                  <li key={key} {...otherProps}>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        width: "100%"
                      }}>
                      <Box>
                        <Typography sx={{
                          fontWeight: "medium"
                        }}>{t('ledger.roomWithNumber', { number: option.room_number })}</Typography>
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          {option.room_type} | {t('ledger.checkin.maxGuests', { count: option.max_occupancy })}
                        </Typography>
                      </Box>
                      <Typography
                        sx={{
                          color: "primary.main",
                          fontWeight: "medium"
                        }}>
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
                  label={t('ledger.checkin.selectRoom')}
                  placeholder={t('ledger.checkin.roomPlaceholder')}
                  helperText={availableRooms.length === 0 ? t('ledger.checkin.noRooms') : t('ledger.checkin.roomsAvailable', { count: availableRooms.length })}
                  slotProps={{
                    ...params.slotProps,

                    input: {
                      ...params.slotProps.input,
                      startAdornment: (
                        <>
                          <HotelIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                          {params.slotProps.input.startAdornment}
                        </>
                      ),
                    }
                  }}
                />
              )}
            />
          </Grid>

          {checkInRoom && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('ledger.checkin.roomRate')}
                type="number"
                value={customRoomRate}
                onChange={(e) => setCustomRoomRate(e.target.value)}
                placeholder={Number.isFinite(selectedRoomDefaultRate) ? selectedRoomDefaultRate.toFixed(2) : ''}
                helperText={t('ledger.checkin.rateDefault', { amount: formatCurrency(selectedRoomDefaultRate) })}
                slotProps={{
                  input: {
                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                  },

                  htmlInput: {
                    min: 0.01,
                    step: 0.01,
                  }
                }} />
            </Grid>
          )}

          {/* Summary */}
          {checkInCompany && checkInRoom && (checkInGuest || (isCreatingNewCheckInGuest && newCheckInGuestForm.first_name)) && (
            <Grid size={12}>
              <Alert severity="success">
                <Typography variant="subtitle2">{t('ledger.checkin.ready')}</Typography>
                <Typography variant="body2">
                  {t('ledger.checkin.summaryGuest', { name: isCreatingNewCheckInGuest ? `${newCheckInGuestForm.first_name} ${newCheckInGuestForm.last_name}` : checkInGuest?.nick_name })}
                </Typography>
                <Typography variant="body2">
                  {t('ledger.checkin.summaryEmail', { email: isCreatingNewCheckInGuest ? newCheckInGuestForm.email : checkInGuest?.email })}
                </Typography>
                <Typography variant="body2">
                  {t('ledger.checkin.summaryRoom', { number: checkInRoom.room_number, type: checkInRoom.room_type })}
                </Typography>
                <Typography variant="body2">
                  {t('ledger.checkin.summaryRate', { amount: formatCurrency(effectiveRoomRate) })}
                </Typography>
                <Typography variant="body2">
                  {t('ledger.checkin.summaryCompany', { name: checkInCompany.company_name })}
                </Typography>
                <Typography variant="body2">
                  {t('ledger.checkin.summaryDates', { from: formatDateForDisplay(checkInDate), to: formatDateForDisplay(checkOutDate) })}
                </Typography>
              </Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {t('common:actions.cancel')}
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
          {processingCheckIn ? t('common:state.processing') : t('ledger.checkin.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CompanyCheckInDialog;
