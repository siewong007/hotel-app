import {
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';

import { useTranslation } from '../../../i18n/useTranslation';
import { formatStatusLabel } from '../../../utils/formatters';
import { toNumber } from '../../../utils/currency';
import type { BookingChannel } from '../types';

interface Props {
  channels: BookingChannel[];
  canWrite: boolean;
  onOpen: (channel: BookingChannel) => void;
  onEdit: (channel: BookingChannel) => void;
  onDeactivate: (channel: BookingChannel) => void;
}

function commissionSummary(channel: BookingChannel, fallback: string): string {
  if (channel.default_commission_type === 'percentage') {
    return `${toNumber(channel.default_commission_value)}%`;
  }
  if (channel.default_commission_type === 'fixed_amount') {
    return `${toNumber(channel.default_commission_value)} / ${channel.default_commission_scope === 'per_night' ? 'night' : 'booking'}`;
  }
  return fallback;
}

export const ChannelTable = ({ channels, canWrite, onOpen, onEdit, onDeactivate }: Props) => {
  const { t, tOr } = useTranslation('channels');
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('list.columns.name')}</TableCell>
          <TableCell>{t('list.columns.type')}</TableCell>
          <TableCell>{t('list.columns.code')}</TableCell>
          <TableCell>{t('list.columns.commission')}</TableCell>
          <TableCell>{t('list.columns.integration')}</TableCell>
          <TableCell>{t('list.columns.status')}</TableCell>
          <TableCell align="right">{t('list.columns.actions')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {channels.map((channel) => (
          <TableRow key={channel.id} hover>
            <TableCell>
              {channel.name}
              {channel.abbreviation ? ` (${channel.abbreviation})` : ''}
            </TableCell>
            <TableCell>{tOr(`types.${channel.channel_type}`, formatStatusLabel(channel.channel_type))}</TableCell>
            <TableCell>{channel.code ?? '—'}</TableCell>
            <TableCell>{commissionSummary(channel, t('list.noCommission'))}</TableCell>
            <TableCell>{tOr(`integration.${channel.integration_mode}`, formatStatusLabel(channel.integration_mode))}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={channel.is_active ? t('status.active') : t('status.inactive')}
                color={channel.is_active ? 'success' : 'default'}
                variant={channel.is_active ? 'filled' : 'outlined'}
              />
            </TableCell>
            <TableCell align="right">
              <Tooltip title={t('list.open')}>
                <IconButton size="small" onClick={() => onOpen(channel)}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {canWrite && (
                <>
                  <Tooltip title={t('list.edit')}>
                    <IconButton size="small" onClick={() => onEdit(channel)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {channel.is_active && (
                    <Tooltip title={t('list.deactivate')}>
                      <IconButton size="small" onClick={() => onDeactivate(channel)}>
                        <PauseCircleIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
