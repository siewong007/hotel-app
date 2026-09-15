import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

import { useTranslation } from '../../../i18n/useTranslation';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useRatePlans, useRateRoomTypes } from '../../rates/hooks/useRatePlans';
import type { useChannelDetailMutations } from '../hooks/useChannels';
import type {
  ChannelMappings,
  ChannelRatePlanMapping,
  ChannelRoomTypeMapping,
} from '../types';

interface Props {
  mappings: ChannelMappings | undefined;
  loading: boolean;
  canWrite: boolean;
  mutations: ReturnType<typeof useChannelDetailMutations>;
}

interface RoomMappingForm {
  room_type_id: string;
  external_room_id: string;
  external_room_name: string;
}

interface PlanMappingForm {
  rate_plan_id: string;
  external_rate_plan_id: string;
  external_rate_plan_name: string;
}

/**
 * Channel ↔ room-type / rate-plan identifier mappings. These are integration
 * metadata for a future channel-manager sync — nothing syncs today.
 */
export const MappingsPanel = ({ mappings, loading, canWrite, mutations }: Props) => {
  const { t } = useTranslation('channels');
  const confirm = useConfirm();
  const roomTypes = useRateRoomTypes();
  const plans = useRatePlans();
  const [roomForm, setRoomForm] = useState<RoomMappingForm | null>(null);
  const [planForm, setPlanForm] = useState<PlanMappingForm | null>(null);

  if (loading) return <Skeleton variant="rounded" height={200} />;
  if (!mappings) return null;

  const removeRoom = async (mapping: ChannelRoomTypeMapping) => {
    if (
      await confirm({
        title: t('mappings.deleteTitle'),
        message: t('mappings.deleteMessage'),
        confirmText: t('common:actions.delete'),
        severity: 'warning',
      })
    ) {
      mutations.deleteRoomMapping.mutate(mapping.id);
    }
  };
  const removePlan = async (mapping: ChannelRatePlanMapping) => {
    if (
      await confirm({
        title: t('mappings.deleteTitle'),
        message: t('mappings.deleteMessage'),
        confirmText: t('common:actions.delete'),
        severity: 'warning',
      })
    ) {
      mutations.deletePlanMapping.mutate(mapping.id);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Alert severity="info">{t('mappings.notice')}</Alert>

      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1">{t('mappings.roomTypes')}</Typography>
          {canWrite && (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                setRoomForm({ room_type_id: '', external_room_id: '', external_room_name: '' })
              }
            >
              {t('mappings.add')}
            </Button>
          )}
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('mappings.columns.roomType')}</TableCell>
              <TableCell>{t('mappings.columns.externalId')}</TableCell>
              <TableCell>{t('mappings.columns.externalName')}</TableCell>
              <TableCell>{t('mappings.columns.enabled')}</TableCell>
              <TableCell align="right">{t('mappings.columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.room_types.map((mapping) => (
              <TableRow key={mapping.id} hover>
                <TableCell>{mapping.room_type_name ?? `#${mapping.room_type_id}`}</TableCell>
                <TableCell>{mapping.external_room_id ?? '—'}</TableCell>
                <TableCell>{mapping.external_room_name ?? '—'}</TableCell>
                <TableCell>
                  <Switch
                    size="small"
                    checked={mapping.is_enabled}
                    disabled={!canWrite}
                    onChange={(event) =>
                      mutations.upsertRoomMapping.mutate({
                        room_type_id: mapping.room_type_id,
                        external_room_id: mapping.external_room_id,
                        external_room_name: mapping.external_room_name,
                        is_enabled: event.target.checked,
                      })
                    }
                  />
                </TableCell>
                <TableCell align="right">
                  {canWrite && (
                    <Tooltip title={t('common:actions.delete')}>
                      <IconButton size="small" onClick={() => removeRoom(mapping)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {mappings.room_types.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    {t('mappings.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1">{t('mappings.ratePlans')}</Typography>
          {canWrite && (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                setPlanForm({
                  rate_plan_id: '',
                  external_rate_plan_id: '',
                  external_rate_plan_name: '',
                })
              }
            >
              {t('mappings.add')}
            </Button>
          )}
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('mappings.columns.ratePlan')}</TableCell>
              <TableCell>{t('mappings.columns.externalId')}</TableCell>
              <TableCell>{t('mappings.columns.externalName')}</TableCell>
              <TableCell>{t('mappings.columns.enabled')}</TableCell>
              <TableCell align="right">{t('mappings.columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.rate_plans.map((mapping) => (
              <TableRow key={mapping.id} hover>
                <TableCell>{mapping.rate_plan_name ?? `#${mapping.rate_plan_id}`}</TableCell>
                <TableCell>{mapping.external_rate_plan_id ?? '—'}</TableCell>
                <TableCell>{mapping.external_rate_plan_name ?? '—'}</TableCell>
                <TableCell>
                  <Switch
                    size="small"
                    checked={mapping.is_enabled}
                    disabled={!canWrite}
                    onChange={(event) =>
                      mutations.upsertPlanMapping.mutate({
                        rate_plan_id: mapping.rate_plan_id,
                        external_rate_plan_id: mapping.external_rate_plan_id,
                        external_rate_plan_name: mapping.external_rate_plan_name,
                        is_enabled: event.target.checked,
                      })
                    }
                  />
                </TableCell>
                <TableCell align="right">
                  {canWrite && (
                    <Tooltip title={t('common:actions.delete')}>
                      <IconButton size="small" onClick={() => removePlan(mapping)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {mappings.rate_plans.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    {t('mappings.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Dialog open={roomForm !== null} onClose={() => setRoomForm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('mappings.roomDialogTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            select
            label={t('mappings.columns.roomType')}
            value={roomForm?.room_type_id ?? ''}
            onChange={(event) =>
              setRoomForm((cur) => cur && { ...cur, room_type_id: event.target.value })
            }
            fullWidth
          >
            {(roomTypes.data ?? []).map((rt) => (
              <MenuItem key={rt.id} value={String(rt.id)}>
                {rt.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('mappings.columns.externalId')}
            value={roomForm?.external_room_id ?? ''}
            onChange={(event) =>
              setRoomForm((cur) => cur && { ...cur, external_room_id: event.target.value })
            }
          />
          <TextField
            label={t('mappings.columns.externalName')}
            value={roomForm?.external_room_name ?? ''}
            onChange={(event) =>
              setRoomForm((cur) => cur && { ...cur, external_room_name: event.target.value })
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoomForm(null)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!roomForm?.room_type_id}
            onClick={() => {
              if (!roomForm) return;
              mutations.upsertRoomMapping.mutate(
                {
                  room_type_id: Number(roomForm.room_type_id),
                  external_room_id: roomForm.external_room_id || null,
                  external_room_name: roomForm.external_room_name || null,
                  is_enabled: true,
                },
                { onSuccess: () => setRoomForm(null) },
              );
            }}
          >
            {t('common:actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={planForm !== null} onClose={() => setPlanForm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('mappings.planDialogTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            select
            label={t('mappings.columns.ratePlan')}
            value={planForm?.rate_plan_id ?? ''}
            onChange={(event) =>
              setPlanForm((cur) => cur && { ...cur, rate_plan_id: event.target.value })
            }
            fullWidth
          >
            {(plans.data ?? []).map((plan) => (
              <MenuItem key={plan.id} value={String(plan.id)}>
                {plan.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('mappings.columns.externalId')}
            value={planForm?.external_rate_plan_id ?? ''}
            onChange={(event) =>
              setPlanForm((cur) => cur && { ...cur, external_rate_plan_id: event.target.value })
            }
          />
          <TextField
            label={t('mappings.columns.externalName')}
            value={planForm?.external_rate_plan_name ?? ''}
            onChange={(event) =>
              setPlanForm((cur) => cur && { ...cur, external_rate_plan_name: event.target.value })
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlanForm(null)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!planForm?.rate_plan_id}
            onClick={() => {
              if (!planForm) return;
              mutations.upsertPlanMapping.mutate(
                {
                  rate_plan_id: Number(planForm.rate_plan_id),
                  external_rate_plan_id: planForm.external_rate_plan_id || null,
                  external_rate_plan_name: planForm.external_rate_plan_name || null,
                  is_enabled: true,
                },
                { onSuccess: () => setPlanForm(null) },
              );
            }}
          >
            {t('common:actions.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
