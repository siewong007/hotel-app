import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  TextField,
} from '@mui/material';

import { ADJUSTMENT_TYPES, DOW_FLAGS, PLAN_TYPES } from '../constants';
import type { RatePlan, RatePlanInput } from '../types';
import ModernDatePicker from '../../../components/common/ModernDatePicker';

export interface RatePlanDialogProps {
  open: boolean;
  /** Null = create mode; a plan = edit mode. */
  plan: RatePlan | null;
  saving: boolean;
  /** Rendered below the plan fields in edit mode (the room-rate band editor). */
  children?: React.ReactNode;
  onClose(): void;
  onSubmit(input: RatePlanInput): void;
}

interface FormState {
  name: string;
  code: string;
  description: string;
  plan_type: string;
  adjustment_type: string;
  adjustment_value: string;
  valid_from: string;
  valid_to: string;
  days: Record<string, boolean>;
  min_nights: string;
  max_nights: string;
  min_advance_booking: string;
  max_advance_booking: string;
  priority: string;
  blackout_dates: string;
}

const emptyForm = (): FormState => ({
  name: '',
  code: '',
  description: '',
  plan_type: 'standard',
  adjustment_type: 'override',
  adjustment_value: '',
  valid_from: '',
  valid_to: '',
  days: Object.fromEntries(DOW_FLAGS.map(([flag]) => [flag, true])),
  min_nights: '1',
  max_nights: '',
  min_advance_booking: '0',
  max_advance_booking: '',
  priority: '0',
  blackout_dates: '',
});

const fromPlan = (plan: RatePlan): FormState => ({
  ...emptyForm(),
  name: plan.name,
  code: plan.code,
  description: plan.description ?? '',
  plan_type: plan.plan_type,
  adjustment_type: plan.adjustment_type,
  adjustment_value: plan.adjustment_value ?? '',
  valid_from: plan.valid_from ?? '',
  valid_to: plan.valid_to ?? '',
  days: Object.fromEntries(
    DOW_FLAGS.map(([flag]) => [flag, plan[flag as keyof RatePlan] === true]),
  ),
  min_nights: String(plan.min_nights),
  max_nights: plan.max_nights !== null ? String(plan.max_nights) : '',
  min_advance_booking: String(plan.min_advance_booking),
  max_advance_booking:
    plan.max_advance_booking !== null ? String(plan.max_advance_booking) : '',
  priority: String(plan.priority),
});

const num = (value: string): number | undefined => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const RatePlanDialog = ({
  open,
  plan,
  saving,
  children,
  onClose,
  onSubmit,
}: RatePlanDialogProps) => {
  const [form, setForm] = useState<FormState>(emptyForm);
  useEffect(() => {
    if (open) setForm(plan ? fromPlan(plan) : emptyForm());
  }, [open, plan]);

  const set = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const valid =
    form.name.trim().length > 0 &&
    form.code.trim().length > 0 &&
    (!form.valid_from || !form.valid_to || form.valid_from <= form.valid_to);

  const submit = () => {
    const input: RatePlanInput = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description.trim() || undefined,
      plan_type: form.plan_type,
      adjustment_type: form.adjustment_type,
      adjustment_value:
        form.adjustment_value === ''
          ? undefined
          : Number.parseFloat(form.adjustment_value),
      valid_from: form.valid_from || undefined,
      valid_to: form.valid_to || undefined,
      min_nights: num(form.min_nights),
      max_nights: num(form.max_nights),
      min_advance_booking: num(form.min_advance_booking),
      max_advance_booking: num(form.max_advance_booking),
      priority: num(form.priority),
      ...Object.fromEntries(
        DOW_FLAGS.map(([flag]) => [flag, form.days[flag] ?? true]),
      ),
    };
    // blackout_dates is create-only: the API stores but never returns it, so
    // editing would blind-overwrite.
    if (!plan && form.blackout_dates.trim()) {
      input.blackout_dates = form.blackout_dates
        .split(',')
        .map((date) => date.trim())
        .filter(Boolean);
    }
    onSubmit(input);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{plan ? `Edit ${plan.name}` : 'New rate plan'}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            required
            fullWidth
          />
          <TextField
            label="Code"
            value={form.code}
            onChange={(event) =>
              set({ code: event.target.value.toUpperCase() })
            }
            required
            fullWidth
            helperText="Unique plan code shown on the calendar"
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(event) => set({ description: event.target.value })}
            fullWidth
            sx={{ gridColumn: '1 / -1' }}
          />
          <TextField
            select
            label="Plan type"
            value={form.plan_type}
            onChange={(event) => set({ plan_type: event.target.value })}
            fullWidth
          >
            {PLAN_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Adjustment type"
            value={form.adjustment_type}
            onChange={(event) => set({ adjustment_type: event.target.value })}
            fullWidth
          >
            {ADJUSTMENT_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Adjustment value"
            type="number"
            value={form.adjustment_value}
            onChange={(event) => set({ adjustment_value: event.target.value })}
            fullWidth
          />
          <TextField
            label="Priority"
            type="number"
            value={form.priority}
            onChange={(event) => set({ priority: event.target.value })}
            helperText="Higher wins when plans overlap"
            fullWidth
          />
          <ModernDatePicker
            label="Valid from"
            value={form.valid_from}
            onChange={(value) => set({ valid_from: value })}
          />
          <ModernDatePicker
            label="Valid to"
            value={form.valid_to}
            onChange={(value) => set({ valid_to: value })}
            error={Boolean(
              form.valid_from && form.valid_to && form.valid_from > form.valid_to,
            )}
            helperText={
              form.valid_from && form.valid_to && form.valid_from > form.valid_to
                ? 'Must be on or after Valid from'
                : undefined
            }
          />
          <TextField
            label="Min nights"
            type="number"
            value={form.min_nights}
            onChange={(event) => set({ min_nights: event.target.value })}
            fullWidth
          />
          <TextField
            label="Max nights"
            type="number"
            value={form.max_nights}
            onChange={(event) => set({ max_nights: event.target.value })}
            fullWidth
          />
          <TextField
            label="Min advance booking (days)"
            type="number"
            value={form.min_advance_booking}
            onChange={(event) =>
              set({ min_advance_booking: event.target.value })
            }
            fullWidth
          />
          <TextField
            label="Max advance booking (days)"
            type="number"
            value={form.max_advance_booking}
            onChange={(event) =>
              set({ max_advance_booking: event.target.value })
            }
            fullWidth
          />
          {!plan && (
            <TextField
              label="Blackout dates"
              value={form.blackout_dates}
              onChange={(event) => set({ blackout_dates: event.target.value })}
              helperText="Comma-separated YYYY-MM-DD; create-only (API does not return stored blackouts)"
              fullWidth
              sx={{ gridColumn: '1 / -1' }}
            />
          )}
        </Box>
        <FormLabel component="legend" sx={{ mt: 2, mb: 0.5 }}>
          Applies on
        </FormLabel>
        <FormGroup row>
          {DOW_FLAGS.map(([flag, label]) => (
            <FormControlLabel
              key={flag}
              control={
                <Checkbox
                  size="small"
                  checked={form.days[flag] ?? true}
                  onChange={(event) =>
                    set({
                      days: { ...form.days, [flag]: event.target.checked },
                    })
                  }
                />
              }
              label={label}
            />
          ))}
        </FormGroup>
        {plan && children && (
          <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            {children}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!valid || saving}
        >
          {plan ? 'Save changes' : 'Create plan'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
