import { useMemo } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import { formatCurrency, toNumber } from '../../../utils/currency';
import { useRateRoomTypes } from '../../rates/hooks/useRatePlans';
import type { ChannelMatrix as ChannelMatrixData, ChannelMatrixCell } from '../types';

const optNum = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : toNumber(value);

interface Props {
  matrix: ChannelMatrixData;
}

/**
 * Room types × channels grid for a single date. Each cell shows the resolved
 * selling price (or the hotel net rate for net-rate channels) plus the
 * estimated net revenue on hover.
 */
export const ChannelMatrix = ({ matrix }: Props) => {
  const { t } = useTranslation('channels');
  const roomTypes = useRateRoomTypes();

  const channels = useMemo(() => {
    const seen = new Map<number, ChannelMatrixCell>();
    for (const cell of matrix.cells) {
      if (!seen.has(cell.channel_id)) seen.set(cell.channel_id, cell);
    }
    return [...seen.values()];
  }, [matrix.cells]);

  const cellsByKey = useMemo(() => {
    const map = new Map<string, ChannelMatrixCell>();
    for (const cell of matrix.cells) {
      map.set(`${cell.room_type_id}:${cell.channel_id}`, cell);
    }
    return map;
  }, [matrix.cells]);

  const currency = matrix.currency;
  const roomTypeIds = useMemo(() => {
    const ids = new Set(matrix.cells.map((cell) => cell.room_type_id));
    const known = roomTypes.data ?? [];
    const ordered = known.filter((rt) => ids.has(rt.id)).map((rt) => ({ id: rt.id, name: rt.name }));
    const missing = [...ids].filter((id) => !ordered.some((rt) => rt.id === id));
    return [...ordered, ...missing.map((id) => ({ id, name: `#${id}` }))];
  }, [matrix.cells, roomTypes.data]);

  if (matrix.cells.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('matrix.empty')}
      </Typography>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('matrix.roomType')}</TableCell>
            {channels.map((channel) => (
              <TableCell key={channel.channel_id} align="right">
                {channel.channel_name}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {roomTypeIds.map((roomType) => (
            <TableRow key={roomType.id} hover>
              <TableCell>{roomType.name}</TableCell>
              {channels.map((channel) => {
                const cell = cellsByKey.get(`${roomType.id}:${channel.channel_id}`);
                if (!cell) {
                  return (
                    <TableCell key={channel.channel_id} align="right">
                      —
                    </TableCell>
                  );
                }
                const selling = optNum(cell.selling_price);
                const net = optNum(cell.net_revenue);
                const display =
                  selling !== null
                    ? formatCurrency(selling, currency)
                    : cell.net_rate !== null
                      ? formatCurrency(toNumber(cell.net_rate), currency)
                      : '—';
                const tooltip = net !== null
                  ? t('matrix.cellTooltip', {
                      rule: cell.rule_label,
                      net: formatCurrency(net, currency),
                    })
                  : cell.rule_label;
                return (
                  <TableCell key={channel.channel_id} align="right">
                    <Tooltip title={tooltip}>
                      <span>
                        {display}
                        {selling === null && cell.net_rate !== null && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {' '}
                            {t('matrix.netTag')}
                          </Typography>
                        )}
                      </span>
                    </Tooltip>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};
