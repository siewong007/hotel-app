import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';

import type { OnlineInventoryAllocation } from '../types';
import { useCurrency } from '../../../hooks/useCurrency';

interface InventoryRoomCardProps {
  item: OnlineInventoryAllocation;
  isChanged: boolean;
  isDisabled: boolean;
  onChange: (
    patch: Partial<Pick<OnlineInventoryAllocation, 'walk_in_reserved_rooms' | 'online_booking_enabled' | 'custom_price'>>,
  ) => void;
}

export const InventoryRoomCard = ({ item, isChanged, isDisabled, onChange }: InventoryRoomCardProps) => {
  const theme = useTheme();
  const { symbol: currencySymbol } = useCurrency();
  const onlineAvailable = item.online_booking_enabled
    ? Math.max(0, item.physical_available_rooms - item.walk_in_reserved_rooms)
    : 0;
  const reserveExceedsInventory = item.walk_in_reserved_rooms > item.physical_available_rooms;

  const setReserve = (value: number) => {
    onChange({ walk_in_reserved_rooms: Math.max(0, Math.trunc(value || 0)) });
  };
  const customPriceInvalid = item.custom_price !== null && Number(item.custom_price) <= 0;

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        borderColor: isChanged ? 'primary.main' : 'divider',
        boxShadow: isChanged ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}` : 'none',
        transition: 'border-color 160ms ease, box-shadow 160ms ease',
      }}
    >
      <Stack spacing={2.25}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h6" fontWeight={800}>{item.room_type_name}</Typography>
              <Chip label={item.room_type_code} size="small" variant="outlined" />
              {isChanged && <Chip label="Unsaved" size="small" color="primary" />}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {item.physical_available_rooms} physically available for this stay date
            </Typography>
          </Box>
          <Tooltip title={item.online_booking_enabled ? 'Guests can book this room type online' : 'This room type is hidden from online booking'}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="body2" fontWeight={700} color={item.online_booking_enabled ? 'success.main' : 'text.secondary'}>
                {item.online_booking_enabled ? 'Online' : 'Offline'}
              </Typography>
              <Switch
                checked={item.online_booking_enabled}
                disabled={isDisabled}
                inputProps={{ 'aria-label': `Online booking for ${item.room_type_name}` }}
                onChange={(event) => onChange({ online_booking_enabled: event.target.checked })}
                color="success"
              />
            </Stack>
          </Tooltip>
        </Stack>

        <Divider />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(250px, 1fr) minmax(240px, 1fr) minmax(260px, 1fr)' }, gap: 2.5, alignItems: 'center' }}>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Box>
                <Typography fontWeight={750}>Hold for walk-ins</Typography>
                <Typography variant="body2" color="text.secondary">These rooms will not appear online.</Typography>
              </Box>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <IconButton
                aria-label={`Decrease walk-in reserve for ${item.room_type_name}`}
                onClick={() => setReserve(item.walk_in_reserved_rooms - 1)}
                disabled={isDisabled || item.walk_in_reserved_rooms === 0}
                sx={{ border: 1, borderColor: 'divider' }}
              >
                <RemoveIcon />
              </IconButton>
              <TextField
                value={item.walk_in_reserved_rooms}
                onChange={(event) => setReserve(Number(event.target.value))}
                disabled={isDisabled}
                type="number"
                size="small"
                error={reserveExceedsInventory}
                inputProps={{ min: 0, 'aria-label': `Walk-in reserve for ${item.room_type_name}` }}
                sx={{ width: 92, '& input': { textAlign: 'center', fontWeight: 800, fontSize: '1rem' } }}
              />
              <IconButton
                aria-label={`Increase walk-in reserve for ${item.room_type_name}`}
                onClick={() => setReserve(item.walk_in_reserved_rooms + 1)}
                disabled={isDisabled}
                sx={{ border: 1, borderColor: 'divider' }}
              >
                <AddIcon />
              </IconButton>
              {item.walk_in_reserved_rooms > 0 && (
                <Button size="small" onClick={() => setReserve(0)} disabled={isDisabled}>Clear</Button>
              )}
            </Stack>
            {reserveExceedsInventory && (
              <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.75 }}>
                Reserve is higher than today’s physical availability.
              </Typography>
            )}
          </Box>

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Box>
                <Typography fontWeight={750}>Custom online price</Typography>
                <Typography variant="body2" color="text.secondary">Overrides the normal rate for this date.</Typography>
              </Box>
              {item.custom_price !== null && (
                <Button size="small" onClick={() => onChange({ custom_price: null })} disabled={isDisabled}>Reset</Button>
              )}
            </Stack>
            <TextField
              value={item.custom_price ?? ''}
              onChange={(event) => onChange({ custom_price: event.target.value || null })}
              disabled={isDisabled}
              type="number"
              size="small"
              fullWidth
              error={customPriceInvalid}
              helperText={customPriceInvalid ? 'Enter a price greater than zero.' : 'Leave blank to use the current room or rate-plan price.'}
              inputProps={{ min: 0.01, step: 0.01, 'aria-label': `Custom online price for ${item.room_type_name}` }}
              InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
            />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 1.5,
              p: 2,
              borderRadius: 2.5,
              bgcolor: item.online_booking_enabled ? alpha(theme.palette.success.main, 0.08) : 'action.hover',
            }}
          >
            <Box>
              <Stack direction="row" spacing={0.75} alignItems="center" color="text.secondary">
                <StorefrontOutlinedIcon fontSize="small" />
                <Typography variant="caption" fontWeight={700}>WALK-IN HOLD</Typography>
              </Stack>
              <Typography variant="h5" fontWeight={800}>{item.walk_in_reserved_rooms}</Typography>
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ textAlign: 'right' }}>
              <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="flex-end" color={item.online_booking_enabled ? 'success.main' : 'text.secondary'}>
                <LanguageOutlinedIcon fontSize="small" />
                <Typography variant="caption" fontWeight={700}>ONLINE NOW</Typography>
              </Stack>
              <Typography variant="h5" fontWeight={800} color={item.online_booking_enabled ? 'success.main' : 'text.secondary'}>
                {onlineAvailable}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
};
