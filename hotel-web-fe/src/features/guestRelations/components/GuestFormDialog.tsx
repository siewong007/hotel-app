import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  ApartmentOutlined as CompanyIcon,
  BadgeOutlined as IdIcon,
  Cancel as CancelIcon,
  CheckCircleOutlined as CheckCircleIcon,
  Close as CloseIcon,
  LocationOnOutlined as LocationIcon,
  MailOutlined as MailIcon,
  Person as PersonIcon,
  PersonOutlined as NonMemberIcon,
  PhoneOutlined as PhoneIcon,
  PublicOutlined as PublicIcon,
  Save as SaveIcon,
  Star as MemberIcon,
} from '@mui/icons-material';
import {
  GUEST_TYPE_CONFIG,
  type Company,
  type GuestType,
  TOURISM_TYPE_CONFIG,
  type TourismType,
} from '../../../types';
import { GUEST_DESIGN } from '../../guests/constants';
import { useTranslation } from '../../../i18n/useTranslation';
import type { GuestFormData } from '../../guests/types';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useGuestCompanyOptions } from '../hooks/useGuestCompanyOptions';

interface GuestFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  guestName?: string;
  formData: GuestFormData;
  setFormData: React.Dispatch<React.SetStateAction<GuestFormData>>;
  error: string | null;
  loading: boolean;
  onErrorClose: () => void;
  onClose: () => void;
  onSubmit: () => void;
}

const guestInputSx = {
  '& .MuiOutlinedInput-root': {
    minHeight: 52,
    borderRadius: 1.1,
    bgcolor: 'background.paper',
    fontSize: 16,
    color: 'text.primary',
    '& fieldset': { borderColor: 'var(--hotel-border)' },
    '&:hover fieldset': { borderColor: 'var(--hotel-border-strong)' },
    '&.Mui-focused fieldset': {
      borderColor: GUEST_DESIGN.green600,
      borderWidth: 1,
    },
    '&.Mui-disabled': {
      bgcolor: 'action.disabledBackground',
    },
  },
  '& .MuiInputBase-input': {
    py: 1.45,
  },
  '& .MuiInputBase-input::placeholder': {
    color: 'text.secondary',
    opacity: 1,
  },
  '& .MuiInputAdornment-root .MuiSvgIcon-root': {
    color: 'text.secondary',
    fontSize: 22,
  },
  '& .MuiFormHelperText-root': {
    ml: 0,
    mt: 0.75,
    fontSize: 12.5,
    color: 'text.secondary',
  },
};

const GuestFormDialog: React.FC<GuestFormDialogProps> = ({
  open,
  mode,
  guestName,
  formData,
  setFormData,
  error,
  loading,
  onErrorClose,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation('guests');
  const isEdit = mode === 'edit';
  const title = isEdit ? t('form.editTitle', { name: guestName || t('form.guestFallback') }) : t('form.createTitle');
  const subtitle = isEdit ? t('form.editSubtitle') : t('form.createSubtitle');
  const primaryLabel = isEdit ? t('form.saveChanges') : t('form.createGuest');
  const [companySearch, setCompanySearch] = React.useState(formData.company_name || '');
  const debouncedCompanySearch = useDebouncedValue(companySearch, 250);
  const companyOptionsQuery = useGuestCompanyOptions(debouncedCompanySearch, open);
  const companyOptions = companyOptionsQuery.data ?? [];

  const updateField = <K extends keyof GuestFormData>(key: K, value: GuestFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  React.useEffect(() => {
    if (!open) return;
    setCompanySearch(formData.company_name || '');
  }, [formData.company_name, open]);

  const handleCompanyChange = (_event: React.SyntheticEvent, value: Company | string | null) => {
    const companyName = typeof value === 'string' ? value : value?.company_name || '';
    setCompanySearch(companyName);
    updateField('company_name', companyName);
  };

  const handleCompanyInputChange = (_event: React.SyntheticEvent, value: string) => {
    setCompanySearch(value);
    updateField('company_name', value);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      slotProps={{
        backdrop: {
          sx: { bgcolor: 'var(--hotel-scrim)', backdropFilter: 'blur(4px)' },
        },

        paper: {
          sx: {
            width: 'min(1112px, calc(100vw - 48px))',
            maxHeight: 'calc(100vh - 48px)',
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: 'background.paper',
            boxShadow: 'var(--hotel-shadow-lg)',
          },
        }
      }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.25, px: { xs: 3, md: 3.25 }, pt: { xs: 2.75, md: 3 }, pb: 1.75 }}>
        <Box sx={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: 'var(--hotel-hover)',
          color: 'var(--hotel-primary)',
          display: { xs: 'none', sm: 'grid' },
          placeItems: 'center',
          flexShrink: 0,
        }}>
          <PersonIcon sx={{ fontSize: 38, strokeWidth: 1.2 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, pt: 0.35 }}>
          <Typography sx={{ color: 'text.primary', fontSize: { xs: 24, sm: 30 }, fontWeight: 800, lineHeight: 1.12, letterSpacing: 0 }}>
            {title}
          </Typography>
          <Typography sx={{ mt: 0.8, color: 'text.secondary', fontSize: { xs: 15, sm: 18 }, lineHeight: 1.35 }}>
            {subtitle}
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          aria-label={t('form.closeAria')}
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1.25,
            border: '1px solid',
            borderColor: 'divider',
            color: 'text.secondary',
            flexShrink: 0,
            '&:hover': { bgcolor: 'var(--hotel-hover)' },
          }}
        >
          <CloseIcon sx={{ fontSize: 28 }} />
        </IconButton>
      </Box>
      <DialogContent sx={{ px: { xs: 3, md: 3.25 }, pt: 0.5, pb: 2.25, overflowY: 'auto' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={onErrorClose}>
            {error}
          </Alert>
        )}

        <Grid container spacing={{ xs: 1.8, md: 2.2 }}>
          <GuestDialogField
            label={t('form.firstName')}
            placeholder={t('form.firstName')}
            value={formData.first_name}
            onChange={(value) => updateField('first_name', value)}
            required
          />
          <GuestDialogField
            label={t('form.lastName')}
            placeholder={t('form.lastName')}
            value={formData.last_name}
            onChange={(value) => updateField('last_name', value)}
            required
          />
          <GuestDialogField
            label={t('form.email')}
            placeholder={t('form.email')}
            value={formData.email || ''}
            onChange={(value) => updateField('email', value)}
            type="email"
          />
          <GuestDialogField
            label={t('form.phone')}
            placeholder={t('form.phone')}
            type="tel"
            value={formData.phone || ''}
            onChange={(value) => updateField('phone', value)}
            icon={<PhoneIcon />}
            required={!formData.email?.trim()}
            helperText={!formData.email?.trim() ? t('form.phoneRequired') : undefined}
          />
          <GuestDialogField
            label={t('form.icNumber')}
            placeholder={t('form.icNumber')}
            value={formData.ic_number || ''}
            onChange={(value) => updateField('ic_number', value)}
            icon={<IdIcon />}
            helperText={t('form.icHelper')}
          />
          <GuestDialogField
            label={t('form.nationality')}
            placeholder={t('form.nationality')}
            value={formData.nationality || ''}
            onChange={(value) => updateField('nationality', value)}
            icon={<PublicIcon />}
          />
          <GuestCompanyField
            value={formData.company_name || ''}
            inputValue={companySearch}
            options={companyOptions}
            loading={companyOptionsQuery.isLoading || companyOptionsQuery.isFetching}
            onChange={handleCompanyChange}
            onInputChange={handleCompanyInputChange}
          />
          <GuestDialogField
            label={t('form.address')}
            placeholder={t('form.address')}
            value={formData.address_line1 || ''}
            onChange={(value) => updateField('address_line1', value)}
            icon={<LocationIcon />}
            size={{ xs: 12 }}
          />
          <GuestDialogField
            label={t('form.city')}
            placeholder={t('form.city')}
            value={formData.city || ''}
            onChange={(value) => updateField('city', value)}
            icon={<CompanyIcon />}
          />
          <GuestDialogField
            label={t('form.stateProvince')}
            placeholder={t('form.stateProvince')}
            value={formData.state_province || ''}
            onChange={(value) => updateField('state_province', value)}
            icon={<CompanyIcon />}
          />
          <GuestDialogField
            label={t('form.postalCode')}
            placeholder={t('form.postalCode')}
            value={formData.postal_code || ''}
            onChange={(value) => updateField('postal_code', value)}
            icon={<MailIcon />}
          />
          <GuestDialogField
            label={t('form.country')}
            placeholder={t('form.country')}
            value={formData.country || ''}
            onChange={(value) => updateField('country', value)}
            icon={<PublicIcon />}
          />

          <Grid size={12}>
            <GuestDialogSection
              icon={<CheckCircleIcon />}
              title={t('form.membershipSection')}
              tint={formData.guest_type === 'member' ? GUEST_DESIGN.gold : GUEST_DESIGN.green700}
            >
              <Grid container spacing={2.2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>{t('form.guestType')}</GuestDialogLabel>
                  <TextField
                    select
                    fullWidth
                    value={formData.guest_type || 'non_member'}
                    onChange={(e) => setFormData({
                      ...formData,
                      guest_type: e.target.value as GuestType,
                      discount_percentage: e.target.value === 'member' ? (formData.discount_percentage || 10) : 0,
                    })}
                    sx={guestInputSx}
                  >
                    <MenuItem value="non_member">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <NonMemberIcon sx={{ fontSize: 22, color: GUEST_TYPE_CONFIG.non_member.color }} />
                        {t('guestType.nonMemberOption')}
                      </Box>
                    </MenuItem>
                    <MenuItem value="member">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <MemberIcon sx={{ fontSize: 22, color: GUEST_DESIGN.gold }} />
                        {t('guestType.memberOption')}
                      </Box>
                    </MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>{t('form.discountPercentage')}</GuestDialogLabel>
                  <TextField
                    fullWidth
                    type="number"
                    value={formData.discount_percentage || 0}
                    onChange={(e) => updateField('discount_percentage', parseInt(e.target.value, 10) || 0)}
                    disabled={formData.guest_type !== 'member'}
                    sx={guestInputSx}
                    helperText={formData.guest_type === 'member' ? t('form.discountMemberHelp') : t('form.discountNonMemberHelp')}
                    slotProps={{
                      input: {
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      },

                      htmlInput: { min: 0, max: 100 }
                    }} />
                </Grid>
              </Grid>
            </GuestDialogSection>
          </Grid>

          <Grid size={12}>
            <GuestDialogSection
              icon={<PublicIcon />}
              title={t('form.tourismSection')}
              tint={formData.tourism_type === 'foreign' ? TOURISM_TYPE_CONFIG.foreign.color : GUEST_DESIGN.green700}
            >
              <Grid container spacing={2.2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>{t('form.tourismType')}</GuestDialogLabel>
                  <TextField
                    select
                    fullWidth
                    value={formData.tourism_type || ''}
                    onChange={(e) => updateField('tourism_type', e.target.value as TourismType || undefined)}
                    sx={guestInputSx}
                  >
                    <MenuItem value="" disabled={!isEdit}>
                      <Box sx={{ color: 'text.secondary' }}>{isEdit ? t('form.notSpecified') : t('form.selectTourism')}</Box>
                    </MenuItem>
                    <MenuItem value="local">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Chip label={t(TOURISM_TYPE_CONFIG.local.labelKey)} size="small" sx={{ bgcolor: 'var(--hotel-info-bg)', color: 'var(--hotel-info)', border: '1px solid var(--hotel-info-border)', fontWeight: 700, height: 24 }} />
                        {t(TOURISM_TYPE_CONFIG.local.taxLabelKey)}
                      </Box>
                    </MenuItem>
                    <MenuItem value="foreign">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Chip label={t(TOURISM_TYPE_CONFIG.foreign.labelKey)} size="small" sx={{ bgcolor: 'var(--hotel-warning-bg)', color: 'var(--hotel-warning)', border: '1px solid var(--hotel-warning-border)', fontWeight: 700, height: 24 }} />
                        {t(TOURISM_TYPE_CONFIG.foreign.taxLabelKey)}
                      </Box>
                    </MenuItem>
                  </TextField>
                </Grid>
              </Grid>
            </GuestDialogSection>
          </Grid>
        </Grid>
      </DialogContent>
      <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column-reverse', sm: 'row' },
        justifyContent: 'flex-end',
        gap: { xs: 1, sm: 2.5 },
        px: { xs: 3, md: 3.25 },
        py: 2,
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}>
        <Button
          onClick={onClose}
          startIcon={<CancelIcon />}
          sx={{
            minWidth: 140,
            width: { xs: '100%', sm: 'auto' },
            height: 52,
            borderRadius: 1.25,
            border: '1px solid var(--hotel-border-strong)',
            color: 'var(--hotel-primary)',
            fontWeight: 700,
            textTransform: 'none',
            '&:hover': { bgcolor: `color-mix(in srgb,  8%, transparent)`, borderColor: 'var(--hotel-primary)' },
          }}
        >
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={onSubmit}
          startIcon={loading ? undefined : <SaveIcon />}
          disabled={loading}
          sx={{
            minWidth: 194,
            width: { xs: '100%', sm: 'auto' },
            height: 52,
            borderRadius: 1.25,
            bgcolor: 'var(--hotel-primary)',
            color: 'var(--hotel-on-primary)',
            fontWeight: 800,
            textTransform: 'none',
            boxShadow: 'var(--hotel-shadow-md)',
            '&:hover': { bgcolor: 'var(--hotel-primary-active)' },
            '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'text.secondary' },
          }}
        >
          {loading ? <CircularProgress size={22} sx={{ color: 'var(--hotel-on-primary)' }} /> : primaryLabel}
        </Button>
      </Box>
    </Dialog>
  );
};

interface GuestDialogFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: string;
  icon?: React.ReactNode;
  required?: boolean;
  helperText?: string;
  size?: React.ComponentProps<typeof Grid>['size'];
}

const GuestDialogField: React.FC<GuestDialogFieldProps> = ({
  label,
  value,
  placeholder,
  onChange,
  type = 'text',
  icon,
  required,
  helperText,
  size = { xs: 12, md: 6 },
}) => (
  <Grid size={size}>
    <GuestDialogLabel>{label}</GuestDialogLabel>
    <TextField
      fullWidth
      required={required}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      sx={guestInputSx}
      helperText={helperText}
      slotProps={{
        input: icon ? {
          endAdornment: <InputAdornment position="end">{icon}</InputAdornment>,
        } : undefined
      }}
    />
  </Grid>
);

interface GuestCompanyFieldProps {
  value: string;
  inputValue: string;
  options: Company[];
  loading: boolean;
  onChange: (event: React.SyntheticEvent, value: Company | string | null) => void;
  onInputChange: (event: React.SyntheticEvent, value: string) => void;
}

const GuestCompanyField: React.FC<GuestCompanyFieldProps> = ({
  value,
  inputValue,
  options,
  loading,
  onChange,
  onInputChange,
}) => {
  const { t } = useTranslation('guests');
  return (
  <Grid size={{ xs: 12, md: 6 }}>
    <GuestDialogLabel>{t('form.companyName')}</GuestDialogLabel>
    <Autocomplete<Company, false, false, true>
      freeSolo
      selectOnFocus
      handleHomeEndKeys
      options={options}
      value={value}
      inputValue={inputValue}
      loading={loading}
      onChange={onChange}
      onInputChange={onInputChange}
      getOptionLabel={(option) => typeof option === 'string' ? option : option.company_name}
      isOptionEqualToValue={(option, selectedValue) =>
        typeof selectedValue !== 'string' && option.id === selectedValue.id
      }
      noOptionsText={inputValue.trim() ? t('form.noCompaniesMatch') : t('form.noCompanies')}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        return (
          <li key={key} {...otherProps}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, minWidth: 0 }}>
              <CompanyIcon color="action" fontSize="small" />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 15, lineHeight: 1.25 }}>
                  {option.company_name}
                </Typography>
                {option.contact_person && (
                  <Typography sx={{ color: 'text.secondary', fontSize: 12.5, lineHeight: 1.25 }}>
                    {option.contact_person}
                  </Typography>
                )}
              </Box>
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          fullWidth
          placeholder={t('form.companyName')}
          sx={guestInputSx}
          slotProps={{
            ...params.slotProps,

            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={20} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            }
          }}
        />
      )}
    />
  </Grid>
  );
};

const GuestDialogLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography sx={{ mb: 0.7, color: 'text.primary', fontSize: 14.5, fontWeight: 500, lineHeight: 1.2 }}>
    {children}
  </Typography>
);

interface GuestDialogSectionProps {
  icon: React.ReactNode;
  title: string;
  tint: string;
  children: React.ReactNode;
}

const GuestDialogSection: React.FC<GuestDialogSectionProps> = ({ icon, title, tint, children }) => (
  <Box sx={{
    mt: 0.35,
    p: { xs: 1.75, md: 2 },
    borderRadius: 1.25,
    border: '1px solid var(--hotel-border)',
    bgcolor: `color-mix(in srgb, ${tint} 4%, var(--hotel-surface))`,
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.35 }}>
      <Box sx={{ color: tint, display: 'inline-flex', '& svg': { fontSize: 26 } }}>
        {icon}
      </Box>
      <Typography sx={{ color: 'var(--hotel-primary-text)', fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>
        {title}
      </Typography>
    </Box>
    {children}
  </Box>
);

export default GuestFormDialog;
