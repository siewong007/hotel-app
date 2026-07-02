import React from 'react';
import { Box } from '@mui/material';
// Chip from the DS bundle so its status colors use the hotel theme palette.
import { Chip, DataTable } from 'hotel-web-fe';

const bookings = [
  { ref: 'BK-10241', guest: 'Aisha Rahman', room: '1204 · Deluxe King', nights: 3, status: 'Checked in', total: 'RM 987' },
  { ref: 'BK-10242', guest: 'Daniel Lee', room: '0815 · Twin', nights: 2, status: 'Confirmed', total: 'RM 540' },
  { ref: 'BK-10243', guest: 'Priya Nair', room: '2101 · Suite', nights: 5, status: 'Checked out', total: 'RM 3,120' },
  { ref: 'BK-10244', guest: 'Marcus Tan', room: '0937 · Deluxe', nights: 1, status: 'Pending', total: 'RM 329' },
];

const statusColor = (s: string) =>
  s === 'Checked in' ? 'success' : s === 'Confirmed' ? 'info' : s === 'Pending' ? 'warning' : 'default';

const columns = [
  { accessorKey: 'ref', header: 'Ref' },
  { accessorKey: 'guest', header: 'Guest' },
  { accessorKey: 'room', header: 'Room' },
  { accessorKey: 'nights', header: 'Nights' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }: any) => (
      <Chip size="small" color={statusColor(getValue()) as any} label={getValue()} />
    ),
  },
  { accessorKey: 'total', header: 'Total' },
];

export function Bookings() {
  return (
    <Box sx={{ maxWidth: 720 }}>
      <DataTable data={bookings} columns={columns} enablePagination={false} />
    </Box>
  );
}

export function Empty() {
  return (
    <Box sx={{ maxWidth: 720 }}>
      <DataTable data={[]} columns={columns} emptyMessage="No bookings for the selected date." enablePagination={false} />
    </Box>
  );
}
