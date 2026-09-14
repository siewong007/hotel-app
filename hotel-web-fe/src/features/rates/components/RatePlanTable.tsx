import {
  Box,
  Chip,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { useTranslation } from '../../../i18n/useTranslation';
import { DOW_FLAGS } from '../constants';
import type { RatePlan } from '../types';
import { formatHotelDate } from '../../../utils/date';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';

export interface RatePlanTableProps {
  plans: RatePlan[];
  canManage: boolean;
  onEdit(plan: RatePlan): void;
  onToggleActive(plan: RatePlan, active: boolean): void;
  onDelete(plan: RatePlan): void;
}

const dowChips = (plan: RatePlan, t: (key: string) => string) =>
  DOW_FLAGS.filter(([flag]) => plan[flag as keyof RatePlan] === true).map(
    ([, dayKey]) => t(`days.${dayKey}`),
  );

export const RatePlanTable = ({
  plans,
  canManage,
  onEdit,
  onToggleActive,
  onDelete,
}: RatePlanTableProps) => {
  const { t } = useTranslation('rates');
  const isPhone = useIsPhone();

  if (isPhone) {
    return (
      <Box>
        {plans.map((plan) => {
          const days = dowChips(plan, t);
          return (
            <Box
              key={plan.id}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <MobileCardRow
                title={plan.name}
                subtitle={`${plan.code} · ${t(`planTypes.${plan.plan_type}`)} · ${plan.adjustment_value ? `${t(`adjustmentTypes.${plan.adjustment_type}`)} ${plan.adjustment_value}` : t(`adjustmentTypes.${plan.adjustment_type}`)}`}
                meta={`${plan.valid_from ? formatHotelDate(plan.valid_from) : '—'} → ${plan.valid_to ? formatHotelDate(plan.valid_to) : '—'} · ${days.length === 7 ? t('plans.allDays') : days.join(' ')} · ${plan.max_nights ? t('plans.nightsMinMax', { min: plan.min_nights, max: plan.max_nights }) : t('plans.nightsMin', { min: plan.min_nights })}`}
                status={
                  <Chip
                    size="small"
                    label={plan.is_active ? t('plans.active') : t('plans.inactive')}
                    color={plan.is_active ? 'success' : 'default'}
                    variant="outlined"
                  />
                }
                footer={
                  <>
                    <Switch
                      size="small"
                      checked={plan.is_active}
                      disabled={!canManage}
                      onChange={(event) => onToggleActive(plan, event.target.checked)}
                      slotProps={{ input: { 'aria-label': t('plans.toggleAria', { name: plan.name }) } }}
                    />
                    {canManage ? (
                      <>
                        <Tooltip title={t('plans.editPlan')}>
                          <IconButton
                            size="small"
                            aria-label={t('plans.editAria', { name: plan.name })}
                            onClick={() => onEdit(plan)}
                          >
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('plans.deletePlan')}>
                          <IconButton
                            size="small"
                            aria-label={t('plans.deleteAria', { name: plan.name })}
                            onClick={() => onDelete(plan)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    ) : null}
                  </>
                }
              />
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
  <TableContainer>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('plans.colPlan')}</TableCell>
          <TableCell>{t('plans.colType')}</TableCell>
          <TableCell>{t('plans.colAdjustment')}</TableCell>
          <TableCell>{t('plans.colValidity')}</TableCell>
          <TableCell>{t('plans.colDays')}</TableCell>
          <TableCell align="right">{t('plans.colMinMax')}</TableCell>
          <TableCell align="right">{t('plans.colPriority')}</TableCell>
          <TableCell align="center">{t('plans.colActive')}</TableCell>
          {canManage && <TableCell align="right">{t('plans.colActions')}</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {plans.map((plan) => (
          <TableRow key={plan.id} hover>
            <TableCell>
              <Typography sx={{ fontWeight: 700 }}>{plan.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {plan.code}
              </Typography>
            </TableCell>
            <TableCell>
              <Chip label={t(`planTypes.${plan.plan_type}`)} size="small" variant="outlined" />
            </TableCell>
            <TableCell>
              {plan.adjustment_value
                ? `${t(`adjustmentTypes.${plan.adjustment_type}`)} ${plan.adjustment_value}`
                : t(`adjustmentTypes.${plan.adjustment_type}`)}
            </TableCell>
            <TableCell>
              <Typography variant="body2">
                {plan.valid_from ? formatHotelDate(plan.valid_from) : '—'} →{' '}
                {plan.valid_to ? formatHotelDate(plan.valid_to) : '—'}
              </Typography>
            </TableCell>
            <TableCell>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {dowChips(plan, t).length === 7 ? (
                  <Chip label={t('plans.allDays')} size="small" />
                ) : (
                  dowChips(plan, t).map((day) => (
                    <Chip key={day} label={day} size="small" />
                  ))
                )}
              </Box>
            </TableCell>
            <TableCell align="right">
              {plan.min_nights}
              {plan.max_nights ? ` / ${plan.max_nights}` : ' / —'}
            </TableCell>
            <TableCell align="right">{plan.priority}</TableCell>
            <TableCell align="center">
              <Switch
                size="small"
                checked={plan.is_active}
                disabled={!canManage}
                onChange={(event) => onToggleActive(plan, event.target.checked)}
                slotProps={{ input: { 'aria-label': t('plans.toggleAria', { name: plan.name }) } }}
              />
            </TableCell>
            {canManage && (
              <TableCell align="right">
                <Tooltip title="Edit plan">
                  <IconButton size="small" onClick={() => onEdit(plan)}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete plan">
                  <IconButton size="small" onClick={() => onDelete(plan)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
  );
};
