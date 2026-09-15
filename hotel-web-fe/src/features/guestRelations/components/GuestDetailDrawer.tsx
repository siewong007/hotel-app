import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddCircleOutlineOutlined as NewBookingIcon,
  AutoAwesome as ConvertIcon,
  CardGiftcardOutlined as CreditsIcon,
  Close as CloseIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  HistoryOutlined as StayHistoryIcon,
  ManageAccountsOutlined as PortalAccountIcon,
  OpenInNewOutlined as OpenFullIcon,
  Save as SaveIcon,
  VerifiedUserOutlined as EkycIcon,
} from '@mui/icons-material';
import type { Guest } from '../../../types';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { errorMessage } from '../../../utils';
import { formatHotelDate } from '../../../utils/date';
import { useTranslation } from '../../../i18n';
import { validateEmail } from '../../../utils/validation';
import { useUpdateGuest } from '../../guests/hooks/useGuestQueries';
import type { GuestFormData } from '../../guests/types';
import { guestLegalName } from '../utils';
import type { GuestListTableActions } from './GuestListTable';
import {
  BlacklistedChip,
  GuestAvatar,
  MemberChip,
  OpenRequestChip,
  TourismChip,
  VipChip,
} from './GuestChips';

interface GuestDetailDrawerProps extends GuestListTableActions {
  guest: Guest | null;
  open: boolean;
  onClose: () => void;
  onOpenFullProfile: (guest: Guest) => void;
  onSaved: () => Promise<void> | void;
  canCreateEkyc: boolean;
  canTransferPortalAccount: boolean;
  tourismConversionGuestId: number | null;
}

interface QuickEditFields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  nationality: string;
}

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', minWidth: 0 }}>{value}</Typography>
    </Stack>
  );
}

/** Legal-name split identical to the page's edit handler: a real first+last
 *  always wins; the nickname split is only a fallback for legacy rows. */
const initialFields = (guest: Guest): QuickEditFields => {
  const hasLegalName = Boolean(guest.first_name?.trim() && guest.last_name?.trim());
  const [splitFirst, ...splitRest] = guest.nick_name.split(' ');
  return {
    first_name: hasLegalName ? (guest.first_name ?? '') : (splitFirst || ''),
    last_name: hasLegalName ? (guest.last_name ?? '') : (splitRest.join(' ') || ''),
    email: guest.email || '',
    phone: guest.phone || '',
    nationality: guest.nationality || '',
  };
};

/**
 * Row-click surface for /guest-relations/guests: identity + contact details,
 * a small quick-edit form, and every action the row's icon/⋮ menu exposed.
 * The guest-360 page stays reachable via "Open guest 360".
 */
/** Quick-edit form, remounted per guest via `key` so field state always
 *  starts from that guest's current values without an identity effect. */
const GuestQuickEdit: React.FC<{ guest: Guest; onSaved: () => Promise<void> | void }> = ({
  guest,
  onSaved,
}) => {
  const { t } = useTranslation('guests');
  const updateGuest = useUpdateGuest();
  const [fields, setFields] = useState<QuickEditFields>(() => initialFields(guest));
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!fields.first_name.trim() || !fields.last_name.trim()) {
      setEditError('First name and last name are required');
      return;
    }
    if (fields.email.trim()) {
      const emailError = validateEmail(fields.email);
      if (emailError) {
        setEditError(emailError);
        return;
      }
    }
    // Same payload shape as the page's edit dialog: the full form built from
    // the guest, with only the quick-edit fields applied on top.
    const data: GuestFormData = {
      first_name: fields.first_name.trim(),
      last_name: fields.last_name.trim(),
      email: fields.email,
      phone: fields.phone,
      ic_number: guest.ic_number || '',
      nationality: fields.nationality,
      address_line1: guest.address_line1 || '',
      city: guest.city || '',
      state_province: guest.state_province || '',
      postal_code: guest.postal_code || '',
      country: guest.country || '',
      company_name: guest.company_name || '',
      guest_type: guest.guest_type || 'non_member',
      tourism_type: guest.tourism_type,
      discount_percentage: guest.discount_percentage || 0,
    };
    try {
      setSaving(true);
      setEditError(null);
      await updateGuest.mutateAsync({ guestId: guest.id, data });
      emitApiNotification({ message: t('drawer.updateSuccess'), severity: 'success' });
      await onSaved();
    } catch (err) {
      setEditError(errorMessage(err, t('drawer.updateFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('drawer.quickEdit')}</Typography>
      {editError && (
        <Alert severity="error" onClose={() => setEditError(null)}>{editError}</Alert>
      )}
      <Stack direction="row" spacing={1.5}>
        <TextField
          fullWidth size="small" label={t('form.firstName')} required
          value={fields.first_name}
          onChange={(e) => setFields((prev) => ({ ...prev, first_name: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          fullWidth size="small" label={t('form.lastName')} required
          value={fields.last_name}
          onChange={(e) => setFields((prev) => ({ ...prev, last_name: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      <TextField
        fullWidth size="small" label={t('form.email')} type="email"
        value={fields.email}
        onChange={(e) => setFields((prev) => ({ ...prev, email: e.target.value }))}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Stack direction="row" spacing={1.5}>
        <TextField
          fullWidth size="small" label={t('form.phone')} type="tel"
          value={fields.phone}
          onChange={(e) => setFields((prev) => ({ ...prev, phone: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          fullWidth size="small" label={t('form.nationality')}
          value={fields.nationality}
          onChange={(e) => setFields((prev) => ({ ...prev, nationality: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small" variant="contained" onClick={handleSave} disabled={saving}
          startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
        >
          {saving ? t('common:state.saving') : t('common:actions.saveChanges')}
        </Button>
      </Box>
    </Stack>
  );
};

const GuestDetailDrawer: React.FC<GuestDetailDrawerProps> = ({
  guest,
  open,
  onClose,
  onOpenFullProfile,
  onSaved,
  canCreateEkyc,
  canTransferPortalAccount,
  tourismConversionGuestId,
  onEdit,
  onNewBooking,
  onStayHistory,
  onViewCredits,
  onConvertTourism,
  onTransferPortalAccount,
  onCreateEkyc,
  onDelete,
}) => {
  const { t } = useTranslation('guests');
  if (!guest) return null;

  const legalName = guestLegalName(guest);
  const isConverting = tourismConversionGuestId === guest.id;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}
      aria-label={t('drawer.ariaLabel', { name: guest.nick_name })}
    >
      <Stack spacing={2.5} sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <GuestAvatar guest={guest} size={46} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                {guest.nick_name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {legalName && legalName !== guest.nick_name ? `${legalName} · ` : ''}#{guest.id}
              </Typography>
            </Box>
          </Stack>
          <IconButton onClick={onClose} aria-label={t('drawer.closeAria')} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {guest.guest_type === 'member' && <MemberChip />}
          {guest.vip_status?.trim() && <VipChip status={guest.vip_status} />}
          <TourismChip guest={guest} />
          {guest.is_blacklisted && (
            <Tooltip title={guest.blacklist_reason ? t('list.blacklistedReason', { reason: guest.blacklist_reason }) : t('list.blacklistedGuest')}>
              <BlacklistedChip />
            </Tooltip>
          )}
          {guest.has_open_support && <OpenRequestChip />}
        </Stack>

        <Button
          variant="outlined"
          size="small"
          startIcon={<OpenFullIcon />}
          onClick={() => onOpenFullProfile(guest)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('drawer.openGuest360')}
        </Button>

        <Divider />

        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('drawer.details')}</Typography>
          <DetailRow label={t('form.email')} value={guest.email} />
          <DetailRow label={t('form.phone')} value={guest.phone} />
          <DetailRow label={t('form.icNumber')} value={guest.ic_number} />
          <DetailRow label={t('form.nationality')} value={guest.nationality} />
          <DetailRow label={t('form.companyName')} value={guest.company_name} />
          <DetailRow
            label={t('list.lastStay')}
            value={guest.last_stay_date ? formatHotelDate(guest.last_stay_date, '—') : undefined}
          />
          <DetailRow
            label={t('drawer.stays')}
            value={(guest.bookings_count ?? 0) === 0 ? t('list.noStays') : `${guest.bookings_count}`}
          />
          <DetailRow
            label={t('drawer.portalAccount')}
            value={
              guest.account_username
                ? `${guest.account_username} (${guest.account_is_active ? t('list.accountActive') : t('list.accountDeactivated')})`
                : undefined
            }
          />
          <DetailRow label={t('drawer.blacklistReason')} value={guest.is_blacklisted ? guest.blacklist_reason : undefined} />
        </Stack>

        <Divider />

        <GuestQuickEdit key={guest.id} guest={guest} onSaved={onSaved} />

        <Divider />

        <Stack spacing={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('drawer.actions')}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" startIcon={<NewBookingIcon />} onClick={() => onNewBooking(guest)}>
              {t('profile.newBooking')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<StayHistoryIcon />} onClick={() => onStayHistory(guest)}>
              {t('list.stayHistory')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<CreditsIcon />} onClick={() => onViewCredits(guest)}>
              {t('drawer.freeNightCredits')}
            </Button>
            <Button
              size="small" variant="outlined" disabled={isConverting}
              startIcon={isConverting ? <CircularProgress size={14} /> : <ConvertIcon />}
              onClick={() => onConvertTourism(guest)}
            >
              {t('drawer.setTourismFromCheckIn')}
            </Button>
            {canTransferPortalAccount && (
              <Button size="small" variant="outlined" startIcon={<PortalAccountIcon />} onClick={() => onTransferPortalAccount(guest)}>
                {t('drawer.transferPortalAccount')}
              </Button>
            )}
            {canCreateEkyc && (
              <Button size="small" variant="outlined" startIcon={<EkycIcon />} onClick={() => onCreateEkyc(guest)}>
                {t('drawer.createEkyc')}
              </Button>
            )}
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => onEdit(guest)}>
              {t('common:actions.edit')}
            </Button>
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={() => onDelete(guest)}>
              {t('drawer.deleteGuest')}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  );
};

export default GuestDetailDrawer;
