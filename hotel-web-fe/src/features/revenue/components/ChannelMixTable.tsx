import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { formatCurrency } from '../../../utils/currency';
import { formatStatusLabel } from '../../../utils/formatters';
import { useTranslation } from '../../../i18n';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import type { RevenueChannelMix } from '../types';

interface ChannelMixTableProps {
  channels: RevenueChannelMix[];
}

/** Booking-creation-date attribution: which channels produced the revenue. */
const ChannelMixTable: React.FC<ChannelMixTableProps> = ({ channels }) => {
  const { t, tOr } = useTranslation('revenue');
  const isPhone = useIsPhone();

  return (
    <Card>
      <CardHeader
        title={t('channels.title')}
        subheader={t('channels.subtitle')}
      />
      <CardContent sx={isPhone ? { px: 0, '&:last-child': { pb: 1 } } : undefined}>
        {channels.length === 0 ? (
          <Typography color="text.secondary" sx={isPhone ? { px: 2 } : undefined}>
            {t('channels.empty')}
          </Typography>
        ) : isPhone ? (
          <Box>
            {channels.map((channel) => (
              <Box
                key={channel.channel_id ?? 'direct'}
                sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <MobileCardRow
                  title={channel.channel_name}
                  subtitle={tOr(`channelTypes.${channel.channel_type}`, formatStatusLabel(channel.channel_type))}
                  meta={t('channels.mobileMeta', {
                    count: channel.bookings,
                    revenue: formatCurrency(Number.parseFloat(channel.net_revenue) || 0),
                  })}
                  status={
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {(Number.parseFloat(channel.share_pct) || 0).toFixed(1)}%
                    </Typography>
                  }
                />
              </Box>
            ))}
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('channels.colChannel')}</TableCell>
                  <TableCell>{t('common:field.type')}</TableCell>
                  <TableCell align="right">{t('channels.colBookings')}</TableCell>
                  <TableCell align="right">{t('channels.colNetRevenue')}</TableCell>
                  <TableCell align="right">{t('channels.colShare')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.channel_id ?? 'direct'}>
                    <TableCell>{channel.channel_name}</TableCell>
                    <TableCell>{tOr(`channelTypes.${channel.channel_type}`, formatStatusLabel(channel.channel_type))}</TableCell>
                    <TableCell align="right">{channel.bookings}</TableCell>
                    <TableCell align="right">
                      {formatCurrency(Number.parseFloat(channel.net_revenue) || 0)}
                    </TableCell>
                    <TableCell align="right">
                      {(Number.parseFloat(channel.share_pct) || 0).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default ChannelMixTable;
