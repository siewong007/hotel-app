import React from 'react';
import {
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
import type { RevenueChannelMix } from '../types';

interface ChannelMixTableProps {
  channels: RevenueChannelMix[];
}

/** Booking-creation-date attribution: which channels produced the revenue. */
const ChannelMixTable: React.FC<ChannelMixTableProps> = ({ channels }) => (
  <Card>
    <CardHeader
      title="Channel contribution"
      subheader="Net revenue by booking creation date"
    />
    <CardContent>
      {channels.length === 0 ? (
        <Typography color="text.secondary">
          No attributed bookings were created in this range.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Channel</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Bookings</TableCell>
                <TableCell align="right">Net revenue</TableCell>
                <TableCell align="right">Share</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channels.map((channel) => (
                <TableRow key={channel.channel_id ?? 'direct'}>
                  <TableCell>{channel.channel_name}</TableCell>
                  <TableCell>{channel.channel_type}</TableCell>
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

export default ChannelMixTable;
