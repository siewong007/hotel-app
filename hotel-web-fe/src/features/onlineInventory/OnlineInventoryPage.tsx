import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Container, FormControlLabel,
  IconButton, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

import { api } from '../../api/client';
import { formatLocalDate } from '../../utils/date';

interface Allocation {
  room_type_id: number;
  room_type_code: string;
  room_type_name: string;
  stay_date: string;
  physical_available_rooms: number;
  walk_in_reserved_rooms: number;
  online_booking_enabled: boolean;
  online_available_rooms: number;
}

const dateInput = () => formatLocalDate();

const OnlineInventoryPage: React.FC = () => {
  const [stayDate, setStayDate] = useState(dateInput);
  const [items, setItems] = useState<Allocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setItems(await api.get('admin/online-inventory', { searchParams: { stay_date: stayDate } }).json<Allocation[]>());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load online inventory.');
    } finally {
      setIsLoading(false);
    }
  }, [stayDate]);

  useEffect(() => { void load(); }, [load]);

  const save = async (item: Allocation) => {
    setError(null);
    try {
      const updated = await api.put(`admin/online-inventory/${item.room_type_id}/${stayDate}`, {
        json: {
          walk_in_reserved_rooms: item.walk_in_reserved_rooms,
          online_booking_enabled: item.online_booking_enabled,
        },
      }).json<Allocation>();
      setItems((current) => current.map((entry) => entry.room_type_id === updated.room_type_id ? updated : entry));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save this allocation.');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} alignItems={{ sm: 'center' }}>
        <Box>
          <Typography variant="h4">Online Inventory Control</Typography>
          <Typography color="text.secondary">Protect rooms for walk-ins before releasing the remaining rooms online.</Typography>
        </Box>
        <TextField label="Stay date" type="date" value={stayDate} onChange={(event) => setStayDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Paper sx={{ mt: 3, overflow: 'auto' }}>
        {isLoading ? <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /></Box> : (
          <Table>
            <TableHead><TableRow><TableCell>Room type</TableCell><TableCell align="right">Physical free</TableCell><TableCell>Walk-in reserve</TableCell><TableCell>Online open</TableCell><TableCell align="right">Online available</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>{items.map((item) => (
              <TableRow key={item.room_type_id}>
                <TableCell><strong>{item.room_type_name}</strong><br /><Typography variant="caption">{item.room_type_code}</Typography></TableCell>
                <TableCell align="right">{item.physical_available_rooms}</TableCell>
                <TableCell><TextField size="small" type="number" inputProps={{ min: 0 }} value={item.walk_in_reserved_rooms} onChange={(event) => setItems((current) => current.map((entry) => entry.room_type_id === item.room_type_id ? { ...entry, walk_in_reserved_rooms: Math.max(0, Number(event.target.value)) } : entry))} /></TableCell>
                <TableCell><FormControlLabel control={<Checkbox checked={item.online_booking_enabled} onChange={(event) => setItems((current) => current.map((entry) => entry.room_type_id === item.room_type_id ? { ...entry, online_booking_enabled: event.target.checked } : entry))} />} label="Open" /></TableCell>
                <TableCell align="right">{item.online_booking_enabled ? Math.max(0, item.physical_available_rooms - item.walk_in_reserved_rooms) : 0}</TableCell>
                <TableCell><IconButton aria-label="Save allocation" onClick={() => void save(item)}><SaveIcon /></IconButton></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Paper>
      <Button sx={{ mt: 2 }} onClick={() => void load()}>Refresh availability</Button>
    </Container>
  );
};

export default OnlineInventoryPage;
