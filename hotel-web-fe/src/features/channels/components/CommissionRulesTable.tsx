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
import { toNumber } from '../../../utils/currency';
import type { ChannelCommissionRule } from '../types';

interface Props {
  rules: ChannelCommissionRule[];
  canWrite: boolean;
  canManage: boolean;
  onEdit: (rule: ChannelCommissionRule) => void;
  onToggleActive: (rule: ChannelCommissionRule, active: boolean) => void;
  onDelete: (rule: ChannelCommissionRule) => void;
}

export const CommissionRulesTable = ({
  rules,
  canWrite,
  canManage,
  onEdit,
  onToggleActive,
  onDelete,
}: Props) => {
  const { t, tOr } = useTranslation('channels');

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('commission.columns.type')}</TableCell>
          <TableCell>{t('commission.columns.value')}</TableCell>
          <TableCell>{t('commission.columns.scope')}</TableCell>
          <TableCell>{t('commission.columns.window')}</TableCell>
          <TableCell>{t('commission.columns.priority')}</TableCell>
          <TableCell>{t('commission.columns.status')}</TableCell>
          <TableCell align="right">{t('commission.columns.actions')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.id} hover>
            <TableCell>
              {tOr(`commissionTypes.${rule.commission_type}`, formatStatusLabel(rule.commission_type))}
            </TableCell>
            <TableCell>
              {rule.commission_type === 'percentage'
                ? `${toNumber(rule.value)}%`
                : String(toNumber(rule.value))}
            </TableCell>
            <TableCell>
              {tOr(`commissionScopes.${rule.scope}`, formatStatusLabel(rule.scope))}
            </TableCell>
            <TableCell>
              {rule.effective_from} → {rule.effective_to ?? t('rules.openEnded')}
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
                  <Switch
                    size="small"
                    checked={rule.is_active}
                    onChange={(event) => onToggleActive(rule, event.target.checked)}
                  />
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
