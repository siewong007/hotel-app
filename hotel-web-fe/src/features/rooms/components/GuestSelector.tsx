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
  createFilterOptions,
  FormControl,
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  CardGiftcard as GiftIcon,
  Star as MemberIcon,
} from '@mui/icons-material';
import { Guest, GuestType, TourismType, GUEST_TYPE_CONFIG } from '../../../types';
import { LogoLoader } from '../../../components';
import CollapsibleSection from '../../../components/common/CollapsibleSection';
import { useTranslation } from '../../../i18n/useTranslation';

export interface NewGuestForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  nationality: string;
  ic_number: string;
  tourism_type?: TourismType;
  guest_type?: GuestType;
  company_name: string;
  address_line1: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
}

export interface GuestWithCredits {
  id: number;
  nick_name: string;
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
  /** Options to offer. When `onGuestSearchChange` is supplied these are already
   *  server-filtered results, not the whole guest table. */
  guests: Guest[];
  /** Supply to search server-side: the component stops filtering `guests`
   *  itself and reports what the user types instead. Without it the old
   *  client-side filter is used (the complimentary-credits path still does). */
  onGuestSearchChange?: (query: string) => void;
  /** Spinner in the picker while a server search is in flight. */
  loadingGuests?: boolean;
  /** Shown when a server search returned nothing. */
  guestNoOptionsText?: string;

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
  guestCreditsNoOptionsText?: string;

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
  // Deliberately unset: tourism type drives tourism tax, so staff pick it
  // explicitly rather than inheriting a silent 'local' default.
  tourism_type: undefined,
  guest_type: 'non_member',
  company_name: '',
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
  onGuestSearchChange,
  loadingGuests = false,
  guestNoOptionsText,
  newGuestForm,
  onNewGuestFormChange,
  isCreatingNew,
  onToggleMode,
  filterByCredits = false,
  guestsWithCredits = [],
  selectedGuestWithCredits = null,
  onGuestWithCreditsSelect,
  loadingGuestsWithCredits = false,
  guestCreditsNoOptionsText,
  onMemberSelected,
}) => {
  const { t } = useTranslation('rooms');
  const guestFilterOptions = React.useMemo(
    () =>
      createFilterOptions<Guest>({
        stringify: (option) =>
          [
            option.id,
            option.nick_name,
            option.company_name,
            option.email,
            option.phone,
            option.ic_number,
          ]
            .filter(Boolean)
            .join(' '),
      }),
    []
  );

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
            <LogoLoader variant="inline" label={t('guestSelector.loadingCredits')} />
          </Box>
        ) : (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                {t('guestSelector.creditsInfoPre')} <strong>{t('guestSelector.creditsInfoEmphasis')}</strong>{t('guestSelector.creditsInfoPost')}
              </Typography>
            </Alert>
            <Autocomplete
              value={selectedGuestWithCredits}
              onChange={(_, newValue) => onGuestWithCreditsSelect?.(newValue)}
              options={guestsWithCredits}
              getOptionLabel={(option) => {
                const credits = t('guestSelector.credits', { count: option.total_complimentary_credits });
                return option.email
                  ? t('guestSelector.optionLabelEmail', { name: option.nick_name, email: option.email, credits })
                  : t('guestSelector.optionLabel', { name: option.nick_name, credits });
              }}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                return (
                  <Box component="li" key={key} {...otherProps}>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body1">{option.nick_name}</Typography>
                          {option.email && <Typography variant="caption" sx={{
                            color: "text.secondary"
                          }}>{option.email}</Typography>}
                        </Box>
                        <Chip
                          icon={<GiftIcon sx={{ fontSize: 14 }} />}
                          label={t('guestSelector.nights', { count: option.total_complimentary_credits })}
                          size="small"
                          color="secondary"
                        />
                      </Box>
                      {option.credits_by_room_type.length > 0 && (
                        <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {option.credits_by_room_type.map((credit) => (
                            <Chip
                              key={credit.room_type_id}
                              label={t('guestSelector.creditByType', { type: credit.room_type_name, count: credit.nights_available })}
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
                  label={t('guestSelector.selectWithCredits')}
                  placeholder={t('guestSelector.searchPlaceholder')}
                />
              )}
              noOptionsText={guestCreditsNoOptionsText ?? t('guestSelector.noCredits')}
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
          {t('guestSelector.selectExisting')}
        </Button>
        <Button
          variant={isCreatingNew ? 'contained' : 'outlined'}
          onClick={() => onToggleMode(true)}
          size="small"
        >
          {t('guestSelector.registerNew')}
        </Button>
      </Stack>
      {/* Existing Guest Selection */}
      {!isCreatingNew && (
        <Box>
          <Autocomplete
            value={selectedGuest}
            onChange={(_, newValue) => handleGuestSelect(newValue)}
            options={guests}
            // Server-searched: MUI must not filter the page it was given, or a
            // result the backend matched on a field the label omits (phone, IC)
            // would be hidden again.
            filterOptions={onGuestSearchChange ? (options) => options : guestFilterOptions}
            onInputChange={onGuestSearchChange
              ? (_, value, reason) => { if (reason === 'input') onGuestSearchChange(value); }
              : undefined}
            loading={loadingGuests}
            loadingText={t('guestSelector.searching')}
            noOptionsText={onGuestSearchChange ? guestNoOptionsText : undefined}
            getOptionLabel={(option) => {
              const parts = [option.nick_name];
              if (option.company_name) parts.push(`(${option.company_name})`);
              if (option.email) parts.push(`- ${option.email}`);
              return parts.join(' ');
            }}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={option.id || key} {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2">
                      {option.nick_name}
                      {option.company_name && (
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            color: "primary.main",
                            ml: 0.5
                          }}>
                          ({option.company_name})
                        </Typography>
                      )}
                    </Typography>
                    {option.email && <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>{option.email}</Typography>}
                  </Box>
                  {option.guest_type === 'member' && (
                    <Chip
                      label={t('guestSelector.memberChip')}
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
                label={t('guestSelector.selectGuest')}
                placeholder={t('guestSelector.searchPlaceholder')}
              />
            )}
          />
          {/* Member indicator */}
          {selectedGuest?.guest_type === 'member' && (
            <Alert severity="success" sx={{ mt: 1 }} icon={<GiftIcon />}>
              <Typography variant="body2">
                <strong>{selectedGuest.nick_name}</strong> {t('guestSelector.memberAlertMid')} <strong>{t('guestSelector.waived')}</strong>
              </Typography>
            </Alert>
          )}
        </Box>
      )}
      {/* New Guest Registration Form */}
      {isCreatingNew && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              required
              label={t('guestSelector.firstName')}
              value={newGuestForm.first_name}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, first_name: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('guestSelector.lastName')}
              helperText={t('guestSelector.lastNameHint')}
              value={newGuestForm.last_name}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, last_name: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('guestSelector.email')}
              type="email"
              value={newGuestForm.email}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, email: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              type="tel"
              label={t('guestSelector.phone')}
              helperText={t('guestSelector.phoneHint')}
              value={newGuestForm.phone}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, phone: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('guestSelector.icNumber')}
              helperText={t('guestSelector.icNumberHint')}
              value={newGuestForm.ic_number}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, ic_number: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('guestSelector.nationality')}
              value={newGuestForm.nationality}
              onChange={(e) => onNewGuestFormChange({ ...newGuestForm, nationality: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth required error={!newGuestForm.tourism_type}>
              <InputLabel>{t('guestSelector.tourismType')}</InputLabel>
              <Select
                value={newGuestForm.tourism_type ?? ''}
                label={t('guestSelector.tourismType')}
                onChange={(e) => onNewGuestFormChange({ ...newGuestForm, tourism_type: e.target.value as TourismType || undefined })}
              >
                <MenuItem value="local">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={t('guestSelector.tourismLocal')} size="small" sx={{ bgcolor: 'var(--hotel-info-bg)', color: 'var(--hotel-info)', border: '1px solid var(--hotel-info-border)' }} />
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('guestSelector.tourismLocalTax')}</Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="foreign">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={t('guestSelector.tourismForeign')} size="small" sx={{ bgcolor: 'var(--hotel-warning-bg)', color: 'var(--hotel-warning)', border: '1px solid var(--hotel-warning-border)' }} />
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('guestSelector.tourismForeignTax')}</Typography>
                  </Box>
                </MenuItem>
              </Select>
              <FormHelperText>
                {newGuestForm.tourism_type
                  ? t('guestSelector.tourismHintSet')
                  : t('guestSelector.tourismHintRequired')}
              </FormHelperText>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth>
              <InputLabel>{t('guestSelector.guestType')}</InputLabel>
              <Select
                value={newGuestForm.guest_type || 'non_member'}
                label={t('guestSelector.guestType')}
                onChange={(e) => {
                  const guestType = e.target.value as GuestType;
                  onNewGuestFormChange({ ...newGuestForm, guest_type: guestType });
                  if (onMemberSelected) {
                    onMemberSelected(guestType === 'member');
                  }
                }}
              >
                <MenuItem value="non_member">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={t('guestSelector.nonMember')} size="small" sx={{ bgcolor: 'var(--hotel-neutral-bg)', color: 'var(--hotel-neutral)', border: '1px solid var(--hotel-neutral-border)' }} />
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('guestSelector.nonMemberRate')}</Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="member">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <MemberIcon sx={{ color: GUEST_TYPE_CONFIG.member.color, fontSize: 18 }} />
                    <Chip label={t('guestSelector.member')} size="small" sx={{ bgcolor: 'var(--hotel-success-bg)', color: 'var(--hotel-success)', border: '1px solid var(--hotel-success-border)' }} />
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('guestSelector.memberDiscount')}</Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {/* Member benefits alert */}
          {newGuestForm.guest_type === 'member' && (
            <Grid size={12}>
              <Alert severity="success" icon={<MemberIcon />}>
                <Typography variant="body2">
                  {t('guestSelector.registeringAs')} <strong>{t('guestSelector.member')}</strong> {t('guestSelector.depositWillBe')} <strong>{t('guestSelector.waived')}</strong>
                </Typography>
              </Alert>
            </Grid>
          )}
          {/* Non-required detail fields — collapsed behind a header tap on
              phones to keep the new-guest form short. Values are controlled
              via newGuestForm, so unmounting the body loses nothing. */}
          <Grid size={12}>
            <CollapsibleSection title={t('guestSelector.additionalDetails')} collapseOnPhone>
              <Grid container spacing={2} sx={{ pt: 1 }}>
                <Grid size={12}>
                  <TextField
                    fullWidth
                    label={t('guestSelector.address')}
                    value={newGuestForm.address_line1}
                    onChange={(e) => onNewGuestFormChange({ ...newGuestForm, address_line1: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guestSelector.city')}
                    value={newGuestForm.city}
                    onChange={(e) => onNewGuestFormChange({ ...newGuestForm, city: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guestSelector.stateProvince')}
                    value={newGuestForm.state_province}
                    onChange={(e) => onNewGuestFormChange({ ...newGuestForm, state_province: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guestSelector.postalCode')}
                    value={newGuestForm.postal_code}
                    onChange={(e) => onNewGuestFormChange({ ...newGuestForm, postal_code: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guestSelector.country')}
                    value={newGuestForm.country}
                    onChange={(e) => onNewGuestFormChange({ ...newGuestForm, country: e.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label={t('guestSelector.companyName')}
                    value={newGuestForm.company_name}
                    onChange={(e) => onNewGuestFormChange({ ...newGuestForm, company_name: e.target.value })}
                    placeholder={t('guestSelector.companyPlaceholder')}
                  />
                </Grid>
              </Grid>
            </CollapsibleSection>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default GuestSelector;
