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
} from '@mui/material';
import {
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { Guest } from '../../../types';

export interface NewGuestForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  nationality: string;
  ic_number: string;
}

export interface GuestWithCredits {
  id: number;
  full_name: string;
  email: string;
  legacy_complimentary_nights_credit: number;
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
                const totalCredits = option.legacy_complimentary_nights_credit + option.total_complimentary_credits;
                return option.email
                  ? `${option.full_name} - ${option.email} (${totalCredits} credits)`
                  : `${option.full_name} (${totalCredits} credits)`;
              }}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                const totalCredits = option.legacy_complimentary_nights_credit + option.total_complimentary_credits;
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
                          label={`${totalCredits} night${totalCredits !== 1 ? 's' : ''}`}
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
                          {option.legacy_complimentary_nights_credit > 0 && (
                            <Chip
                              label={`Any room: ${option.legacy_complimentary_nights_credit}`}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.65rem', height: 20 }}
                            />
                          )}
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
        </Grid>
      )}
    </Box>
  );
};

export default GuestSelector;
