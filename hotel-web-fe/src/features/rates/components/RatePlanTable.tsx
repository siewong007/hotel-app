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

import { DOW_FLAGS } from '../constants';
import type { RatePlan } from '../types';
import { formatHotelDate } from '../../../utils/date';

export interface RatePlanTableProps {
  plans: RatePlan[];
  canManage: boolean;
  onEdit(plan: RatePlan): void;
  onToggleActive(plan: RatePlan, active: boolean): void;
  onDelete(plan: RatePlan): void;
}

const dowChips = (plan: RatePlan) =>
  DOW_FLAGS.filter(([flag]) => plan[flag as keyof RatePlan] === true).map(
    ([, label]) => label,
  );

export const RatePlanTable = ({
  plans,
  canManage,
  onEdit,
  onToggleActive,
  onDelete,
}: RatePlanTableProps) => (
  <TableContainer>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Plan</TableCell>
          <TableCell>Type</TableCell>
          <TableCell>Adjustment</TableCell>
          <TableCell>Validity</TableCell>
          <TableCell>Days</TableCell>
          <TableCell align="right">Min/Max nights</TableCell>
          <TableCell align="right">Priority</TableCell>
          <TableCell align="center">Active</TableCell>
          {canManage && <TableCell align="right">Actions</TableCell>}
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
              <Chip label={plan.plan_type} size="small" variant="outlined" />
            </TableCell>
            <TableCell>
              {plan.adjustment_value
                ? `${plan.adjustment_type} ${plan.adjustment_value}`
                : plan.adjustment_type}
            </TableCell>
            <TableCell>
              <Typography variant="body2">
                {plan.valid_from ? formatHotelDate(plan.valid_from) : '—'} →{' '}
                {plan.valid_to ? formatHotelDate(plan.valid_to) : '—'}
              </Typography>
            </TableCell>
            <TableCell>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {dowChips(plan).length === 7 ? (
                  <Chip label="All days" size="small" />
                ) : (
                  dowChips(plan).map((day) => (
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
                slotProps={{ input: { 'aria-label': `Toggle ${plan.name}` } }}
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
