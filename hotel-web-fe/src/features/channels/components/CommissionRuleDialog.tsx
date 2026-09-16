import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import { formatStatusLabel } from '../../../utils/formatters';
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { COMMISSION_SCOPES, COMMISSION_TYPES } from '../constants';
import { toNumber } from '../../../utils/currency';
import type { ChannelCommissionRule, ChannelCommissionRuleInput } from '../types';

interface Props {
  open: boolean;
  rule: ChannelCommissionRule | null;
  saving: boolean;
  onClose(): void;
  onSubmit(input: ChannelCommissionRuleInput): void;
}

interface FormState {
  commission_type: string;
  value: string;
  scope: string;
  effective_from: string;
  effective_to: string;
  priority: string;
  reason: string;
}

const emptyForm = (): FormState => ({
  commission_type: 'percentage',
  value: '',
  scope: 'per_booking',
  effective_from: '',
  effective_to: '',
  priority: '0',
  reason: '',
});

const fromRule = (rule: ChannelCommissionRule): FormState => ({
  commission_type: rule.commission_type,
  value: String(toNumber(rule.value)),
  scope: rule.scope,
  effective_from: rule.effective_from,
  effective_to: rule.effective_to ?? '',
  priority: String(rule.priority),
  reason: rule.reason ?? '',
});

export const CommissionRuleDialog = ({ open, rule, saving, onClose, onSubmit }: Props) => {
  const { t, tOr } = useTranslation('channels');
  const [form, setForm] = useState<FormState>(emptyForm);
  useEffect(() => {
    if (open) setForm(rule ? fromRule(rule) : emptyForm());
  }, [open, rule]);

  const set = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const value = Number.parseFloat(form.value);
  const valueValid =
    Number.isFinite(value) &&
    value >= 0 &&
    (form.commission_type !== 'percentage' || value <= 100);
  const windowValid = !form.effective_to || form.effective_to >= form.effective_from;
  const valid = valueValid && form.effective_from !== '' && windowValid;

  const submit = () => {
    onSubmit({
      commission_type: form.commission_type,
      value,
      scope: form.scope,
      effective_from: form.effective_from,
      effective_to: form.effective_to === '' ? null : form.effective_to,
      priority: Number.parseInt(form.priority, 10) || 0,
      reason: form.reason.trim() || null,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {rule ? t('commissionDialog.editTitle') : t('commissionDialog.newTitle')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          select
          label={t('commissionDialog.type')}
          value={form.commission_type}
          onChange={(event) => set({ commission_type: event.target.value })}
          fullWidth
        >
          {COMMISSION_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {tOr(`commissionTypes.${type}`, formatStatusLabel(type))}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={
            form.commission_type === 'percentage'
              ? t('rulesDialog.valuePercent')
              : t('rulesDialog.valueAmount')
          }
          type="number"
          value={form.value}
          onChange={(event) => set({ value: event.target.value })}
          error={!valueValid}
          required
          fullWidth
        />
        <TextField
          select
          label={t('fields.commissionScope')}
          value={form.scope}
          onChange={(event) => set({ scope: event.target.value })}
          fullWidth
        >
          {COMMISSION_SCOPES.map((scope) => (
            <MenuItem key={scope} value={scope}>
              {tOr(`commissionScopes.${scope}`, formatStatusLabel(scope))}
            </MenuItem>
          ))}
        </TextField>
        <ModernDatePicker
          label={t('rulesDialog.effectiveFrom')}
          value={form.effective_from}
          onChange={(next) => set({ effective_from: next })}
        />
        <ModernDatePicker
          label={t('rulesDialog.effectiveTo')}
          value={form.effective_to}
          onChange={(next) => set({ effective_to: next })}
        />
        {!windowValid && <Alert severity="error">{t('rulesDialog.windowError')}</Alert>}
        <TextField
          label={t('rulesDialog.priority')}
          type="number"
          value={form.priority}
          onChange={(event) => set({ priority: event.target.value })}
          helperText={t('rulesDialog.priorityHelp')}
        />
        <TextField
          label={t('rulesDialog.reason')}
          value={form.reason}
          onChange={(event) => set({ reason: event.target.value })}
          multiline
          minRows={2}
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
