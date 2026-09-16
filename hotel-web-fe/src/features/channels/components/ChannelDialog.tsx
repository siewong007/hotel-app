import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
} from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import { formatStatusLabel } from '../../../utils/formatters';
import { toNumber } from '../../../utils/currency';
import {
  CHANNEL_TYPES,
  COMMISSION_SCOPES,
  INTEGRATION_MODES,
} from '../constants';
import type { BookingChannel, BookingChannelInput } from '../types';

interface Props {
  open: boolean;
  /** Null = create mode; a channel = edit mode. */
  channel: BookingChannel | null;
  saving: boolean;
  onClose(): void;
  onSubmit(input: BookingChannelInput): void;
}

interface FormState {
  name: string;
  channel_type: string;
  abbreviation: string;
  code: string;
  integration_mode: string;
  default_commission_type: string;
  default_commission_value: string;
  default_commission_scope: string;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  channel_type: 'direct',
  abbreviation: '',
  code: '',
  integration_mode: 'manual',
  default_commission_type: 'none',
  default_commission_value: '0',
  default_commission_scope: 'per_booking',
  is_active: true,
});

const fromChannel = (channel: BookingChannel): FormState => ({
  name: channel.name,
  channel_type: channel.channel_type,
  abbreviation: channel.abbreviation ?? '',
  code: channel.code ?? '',
  integration_mode: channel.integration_mode,
  default_commission_type: channel.default_commission_type,
  default_commission_value: String(toNumber(channel.default_commission_value)),
  default_commission_scope: channel.default_commission_scope,
  is_active: channel.is_active,
});

export const ChannelDialog = ({ open, channel, saving, onClose, onSubmit }: Props) => {
  const { t, tOr } = useTranslation('channels');
  const [form, setForm] = useState<FormState>(emptyForm);
  useEffect(() => {
    if (open) setForm(channel ? fromChannel(channel) : emptyForm());
  }, [open, channel]);

  const set = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const commissionValue = Number.parseFloat(form.default_commission_value);
  const valid =
    form.name.trim().length > 0 &&
    (form.default_commission_type === 'none' ||
      (Number.isFinite(commissionValue) && commissionValue >= 0));

  const submit = () => {
    onSubmit({
      name: form.name.trim(),
      channel_type: form.channel_type,
      abbreviation: form.abbreviation.trim() || null,
      code: form.code.trim() || null,
      integration_mode: form.integration_mode,
      default_commission_type: form.default_commission_type,
      default_commission_value:
        form.default_commission_type === 'none'
          ? 0
          : Number.isFinite(commissionValue)
            ? commissionValue
            : 0,
      default_commission_scope: form.default_commission_scope,
      is_active: form.is_active,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {channel ? t('dialog.editTitle') : t('dialog.newTitle')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          label={t('fields.name')}
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          required
          fullWidth
        />
        <TextField
          select
          label={t('fields.channelType')}
          value={form.channel_type}
          onChange={(event) => set({ channel_type: event.target.value })}
          fullWidth
        >
          {CHANNEL_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {tOr(`types.${type}`, formatStatusLabel(type))}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t('fields.abbreviation')}
          value={form.abbreviation}
          onChange={(event) => set({ abbreviation: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 8 } }}
          helperText={t('fields.abbreviationHelp')}
        />
        <TextField
          label={t('fields.code')}
          value={form.code}
          onChange={(event) => set({ code: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 40 } }}
          helperText={t('fields.codeHelp')}
        />
        <TextField
          select
          label={t('fields.integrationMode')}
          value={form.integration_mode}
          onChange={(event) => set({ integration_mode: event.target.value })}
          helperText={t('fields.integrationModeHelp')}
          fullWidth
        >
          {INTEGRATION_MODES.map((mode) => (
            <MenuItem key={mode} value={mode}>
              {tOr(`integration.${mode}`, formatStatusLabel(mode))}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('fields.commissionType')}
          value={form.default_commission_type}
          onChange={(event) => set({ default_commission_type: event.target.value })}
          fullWidth
        >
          {['none', 'percentage', 'fixed_amount'].map((type) => (
            <MenuItem key={type} value={type}>
              {tOr(`commissionTypes.${type}`, formatStatusLabel(type))}
            </MenuItem>
          ))}
        </TextField>
        {form.default_commission_type !== 'none' && (
          <>
            <TextField
              label={
                form.default_commission_type === 'percentage'
                  ? t('fields.commissionPercent')
                  : t('fields.commissionAmount')
              }
              type="number"
              value={form.default_commission_value}
              onChange={(event) => set({ default_commission_value: event.target.value })}
              fullWidth
            />
            <TextField
              select
              label={t('fields.commissionScope')}
              value={form.default_commission_scope}
              onChange={(event) => set({ default_commission_scope: event.target.value })}
              fullWidth
            >
              {COMMISSION_SCOPES.map((scope) => (
                <MenuItem key={scope} value={scope}>
                  {tOr(`commissionScopes.${scope}`, formatStatusLabel(scope))}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={form.is_active}
              onChange={(event) => set({ is_active: event.target.checked })}
            />
          }
          label={t('fields.active')}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={!valid || saving}>
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
