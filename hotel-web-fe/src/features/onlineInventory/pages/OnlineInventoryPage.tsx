import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';

import { formatLocalDate } from '../../../utils/date';
import { InventoryRoomCard } from '../components/InventoryRoomCard';
import { InventorySummary } from '../components/InventorySummary';
import { useOnlineInventory } from '../hooks/useOnlineInventory';
import { useConfirm } from '../../../components/common/ConfirmProvider';

const shiftDate = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(year, month - 1, day);
  shifted.setDate(shifted.getDate() + days);
  return formatLocalDate(shifted);
};

const formatStayDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00`));

const OnlineInventoryPage = () => {
  const today = formatLocalDate();
  const confirm = useConfirm();
  const [stayDate, setStayDate] = useState(today);
  const {
    items,
    changedRoomTypeIds,
    changedCount,
    isLoading,
    isSaving,
    error,
    successMessage,
    clearSuccessMessage,
    updateItem,
    discardChanges,
    saveChanges,
    reload,
  } = useOnlineInventory(stayDate);

  const openRoomTypeCount = useMemo(
    () => items.filter((item) => item.online_booking_enabled).length,
    [items],
  );

  const confirmDiscard = (message: string) =>
    confirm({
      title: 'Discard unsaved changes',
      message,
      confirmText: 'Discard changes',
      severity: 'warning',
    });

  const changeDate = async (nextDate: string) => {
    if (!nextDate) return;
    if (changedCount > 0 && !(await confirmDiscard('Change the stay date and discard your unsaved inventory changes?'))) return;
    setStayDate(nextDate);
  };

  const refreshInventory = async () => {
    if (changedCount > 0 && !(await confirmDiscard('Refresh availability and discard your unsaved inventory changes?'))) return;
    void reload();
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3.5 }, pb: { xs: 12, md: 4 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{
            justifyContent: "space-between",
            alignItems: { md: 'center' },
            gap: 2
          }}>
          <Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                color: "primary.main",
                mb: 0.75
              }}>
              <SettingsSuggestOutlinedIcon fontSize="small" />
              <Typography
                variant="overline"
                sx={{
                  fontWeight: 800,
                  letterSpacing: 1.2
                }}>Inventory settings</Typography>
            </Stack>
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 850,
                letterSpacing: -0.7
              }}>
              Online availability
            </Typography>
            <Typography
              sx={{
                color: "text.secondary",
                mt: 0.75,
                maxWidth: 640
              }}>
              Choose how many rooms to keep for walk-ins, set a custom online price, or close a room type for the selected date.
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: 0.75, borderRadius: 3, alignSelf: { xs: 'stretch', md: 'auto' } }}>
            <Stack direction="row" spacing={0.5} sx={{
              alignItems: "center"
            }}>
              <Tooltip title="Previous day">
                <IconButton aria-label="Previous stay date" onClick={() => void changeDate(shiftDate(stayDate, -1))}>
                  <ArrowBackIosNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <TextField
                type="date"
                value={stayDate}
                onChange={(event) => void changeDate(event.target.value)}
                size="small"
                sx={{ flex: 1, minWidth: 150, '& fieldset': { border: 0 } }}
                slotProps={{
                  htmlInput: { 'aria-label': 'Stay date' }
                }}
              />
              <Tooltip title="Next day">
                <IconButton aria-label="Next stay date" onClick={() => void changeDate(shiftDate(stayDate, 1))}>
                  <ArrowForwardIosIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {stayDate !== today && (
                <Button size="small" onClick={() => void changeDate(today)} sx={{ whiteSpace: 'nowrap' }}>Today</Button>
              )}
            </Stack>
          </Paper>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}

        <Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{
              justifyContent: "space-between",
              alignItems: { sm: 'center' },
              gap: 1,
              mb: 1.5
            }}>
            <Stack direction="row" spacing={1} sx={{
              alignItems: "center"
            }}>
              <CalendarMonthOutlinedIcon color="action" />
              <Box>
                <Typography variant="h6" sx={{
                  fontWeight: 800
                }}>{formatStayDate(stayDate)}</Typography>
                {!isLoading && (
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {openRoomTypeCount} of {items.length} room types are open online
                  </Typography>
                )}
              </Box>
            </Stack>
            <Tooltip title="Reload physical availability">
              <span>
                <Button startIcon={<RefreshIcon />} onClick={() => void refreshInventory()} disabled={isLoading || isSaving}>
                  Refresh
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {!isLoading && items.length > 0 && <InventorySummary items={items} />}
        </Box>

        {isLoading ? (
          <Paper variant="outlined" sx={{ display: 'grid', placeItems: 'center', minHeight: 280, borderRadius: 3 }}>
            <Stack spacing={1.5} sx={{
              alignItems: "center"
            }}>
              <CircularProgress size={32} />
              <Typography sx={{
                color: "text.secondary"
              }}>Loading room availability…</Typography>
            </Stack>
          </Paper>
        ) : items.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
            <CloudDoneOutlinedIcon sx={{ fontSize: 44, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6" sx={{
              fontWeight: 750
            }}>No room types to configure</Typography>
            <Typography sx={{
              color: "text.secondary"
            }}>Add a room type before setting its online availability.</Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {items.map((item) => (
              <InventoryRoomCard
                key={item.room_type_id}
                item={item}
                isChanged={changedRoomTypeIds.has(item.room_type_id)}
                isDisabled={isSaving}
                onChange={(patch) => updateItem(item.room_type_id, patch)}
              />
            ))}
          </Stack>
        )}
      </Stack>
      {changedCount > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            zIndex: (theme) => theme.zIndex.appBar - 1,
            left: { xs: 12, md: '50%' },
            right: { xs: 12, md: 'auto' },
            bottom: 16,
            transform: { md: 'translateX(-50%)' },
            width: { md: 'min(680px, calc(100vw - 48px))' },
            p: 1.25,
            pl: 2,
            borderRadius: 3,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" spacing={1.5} sx={{
            alignItems: "center"
          }}>
            <Typography
              sx={{
                fontWeight: 750,
                flex: 1
              }}>
              {changedCount} unsaved {changedCount === 1 ? 'change' : 'changes'}
            </Typography>
            <Button onClick={discardChanges} disabled={isSaving} color="inherit">Discard</Button>
            <Button
              variant="contained"
              startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
              onClick={() => void saveChanges()}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </Stack>
        </Paper>
      )}
      <Snackbar
        open={Boolean(successMessage)}
        autoHideDuration={4000}
        onClose={clearSuccessMessage}
        message={successMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Container>
  );
};

export default OnlineInventoryPage;
