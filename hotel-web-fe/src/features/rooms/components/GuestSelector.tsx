import React from 'react';
import {
  Box,
  Grid,
  TextField,
  Button,
  Stack,
  Typography,
  Chip,
  Alert,
  Autocomplete,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { Guest, TourismType, TOURISM_TYPE_CONFIG } from '../../../types';

export interface NewGuestForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  nationality: string;
  ic_number: string;
  tourism_type?: TourismType;
  address_line1: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
}

export interface GuestWithCredits {
  id: number;
  full_name: string;
  email: string;
  total_complimentary_credits: number;
  credits_by_room_type: {
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}

interface GuestSelectorProps {
  // For existing guest mode
  selectedGuest: Guest | null;
  onGuestSelect: (guest: Guest | null) => void;
  guests: Guest[];

  // For new guest mode
  newGuestForm: NewGuestForm;
  onNewGuestFormChange: (form: NewGuestForm) => void;
  isCreatingNew: boolean;
  onToggleMode: (isNew: boolean) => void;

  // Optional - for complimentary bookings
  filterByCredits?: boolean;
  guestsWithCredits?: GuestWithCredits[];
  selectedGuestWithCredits?: GuestWithCredits | null;
  onGuestWithCreditsSelect?: (guest: GuestWithCredits | null) => void;
  loadingGuestsWithCredits?: boolean;

  // Optional - callback when member is selected
  onMemberSelected?: (isMember: boolean) => void;
}

export const emptyNewGuestForm: NewGuestForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  nationality: '',
  ic_number: '',
  tourism_type: undefined,
  address_line1: '',
  city: '',
  state_province: '',
  postal_code: '',
  country: '',
};

const GuestSelector: React.FC<GuestSelectorProps> = ({
  selectedGuest,
  onGuestSelect,
  guests,
  newGuestForm,
  onNewGuestFormChange,
  isCreatingNew,
  onToggleMode,
  filterByCredits = false,
  guestsWithCredits = [],
  selectedGuestWithCredits = null,
  onGuestWithCreditsSelect,
  loadingGuestsWithCredits = false,
  onMemberSelected,
}) => {
  // Handle guest selection with member callback
  const handleGuestSelect = (guest: Guest | null) => {
    onGuestSelect(guest);
    if (onMemberSelected) {
      onMemberSelected(guest?.guest_type === 'member');
    }
  };

  // For complimentary bookings - show guests with credits
  if (filterByCredits) {
    return (
      <Box>
        {loadingGuestsWithCredits ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 2, gap: 1 }}>
            <CircularProgress size={24} />
            <Typography>Loading guests with credits...</Typography>
          </Box>
        ) : (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                This booking uses the guest's <strong>Free Room Credits</strong>. Only guests with available credits are shown below.
              </Typography>
            </Alert>
            <Autocomplete
              value={selectedGuestWithCredits}
              onChange={(_, newValue) => onGuestWithCreditsSelect?.(newValue)}
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
          </>
        )}
      </Box>
    );
  }

  // Standard guest selection with toggle
  return (
    <Box>
      {/* Toggle buttons */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button
          variant={!isCreatingNew ? 'contained' : 'outlined'}
          onClick={() => onToggleMode(false)}
          size="small"
        >
          Select Existing Guest
        </Button>
        <Button
          variant={isCreatingNew ? 'contained' : 'outlined'}
          onClick={() => onToggleMode(true)}
          size="small"
        >
          Register New Guest
        </Button>
      </Stack>

      {/* Existing Guest Selection */}
      {!isCreatingNew && (
        <Box>
          <Autocomplete
            value={selectedGuest}
            onChange={(_, newValue) => handleGuestSelect(newValue)}
            options={guests}
            getOptionLabel={(option) =>
              option.email ? `${option.full_name} - ${option.email}` : option.full_name
            }
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2">{option.full_name}</Typography>
                    {option.email && <Typography variant="caption" color="text.secondary">{option.email}</Typography>}
                  </Box>
                  {option.guest_type === 'member' && (
                    <Chip
                      label="Member"
                      size="small"
                      color="success"
                      sx={{ fontSize: '0.65rem', height: 20 }}
                    />
                  )}
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Guest *"
                placeholder="Search by name or email"
              />
            )}
          />
          {/* Member indicator */}
          {selectedGuest?.guest_type === 'member' && (
            <Alert severity="success" sx={{ mt: 1 }} icon={<GiftIcon />}>
              <Typography variant="body2">
                <strong>{selectedGuest.full_name}</strong> is a Member — Room card deposit is <strong>waived</strong>
              </Typography>
            </Alert>
          )}
        </Box>
      )}

      {/* New Guest Registration Form */}
      {isCreatingNew && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              required
              label="First Name"
              value={newGuestForm.first_name}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, first_name: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              required
              label="Last Name"
              value={newGuestForm.last_name}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, last_name: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={newGuestForm.email}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, email: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Phone"
              value={newGuestForm.phone}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, phone: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="IC/Passport Number"
              value={newGuestForm.ic_number}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, ic_number: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Nationality"
              value={newGuestForm.nationality}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, nationality: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Tourism Type</InputLabel>
              <Select
                value={newGuestForm.tourism_type || ''}
                label="Tourism Type"
                onChange={(e) => onNewGuestFormChange({ ...newGuestForm, tourism_type: e.target.value as TourismType || undefined })}
              >
                <MenuItem value="">
                  <em>Not specified</em>
                </MenuItem>
                <MenuItem value="local">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={TOURISM_TYPE_CONFIG.local.label} size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.local.color, color: 'white' }} />
                    <Typography variant="body2" color="text.secondary">{TOURISM_TYPE_CONFIG.local.taxLabel}</Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="foreign">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={TOURISM_TYPE_CONFIG.foreign.label} size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.foreign.color, color: 'white' }} />
                    <Typography variant="body2" color="text.secondary">{TOURISM_TYPE_CONFIG.foreign.taxLabel}</Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Address"
              value={newGuestForm.address_line1}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, address_line1: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="City"
              value={newGuestForm.city}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, city: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="State/Province"
              value={newGuestForm.state_province}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, state_province: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Postal Code"
              value={newGuestForm.postal_code}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, postal_code: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Country"
              value={newGuestForm.country}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, country: e.target.value })}
            />
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default GuestSelector;
