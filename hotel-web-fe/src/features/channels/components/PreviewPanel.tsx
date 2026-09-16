import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { formatCurrency, toNumber } from '../../../utils/currency';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import { useRatePlans, useRateRoomTypes } from '../../rates/hooks/useRatePlans';
import { useChannelPreview } from '../hooks/useChannels';

interface Props {
  channelId: number;
}

const optNum = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : toNumber(value);

/** Preview calculator: resolve one stay on this channel without writing. */
export const PreviewPanel = ({ channelId }: Props) => {
  const { t } = useTranslation('channels');
  const roomTypes = useRateRoomTypes();
  const plans = useRatePlans();
  const preview = useChannelPreview();

  const [roomTypeId, setRoomTypeId] = useState('');
  const [ratePlanId, setRatePlanId] = useState('');
  const [checkIn, setCheckIn] = useState(() => formatLocalDate(new Date()));
  const [checkOut, setCheckOut] = useState(() =>
    formatLocalDate(addLocalDays(new Date(), 1)),
  );

  const canRun = roomTypeId !== '' && checkIn < checkOut;

  const run = () => {
    preview.mutate({
      channel_id: channelId,
      room_type_id: Number(roomTypeId),
      rate_plan_id: ratePlanId === '' ? null : Number(ratePlanId),
      check_in: checkIn,
      check_out: checkOut,
    });
  };

  const result = preview.data;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          label={t('preview.roomType')}
          value={roomTypeId}
          onChange={(event) => setRoomTypeId(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          {(roomTypes.data ?? []).map((rt) => (
            <MenuItem key={rt.id} value={String(rt.id)}>
              {rt.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('preview.ratePlan')}
          value={ratePlanId}
          onChange={(event) => setRatePlanId(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('rules.scopeAnyPlan')}</MenuItem>
          {(plans.data ?? []).map((plan) => (
            <MenuItem key={plan.id} value={String(plan.id)}>
              {plan.name}
            </MenuItem>
          ))}
        </TextField>
        <ModernDatePicker
          label={t('preview.checkIn')}
          value={checkIn}
          onChange={setCheckIn}
        />
        <ModernDatePicker
          label={t('preview.checkOut')}
          value={checkOut}
          onChange={setCheckOut}
        />
        <Button variant="contained" onClick={run} disabled={!canRun || preview.isPending}>
          {t('preview.run')}
        </Button>
      </Box>
      {checkIn >= checkOut && (
        <Alert severity="warning">{t('preview.windowError')}</Alert>
      )}
      {preview.error && <Alert severity="error">{t('preview.error')}</Alert>}

      {result && (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('preview.columns.date')}</TableCell>
                <TableCell align="right">{t('preview.columns.sourceRate')}</TableCell>
                <TableCell align="right">{t('preview.columns.sellingPrice')}</TableCell>
                <TableCell>{t('preview.columns.rule')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.nights.map((night) => (
                <TableRow key={night.date}>
                  <TableCell>{night.date}</TableCell>
                  <TableCell align="right">
                    {formatCurrency(toNumber(night.source_rate), result.currency)}
                  </TableCell>
                  <TableCell align="right">
                    {optNum(night.selling_price) !== null
                      ? formatCurrency(toNumber(night.selling_price), result.currency)
                      : night.net_rate !== null
                        ? `${formatCurrency(toNumber(night.net_rate), result.currency)} ${t('matrix.netTag')}`
                        : '—'}
                  </TableCell>
                  <TableCell>{night.rule_label}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Typography variant="body2">
              {t('preview.sellingSubtotal')}:{' '}
              <strong>
                {optNum(result.selling_subtotal) !== null
                  ? formatCurrency(toNumber(result.selling_subtotal), result.currency)
                  : t('preview.channelManaged')}
              </strong>
            </Typography>
            <Typography variant="body2">
              {t('preview.estimatedCommission')}:{' '}
              <strong>
                {optNum(result.commission_amount) !== null
                  ? formatCurrency(toNumber(result.commission_amount), result.currency)
                  : '—'}
              </strong>
            </Typography>
            <Typography variant="body2">
              {t('preview.estimatedNet')}:{' '}
              <strong>
                {optNum(result.net_revenue) !== null
                  ? formatCurrency(toNumber(result.net_revenue), result.currency)
                  : '—'}
              </strong>
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('preview.disclaimer')}
          </Typography>
        </>
      )}
    </Box>
  );
};
