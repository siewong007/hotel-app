import {
  Box,
  Button,
  Chip,
  Divider,
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

import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { TableScroll } from '../../../components/data-table/TableScroll';
import { useIsPhone } from '../../../hooks/useIsPhone';
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
  const isPhone = useIsPhone();

  const statusChip = (channel: BookingChannel) => (
    <Chip
      size="small"
      label={channel.is_active ? t('status.active') : t('status.inactive')}
      color={channel.is_active ? 'success' : 'default'}
      variant={channel.is_active ? 'filled' : 'outlined'}
    />
  );

  if (isPhone) {
    // Seven columns cannot fit a phone: the row actions ended up past the
    // right edge, unreachable. One card per channel instead; tapping the card
    // opens the channel, edit/deactivate sit in the card footer.
    return (
      <Box data-testid="channel-cards">
        {channels.map((channel, index) => (
          <Box key={channel.id}>
            {index > 0 && <Divider />}
            <MobileCardRow
              title={`${channel.name}${channel.abbreviation ? ` (${channel.abbreviation})` : ''}`}
              subtitle={[
                tOr(`types.${channel.channel_type}`, formatStatusLabel(channel.channel_type)),
                channel.code,
              ]
                .filter(Boolean)
                .join(' · ')}
              meta={`${commissionSummary(channel, t('list.noCommission'))} · ${tOr(
                `integration.${channel.integration_mode}`,
                formatStatusLabel(channel.integration_mode)
              )}`}
              status={statusChip(channel)}
              onClick={() => onOpen(channel)}
              footer={
                canWrite ? (
                  <>
                    <Button size="small" startIcon={<EditIcon />} onClick={() => onEdit(channel)}>
                      {t('list.edit')}
                    </Button>
                    {channel.is_active && (
                      <Button
                        size="small"
                        color="warning"
                        startIcon={<PauseCircleIcon />}
                        onClick={() => onDeactivate(channel)}
                      >
                        {t('list.deactivate')}
                      </Button>
                    )}
                  </>
                ) : undefined
              }
            />
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <TableScroll>
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
              <TableCell>{statusChip(channel)}</TableCell>
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
    </TableScroll>
  );
};
