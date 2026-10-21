import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

import { useTranslation } from '../../../i18n/useTranslation';
import { dateFormatter } from '../../../i18n/format';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { useCurrency } from '../../../hooks/useCurrency';
import { errorMessage } from '../../../utils';
import { toMoneyNumber } from '../../../utils/money';
import type { RoomType } from '../../../types';
import {
  useApplyBulkPrices,
  useLastBulkPriceChange,
  usePreviewBulkPrices,
  useRevertBulkPrices,
} from './hooks';
import {
  PRICE_FIELDS,
  ROUND_STEPS,
  type BulkPricePreview,
  type BulkPriceRequest,
  type PriceField,
  type PriceMethod,
} from './types';

/** UI methods fold direction into the sign sent to the server. */
type UiMethod = 'set_exact' | 'increase_percent' | 'decrease_percent' | 'increase_amount' | 'decrease_amount';

const UI_METHODS: UiMethod[] = [
  'set_exact',
  'increase_percent',
  'decrease_percent',
  'increase_amount',
  'decrease_amount',
];

const toApiMethod = (m: UiMethod): { method: PriceMethod; sign: 1 | -1 } => {
  switch (m) {
    case 'set_exact':
      return { method: 'set_exact', sign: 1 };
    case 'increase_percent':
      return { method: 'percent', sign: 1 };
    case 'decrease_percent':
      return { method: 'percent', sign: -1 };
    case 'increase_amount':
      return { method: 'amount', sign: 1 };
    case 'decrease_amount':
      return { method: 'amount', sign: -1 };
  }
};

const FIELD_KEY: Record<PriceField, string> = {
  base_price: 'base',
  weekday_rate: 'weekday',
  weekend_rate: 'weekend',
};

export interface BulkPriceDialogProps {
  open: boolean;
  roomTypes: RoomType[];
  onClose(): void;
  /** Called after a successful apply or revert with the user-facing message. */
  onDone(message: string): void;
}

export const BulkPriceDialog = ({ open, roomTypes, onClose, onDone }: BulkPriceDialogProps) => {
  const { t, locale } = useTranslation('rooms');
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const isPhone = useIsPhone();

  const [step, setStep] = useState(0);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [fields, setFields] = useState<PriceField[]>([...PRICE_FIELDS]);
  const [uiMethod, setUiMethod] = useState<UiMethod>('increase_percent');
  const [value, setValue] = useState('');
  const [roundTo, setRoundTo] = useState<string>('none');
  const [reason, setReason] = useState('');
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [preview, setPreview] = useState<BulkPricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertReason, setRevertReason] = useState('');

  const previewMutation = usePreviewBulkPrices();
  const applyMutation = useApplyBulkPrices();
  const revertMutation = useRevertBulkPrices();
  const lastQuery = useLastBulkPriceChange(open);
  const last = lastQuery.data ?? null;

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setScope('all');
    setSelectedIds([]);
    setFields([...PRICE_FIELDS]);
    setUiMethod('increase_percent');
    setValue('');
    setRoundTo('none');
    setReason('');
    setConfirmLarge(false);
    setPreview(null);
    setError(null);
    setRevertOpen(false);
    setRevertReason('');
  }, [open]);

  const numericValue = Number.parseFloat(value);
  const { method, sign } = toApiMethod(uiMethod);
  const isPercent = method === 'percent';
  const valueError = useMemo(() => {
    if (value === '') return null;
    if (!Number.isFinite(numericValue) || numericValue <= 0) return t('bulkPrice.errors.valuePositive');
    if (isPercent && sign === -1 && numericValue >= 100) return t('bulkPrice.errors.decreaseTooBig');
    return null;
  }, [value, numericValue, isPercent, sign, t]);

  const configValid =
    fields.length > 0 &&
    (scope === 'all' || selectedIds.length > 0) &&
    value !== '' &&
    !valueError;

  const request = (extra?: Partial<BulkPriceRequest>): BulkPriceRequest => ({
    room_type_ids: scope === 'all' ? [] : selectedIds,
    fields,
    method,
    value: Math.abs(numericValue) * (method === 'set_exact' ? 1 : sign),
    round_to: roundTo === 'none' ? null : Number(roundTo),
    ...extra,
  });

  const toggleId = (id: number) =>
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id]));
  const toggleField = (f: PriceField) =>
    setFields((cur) => (cur.includes(f) ? cur.filter((v) => v !== f) : [...cur, f]));

  const goPreview = async () => {
    setError(null);
    try {
      const result = await previewMutation.mutateAsync(request());
      setPreview(result);
      setConfirmLarge(false);
      setStep(1);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const reasonOk = reason.trim().length >= 3;
  const canApply =
    !!preview &&
    preview.changed_fields > 0 &&
    reasonOk &&
    (!preview.requires_confirmation || confirmLarge) &&
    !applyMutation.isPending;

  const apply = async () => {
    if (!canApply) return;
    setError(null);
    try {
      const result = await applyMutation.mutateAsync(
        request({
          reason: reason.trim(),
          confirm_large_change: preview?.requires_confirmation ? confirmLarge : false,
        }),
      );
      onDone(
        t('bulkPrice.applied', {
          types: result.preview.changed_room_types,
          fields: result.preview.changed_fields,
        }),
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const revert = async () => {
    setError(null);
    try {
      await revertMutation.mutateAsync(revertReason.trim());
      onDone(t('bulkPrice.reverted'));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const money = (v: string) => formatCurrency(toMoneyNumber(v));
  const deltaLabel = (d: string, pct: string | null) => {
    const n = toMoneyNumber(d);
    const prefix = n > 0 ? '+' : '';
    const pctText = pct === null ? '' : ` (${prefix}${pct}%)`;
    return `${prefix}${formatCurrency(n)}${pctText}`;
  };

  const fieldLabel = (f: PriceField) => t(`bulkPrice.fields.${FIELD_KEY[f]}`);
  const lastWhen = last
    ? dateFormatter({ dateStyle: 'medium', timeStyle: 'short' }, locale).format(new Date(last.created_at))
    : '';

  const busy = previewMutation.isPending || applyMutation.isPending || revertMutation.isPending;
  const steps = [t('bulkPrice.steps.configure'), t('bulkPrice.steps.preview'), t('bulkPrice.steps.confirm')];

  const configureStep = (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      {last && (
        <Alert
          severity="info"
          action={
            last.can_revert ? (
              <Button color="inherit" size="small" onClick={() => setRevertOpen((v) => !v)}>
                {t('bulkPrice.revert.open')}
              </Button>
            ) : undefined
          }
        >
          {t(
            last.action === 'room_prices_bulk_reverted'
              ? 'bulkPrice.last.reverted'
              : 'bulkPrice.last.updated',
            { user: last.username ?? t('bulkPrice.last.unknownUser'), when: lastWhen, count: last.room_types },
          )}
          {last.reason ? ` — ${last.reason}` : ''}
        </Alert>
      )}
      {revertOpen && last?.can_revert && (
        <Box sx={{ display: 'grid', gap: 1.5, p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="body2">{t('bulkPrice.revert.help')}</Typography>
          <TextField
            label={t('bulkPrice.reason')}
            value={revertReason}
            onChange={(e) => setRevertReason(e.target.value)}
            required
            fullWidth
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Box>
            <Button
              variant="contained"
              color="warning"
              disabled={revertReason.trim().length < 3 || busy}
              onClick={revert}
            >
              {t('bulkPrice.revert.confirm')}
            </Button>
          </Box>
        </Box>
      )}

      <Box>
        <FormLabel component="legend">{t('bulkPrice.scope.label')}</FormLabel>
        <ToggleButtonGroup
          exclusive
          fullWidth={isPhone}
          size="small"
          value={scope}
          onChange={(_, v: 'all' | 'selected' | null) => v && setScope(v)}
          aria-label={t('bulkPrice.scope.label')}
          sx={{ mt: 0.5 }}
        >
          <ToggleButton value="all">{t('bulkPrice.scope.all')}</ToggleButton>
          <ToggleButton value="selected">{t('bulkPrice.scope.selected')}</ToggleButton>
        </ToggleButtonGroup>
        {scope === 'selected' && (
          <FormGroup sx={{ mt: 1 }}>
            {roomTypes.map((rt) => (
              <FormControlLabel
                key={rt.id}
                control={
                  <Checkbox
                    size="small"
                    checked={selectedIds.includes(rt.id)}
                    onChange={() => toggleId(rt.id)}
                  />
                }
                label={`${rt.name} (${rt.code}) · ${formatCurrency(toMoneyNumber(rt.base_price))}`}
              />
            ))}
          </FormGroup>
        )}
      </Box>

      <Box>
        <FormLabel component="legend">{t('bulkPrice.fields.label')}</FormLabel>
        <FormGroup row>
          {PRICE_FIELDS.map((f) => (
            <FormControlLabel
              key={f}
              control={<Checkbox size="small" checked={fields.includes(f)} onChange={() => toggleField(f)} />}
              label={fieldLabel(f)}
            />
          ))}
        </FormGroup>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <TextField
          select
          label={t('bulkPrice.method.label')}
          value={uiMethod}
          onChange={(e) => setUiMethod(e.target.value as UiMethod)}
          fullWidth
        >
          {UI_METHODS.map((m) => (
            <MenuItem key={m} value={m}>
              {t(`bulkPrice.method.${m}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t('bulkPrice.value')}
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={Boolean(valueError)}
          helperText={valueError ?? undefined}
          required
          fullWidth
          slotProps={{
            htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' },
            input: {
              endAdornment: <InputAdornment position="end">{isPercent ? '%' : currencySymbol}</InputAdornment>,
            },
          }}
        />
        <TextField
          select
          label={t('bulkPrice.round.label')}
          value={roundTo}
          onChange={(e) => setRoundTo(e.target.value)}
          fullWidth
        >
          <MenuItem value="none">{t('bulkPrice.round.none')}</MenuItem>
          {ROUND_STEPS.map((s) => (
            <MenuItem key={s} value={String(s)}>
              {t('bulkPrice.round.nearest', { amount: formatCurrency(s) })}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('bulkPrice.immediateHint')}
      </Typography>
    </Box>
  );

  const previewStep = preview && (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="body2">
        {t('bulkPrice.summary', { types: preview.changed_room_types, fields: preview.changed_fields })}
      </Typography>
      {preview.requires_confirmation && (
        <Alert severity="warning">{t('bulkPrice.largeWarning', { percent: preview.large_change_percent })}</Alert>
      )}
      {preview.changed_fields === 0 && <Alert severity="info">{t('bulkPrice.noChange')}</Alert>}
      {isPhone ? (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {preview.rows.map((row) => (
            <Box
              key={row.room_type_id}
              data-testid="bulk-price-card"
              sx={{
                p: 1.5,
                border: 1,
                borderColor: row.changed ? 'primary.main' : 'divider',
                borderRadius: 2,
                opacity: row.changed ? 1 : 0.65,
              }}
            >
              <Typography sx={{ fontWeight: 700 }}>
                {row.name} <Typography component="span" variant="caption">({row.code})</Typography>
              </Typography>
              {row.changes.map((c) => (
                <Box key={c.field} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary">{fieldLabel(c.field)}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: c.changed ? 700 : 400 }}>
                    {money(c.old_price)} → {money(c.new_price)}
                    {c.changed && (
                      <Chip
                        size="small"
                        color={c.large ? 'warning' : toMoneyNumber(c.delta) > 0 ? 'success' : 'info'}
                        label={deltaLabel(c.delta, c.delta_percent)}
                        sx={{ ml: 0.75 }}
                      />
                    )}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small" aria-label={t('bulkPrice.steps.preview')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('bulkPrice.table.roomType')}</TableCell>
                <TableCell>{t('bulkPrice.table.price')}</TableCell>
                <TableCell align="right">{t('bulkPrice.table.old')}</TableCell>
                <TableCell align="right">{t('bulkPrice.table.new')}</TableCell>
                <TableCell align="right">{t('bulkPrice.table.change')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.rows.flatMap((row) =>
                row.changes.map((c, i) => (
                  <TableRow
                    key={`${row.room_type_id}-${c.field}`}
                    sx={{
                      bgcolor: c.changed
                        ? c.large
                          ? 'var(--hotel-warning-bg)'
                          : 'var(--hotel-primary-subtle)'
                        : undefined,
                      opacity: c.changed ? 1 : 0.6,
                    }}
                  >
                    <TableCell>{i === 0 ? `${row.name} (${row.code})` : ''}</TableCell>
                    <TableCell>{fieldLabel(c.field)}</TableCell>
                    <TableCell align="right">{money(c.old_price)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: c.changed ? 700 : 400 }}>
                      {money(c.new_price)}
                    </TableCell>
                    <TableCell align="right">{c.changed ? deltaLabel(c.delta, c.delta_percent) : '—'}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );

  const confirmStep = preview && (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Alert severity="info">
        {t('bulkPrice.summary', { types: preview.changed_room_types, fields: preview.changed_fields })}{' '}
        {t('bulkPrice.immediateHint')}
      </Alert>
      <TextField
        label={t('bulkPrice.reason')}
        helperText={t('bulkPrice.reasonHelp')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        fullWidth
        multiline
        minRows={2}
        slotProps={{ htmlInput: { maxLength: 500 } }}
      />
      {preview.requires_confirmation && (
        <FormControlLabel
          control={<Checkbox checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />}
          label={t('bulkPrice.confirmLarge', { percent: preview.large_change_percent })}
        />
      )}
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullScreen={isPhone}
      maxWidth="md"
      fullWidth
      aria-labelledby="bulk-price-title"
    >
      <DialogTitle id="bulk-price-title" sx={{ pr: 7 }}>
        {t('bulkPrice.title')}
        <IconButton
          aria-label={t('bulkPrice.close')}
          onClick={onClose}
          disabled={busy}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} alternativeLabel={!isPhone} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {step === 0 && configureStep}
        {step === 1 && previewStep}
        {step === 2 && confirmStep}
      </DialogContent>
      <DialogActions
        sx={{
          position: isPhone ? 'sticky' : undefined,
          bottom: 0,
          bgcolor: 'background.paper',
          px: 2,
          py: 1.5,
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        {step === 0 ? (
          <Button onClick={onClose} disabled={busy}>
            {t('bulkPrice.cancel')}
          </Button>
        ) : (
          <Button onClick={() => setStep(step - 1)} disabled={busy}>
            {t('bulkPrice.back')}
          </Button>
        )}
        {step === 0 && (
          <Button
            variant="contained"
            onClick={goPreview}
            disabled={!configValid || busy}
            startIcon={previewMutation.isPending ? <CircularProgress size={16} /> : undefined}
          >
            {t('bulkPrice.next')}
          </Button>
        )}
        {step === 1 && (
          <Button
            variant="contained"
            onClick={() => setStep(2)}
            disabled={!preview || preview.changed_fields === 0}
          >
            {t('bulkPrice.next')}
          </Button>
        )}
        {step === 2 && (
          <Button
            variant="contained"
            onClick={apply}
            disabled={!canApply}
            startIcon={applyMutation.isPending ? <CircularProgress size={16} /> : undefined}
          >
            {t('bulkPrice.apply')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default BulkPriceDialog;
