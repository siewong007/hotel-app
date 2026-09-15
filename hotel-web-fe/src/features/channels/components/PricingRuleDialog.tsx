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
import { useRatePlans, useRateRoomTypes } from '../../rates/hooks/useRatePlans';
import { PERCENT_RULE_TYPES, PRICING_RULE_TYPES } from '../constants';
import { toNumber } from '../../../utils/currency';
import type { ChannelPricingRule, ChannelPricingRuleInput } from '../types';

interface Props {
  open: boolean;
  /** Null = create mode; a rule = edit mode. */
  rule: ChannelPricingRule | null;
  saving: boolean;
  onClose(): void;
  onSubmit(input: ChannelPricingRuleInput): void;
}

interface FormState {
  rule_type: string;
  value: string;
  room_type_id: string;
  rate_plan_id: string;
  effective_from: string;
  effective_to: string;
  min_price: string;
  max_price: string;
  priority: string;
  reason: string;
}

const emptyForm = (): FormState => ({
  rule_type: 'markup_percent',
  value: '',
  room_type_id: '',
  rate_plan_id: '',
  effective_from: '',
  effective_to: '',
  min_price: '',
  max_price: '',
  priority: '0',
  reason: '',
});

const fromRule = (rule: ChannelPricingRule): FormState => ({
  rule_type: rule.rule_type,
  value: String(toNumber(rule.value)),
  room_type_id: rule.room_type_id !== null ? String(rule.room_type_id) : '',
  rate_plan_id: rule.rate_plan_id !== null ? String(rule.rate_plan_id) : '',
  effective_from: rule.effective_from,
  effective_to: rule.effective_to ?? '',
  min_price: rule.min_price !== null ? String(toNumber(rule.min_price)) : '',
  max_price: rule.max_price !== null ? String(toNumber(rule.max_price)) : '',
  priority: String(rule.priority),
  reason: rule.reason ?? '',
});

const numOrNull = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const PricingRuleDialog = ({ open, rule, saving, onClose, onSubmit }: Props) => {
  const { t, tOr } = useTranslation('channels');
  const roomTypes = useRateRoomTypes();
  const plans = useRatePlans();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(rule ? fromRule(rule) : emptyForm());
      setError(null);
    }
  }, [open, rule]);

  const set = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const value = Number.parseFloat(form.value);
  const valueValid =
    Number.isFinite(value) &&
    value >= 0 &&
    (form.rule_type !== 'discount_percent' || value <= 100);
  const windowValid = !form.effective_to || form.effective_to >= form.effective_from;
  const boundsValid =
    form.min_price === '' ||
    form.max_price === '' ||
    Number.parseFloat(form.min_price) <= Number.parseFloat(form.max_price);
  const valid =
    valueValid && form.effective_from !== '' && windowValid && boundsValid;

  const submit = () => {
    if (PERCENT_RULE_TYPES.has(form.rule_type) && value > 30) {
      setError(t('rulesDialog.largeChangeWarning', { value: String(value) }));
    }
    onSubmit({
      rule_type: form.rule_type,
      value,
      room_type_id: form.room_type_id === '' ? null : Number(form.room_type_id),
      rate_plan_id: form.rate_plan_id === '' ? null : Number(form.rate_plan_id),
      effective_from: form.effective_from,
      effective_to: form.effective_to === '' ? null : form.effective_to,
      min_price: numOrNull(form.min_price),
      max_price: numOrNull(form.max_price),
      priority: Number.parseInt(form.priority, 10) || 0,
      reason: form.reason.trim() || null,
    });
  };

  const percentType = PERCENT_RULE_TYPES.has(form.rule_type);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {rule ? t('rulesDialog.editTitle') : t('rulesDialog.newTitle')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {error && (
          <Alert severity="warning" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <TextField
          select
          label={t('rulesDialog.ruleType')}
          value={form.rule_type}
          onChange={(event) => set({ rule_type: event.target.value })}
          helperText={t(`ruleTypeHelp.${form.rule_type}`)}
          fullWidth
        >
          {PRICING_RULE_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {tOr(`ruleTypes.${type}`, formatStatusLabel(type))}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={percentType ? t('rulesDialog.valuePercent') : t('rulesDialog.valueAmount')}
          type="number"
          value={form.value}
          onChange={(event) => set({ value: event.target.value })}
          error={!valueValid}
          required
          fullWidth
        />
        <TextField
          select
          label={t('rulesDialog.roomType')}
          value={form.room_type_id}
          onChange={(event) => set({ room_type_id: event.target.value })}
          helperText={t('rulesDialog.roomTypeHelp')}
          fullWidth
        >
          <MenuItem value="">{t('rules.scopeAllRooms')}</MenuItem>
          {(roomTypes.data ?? []).map((rt) => (
            <MenuItem key={rt.id} value={String(rt.id)}>
              {rt.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('rulesDialog.ratePlan')}
          value={form.rate_plan_id}
          onChange={(event) => set({ rate_plan_id: event.target.value })}
          helperText={t('rulesDialog.ratePlanHelp')}
          fullWidth
        >
          <MenuItem value="">{t('rules.scopeAnyPlan')}</MenuItem>
          {(plans.data ?? []).map((plan) => (
            <MenuItem key={plan.id} value={String(plan.id)}>
              {plan.name}
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
        {!windowValid && (
          <Alert severity="error">{t('rulesDialog.windowError')}</Alert>
        )}
        <TextField
          label={t('rulesDialog.minPrice')}
          type="number"
          value={form.min_price}
          onChange={(event) => set({ min_price: event.target.value })}
          helperText={t('rulesDialog.boundsHelp')}
        />
        <TextField
          label={t('rulesDialog.maxPrice')}
          type="number"
          value={form.max_price}
          onChange={(event) => set({ max_price: event.target.value })}
          error={!boundsValid}
        />
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
