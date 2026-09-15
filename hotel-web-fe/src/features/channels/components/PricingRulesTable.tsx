import {
  Chip,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

import { useTranslation } from '../../../i18n/useTranslation';
import { formatStatusLabel } from '../../../utils/formatters';
import { useRatePlans, useRateRoomTypes } from '../../rates/hooks/useRatePlans';
import { PERCENT_RULE_TYPES } from '../constants';
import { toNumber } from '../../../utils/currency';
import type { ChannelPricingRule } from '../types';

interface Props {
  rules: ChannelPricingRule[];
  canWrite: boolean;
  canManage: boolean;
  onEdit: (rule: ChannelPricingRule) => void;
  onToggleActive: (rule: ChannelPricingRule, active: boolean) => void;
  onDelete: (rule: ChannelPricingRule) => void;
}

export const PricingRulesTable = ({
  rules,
  canWrite,
  canManage,
  onEdit,
  onToggleActive,
  onDelete,
}: Props) => {
  const { t, tOr } = useTranslation('channels');
  const roomTypes = useRateRoomTypes();
  const plans = useRatePlans();

  const roomTypeName = (id: number | null) =>
    id === null
      ? t('rules.scopeAllRooms')
      : (roomTypes.data?.find((rt) => rt.id === id)?.name ?? `#${id}`);
  const planName = (id: number | null) =>
    id === null
      ? t('rules.scopeAnyPlan')
      : (plans.data?.find((plan) => plan.id === id)?.name ?? `#${id}`);

  const valueLabel = (rule: ChannelPricingRule) => {
    const value = toNumber(rule.value);
    return PERCENT_RULE_TYPES.has(rule.rule_type) ? `${value}%` : String(value);
  };

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('rules.columns.type')}</TableCell>
          <TableCell>{t('rules.columns.value')}</TableCell>
          <TableCell>{t('rules.columns.roomType')}</TableCell>
          <TableCell>{t('rules.columns.ratePlan')}</TableCell>
          <TableCell>{t('rules.columns.window')}</TableCell>
          <TableCell>{t('rules.columns.bounds')}</TableCell>
          <TableCell>{t('rules.columns.priority')}</TableCell>
          <TableCell>{t('rules.columns.status')}</TableCell>
          <TableCell align="right">{t('rules.columns.actions')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.id} hover>
            <TableCell>
              {tOr(`ruleTypes.${rule.rule_type}`, formatStatusLabel(rule.rule_type))}
            </TableCell>
            <TableCell>{valueLabel(rule)}</TableCell>
            <TableCell>{roomTypeName(rule.room_type_id)}</TableCell>
            <TableCell>{planName(rule.rate_plan_id)}</TableCell>
            <TableCell>
              {rule.effective_from} → {rule.effective_to ?? t('rules.openEnded')}
            </TableCell>
            <TableCell>
              {rule.min_price !== null || rule.max_price !== null
                ? `${rule.min_price ?? '—'} / ${rule.max_price ?? '—'}`
                : '—'}
            </TableCell>
            <TableCell>{rule.priority}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={rule.is_active ? t('status.active') : t('status.inactive')}
                color={rule.is_active ? 'success' : 'default'}
                variant={rule.is_active ? 'filled' : 'outlined'}
              />
            </TableCell>
            <TableCell align="right">
              {canWrite && (
                <>
                  <Tooltip title={t('list.edit')}>
                    <IconButton size="small" onClick={() => onEdit(rule)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={rule.is_active ? t('rules.disable') : t('rules.enable')}>
                    <Switch
                      size="small"
                      checked={rule.is_active}
                      onChange={(event) => onToggleActive(rule, event.target.checked)}
                    />
                  </Tooltip>
                </>
              )}
              {canManage && (
                <Tooltip title={t('common:actions.delete')}>
                  <IconButton size="small" onClick={() => onDelete(rule)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
