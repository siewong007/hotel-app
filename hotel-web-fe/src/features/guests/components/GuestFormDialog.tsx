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
  alpha,
} from '@mui/material';
import {
  ApartmentOutlined as CompanyIcon,
  BadgeOutlined as IdIcon,
  Cancel as CancelIcon,
  CheckCircleOutline as CheckCircleIcon,
  Close as CloseIcon,
  LocationOnOutlined as LocationIcon,
  MailOutline as MailIcon,
  Person as PersonIcon,
  PersonOutline as NonMemberIcon,
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
import { GUEST_DESIGN } from '../constants';
import type { GuestFormData } from '../types';
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
    '& fieldset': { borderColor: '#d6dde2' },
    '&:hover fieldset': { borderColor: '#aeb9bf' },
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
  const isEdit = mode === 'edit';
  const title = isEdit ? `Edit Guest · ${guestName || 'Guest'}` : 'Create Guest';
  const subtitle = isEdit
    ? 'Update guest profile, membership and tourism details.'
    : 'Add guest profile, membership and tourism details.';
  const primaryLabel = isEdit ? 'Save Changes' : 'Create Guest';
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
      PaperProps={{
        sx: {
          width: 'min(1112px, calc(100vw - 48px))',
          maxHeight: 'calc(100vh - 48px)',
          borderRadius: 3,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          boxShadow: '0 26px 70px rgba(15, 23, 42, 0.28)',
        },
      }}
      BackdropProps={{
        sx: { bgcolor: 'rgba(17, 24, 39, 0.62)', backdropFilter: 'blur(4px)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.25, px: { xs: 3, md: 3.25 }, pt: { xs: 2.75, md: 3 }, pb: 1.75 }}>
        <Box sx={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: 'var(--hotel-muted-bg)',
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
          aria-label="Close guest dialog"
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1.25,
            border: '1px solid',
            borderColor: 'divider',
            color: 'text.secondary',
            flexShrink: 0,
            '&:hover': { bgcolor: '#f6f8f9' },
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
            label="First Name"
            placeholder="First Name"
            value={formData.first_name}
            onChange={(value) => updateField('first_name', value)}
            required
          />
          <GuestDialogField
            label="Last Name"
            placeholder="Last Name"
            value={formData.last_name}
            onChange={(value) => updateField('last_name', value)}
            required
          />
          <GuestDialogField
            label="Email"
            placeholder="Email"
            value={formData.email || ''}
            onChange={(value) => updateField('email', value)}
            type="email"
          />
          <GuestDialogField
            label="Phone"
            placeholder="Phone"
            value={formData.phone || ''}
            onChange={(value) => updateField('phone', value)}
            icon={<PhoneIcon />}
            required={!formData.email?.trim()}
            helperText={!formData.email?.trim() ? 'Required if email is blank' : undefined}
          />
          <GuestDialogField
            label="IC Number / Passport"
            placeholder="IC Number / Passport"
            value={formData.ic_number || ''}
            onChange={(value) => updateField('ic_number', value)}
            icon={<IdIcon />}
            helperText="Optional — can be collected at check-in"
          />
          <GuestDialogField
            label="Nationality"
            placeholder="Nationality"
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
            label="Address"
            placeholder="Address"
            value={formData.address_line1 || ''}
            onChange={(value) => updateField('address_line1', value)}
            icon={<LocationIcon />}
            size={{ xs: 12 }}
          />
          <GuestDialogField
            label="City"
            placeholder="City"
            value={formData.city || ''}
            onChange={(value) => updateField('city', value)}
            icon={<CompanyIcon />}
          />
          <GuestDialogField
            label="State/Province"
            placeholder="State/Province"
            value={formData.state_province || ''}
            onChange={(value) => updateField('state_province', value)}
            icon={<CompanyIcon />}
          />
          <GuestDialogField
            label="Postal Code"
            placeholder="Postal Code"
            value={formData.postal_code || ''}
            onChange={(value) => updateField('postal_code', value)}
            icon={<MailIcon />}
          />
          <GuestDialogField
            label="Country"
            placeholder="Country"
            value={formData.country || ''}
            onChange={(value) => updateField('country', value)}
            icon={<PublicIcon />}
          />

          <Grid size={12}>
            <GuestDialogSection
              icon={<CheckCircleIcon />}
              title="Membership & Pricing"
              tint={formData.guest_type === 'member' ? GUEST_DESIGN.gold : GUEST_DESIGN.green700}
            >
              <Grid container spacing={2.2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>Guest Type</GuestDialogLabel>
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
                        Non-Member (Standard Rate)
                      </Box>
                    </MenuItem>
                    <MenuItem value="member">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <MemberIcon sx={{ fontSize: 22, color: GUEST_DESIGN.gold }} />
                        Member (Discounted Rate)
                      </Box>
                    </MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>Discount Percentage</GuestDialogLabel>
                  <TextField
                    fullWidth
                    type="number"
                    value={formData.discount_percentage || 0}
                    onChange={(e) => updateField('discount_percentage', parseInt(e.target.value, 10) || 0)}
                    disabled={formData.guest_type !== 'member'}
                    sx={guestInputSx}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">%</InputAdornment>,
                    }}
                    inputProps={{ min: 0, max: 100 }}
                    helperText={formData.guest_type === 'member' ? 'Discount applied to room rates' : 'Only available for members'}
                  />
                </Grid>
              </Grid>
            </GuestDialogSection>
          </Grid>

          <Grid size={12}>
            <GuestDialogSection
              icon={<PublicIcon />}
              title="Tourism Classification"
              tint={formData.tourism_type === 'foreign' ? TOURISM_TYPE_CONFIG.foreign.color : GUEST_DESIGN.green700}
            >
              <Grid container spacing={2.2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>Tourism Type</GuestDialogLabel>
                  <TextField
                    select
                    fullWidth
                    value={formData.tourism_type || ''}
                    onChange={(e) => updateField('tourism_type', e.target.value as TourismType || undefined)}
                    sx={guestInputSx}
                  >
                    <MenuItem value="" disabled={!isEdit}>
                      <Box sx={{ color: 'text.secondary' }}>{isEdit ? 'Not specified' : 'Select tourism type'}</Box>
                    </MenuItem>
                    <MenuItem value="local">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Chip label="Local" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.local.color, color: '#fff', fontWeight: 700, height: 24 }} />
                        {TOURISM_TYPE_CONFIG.local.taxLabel}
                      </Box>
                    </MenuItem>
                    <MenuItem value="foreign">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Chip label="Foreign" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.foreign.color, color: '#fff', fontWeight: 700, height: 24 }} />
                        {TOURISM_TYPE_CONFIG.foreign.taxLabel}
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
            border: '1px solid #62b8b7',
            color: 'var(--hotel-primary)',
            fontWeight: 700,
            textTransform: 'none',
            '&:hover': { bgcolor: alpha(GUEST_DESIGN.green600, 0.06), borderColor: 'var(--hotel-primary)' },
          }}
        >
          Cancel
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
            color: '#fff',
            fontWeight: 800,
            textTransform: 'none',
            boxShadow: '0 10px 24px rgba(17, 155, 145, 0.24)',
            '&:hover': { bgcolor: 'var(--hotel-primary-dark)' },
            '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'text.secondary' },
          }}
        >
          {loading ? <CircularProgress size={22} sx={{ color: '#fff' }} /> : primaryLabel}
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
      InputProps={icon ? {
        endAdornment: <InputAdornment position="end">{icon}</InputAdornment>,
      } : undefined}
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
}) => (
  <Grid size={{ xs: 12, md: 6 }}>
    <GuestDialogLabel>Company Name</GuestDialogLabel>
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
      isOptionEqualToValue={(option, selectedValue) => option.id === selectedValue.id}
      noOptionsText={inputValue.trim() ? 'No companies found' : 'No active companies'}
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
          placeholder="Company Name"
          sx={guestInputSx}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading && <CircularProgress color="inherit" size={20} />}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  </Grid>
);

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
    border: '1px solid #d7e0e0',
    bgcolor: `color-mix(in srgb, ${tint} 4%, var(--hotel-paper))`,
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.35 }}>
      <Box sx={{ color: tint, display: 'inline-flex', '& svg': { fontSize: 26 } }}>
        {icon}
      </Box>
      <Typography sx={{ color: '#087b75', fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>
        {title}
      </Typography>
    </Box>
    {children}
  </Box>
);

export default GuestFormDialog;
