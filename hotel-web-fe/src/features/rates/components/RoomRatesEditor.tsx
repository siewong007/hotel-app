import { useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  MenuItem,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';

import type { RoomRateWithDetails, RoomTypeRef } from '../types';
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { formatHotelDate } from '../../../utils/date';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';

export interface RoomRatesEditorProps {
  rates: RoomRateWithDetails[];
  roomTypes: RoomTypeRef[];
  onAdd(input: {
    room_type_id: number;
    price: number;
    effective_from: string;
    effective_to?: string;
  }): void;
  onUpdate(
    id: number,
    input: { price?: number; effective_from?: string; effective_to?: string },
  ): void;
  onDelete(id: number): void;
}

interface DraftBand {
  room_type_id: string;
  price: string;
  effective_from: string;
  effective_to: string;
}

const emptyDraft = (): DraftBand => ({
  room_type_id: '',
  price: '',
  effective_from: '',
  effective_to: '',
});

/** Per-plan rate band list with an inline add row. */
export const RoomRatesEditor = ({
  rates,
  roomTypes,
  onAdd,
  onUpdate,
  onDelete,
}: RoomRatesEditorProps) => {
  const [draft, setDraft] = useState<DraftBand>(emptyDraft);

  const canAdd =
    draft.room_type_id !== '' &&
    Number.parseFloat(draft.price) > 0 &&
    draft.effective_from !== '' &&
    (!draft.effective_to || draft.effective_from <= draft.effective_to);

  const add = () => {
    if (!canAdd) return;
    onAdd({
      room_type_id: Number(draft.room_type_id),
      price: Number.parseFloat(draft.price),
      effective_from: draft.effective_from,
      effective_to: draft.effective_to || undefined,
    });
    setDraft(emptyDraft());
  };

  const isPhone = useIsPhone();

  const draftForm = (
    <>
      <TextField
        select
        size="small"
        value={draft.room_type_id}
        onChange={(event) =>
          setDraft({ ...draft, room_type_id: event.target.value })
        }
        fullWidth
        aria-label="Band room type"
      >
        {roomTypes.map((type) => (
          <MenuItem key={type.id} value={String(type.id)}>
            {type.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        type="number"
        value={draft.price}
        onChange={(event) =>
          setDraft({ ...draft, price: event.target.value })
        }
        slotProps={{ htmlInput: { 'aria-label': 'Band price', inputMode: 'decimal' } }}
        sx={isPhone ? undefined : { width: 110 }}
        fullWidth={isPhone}
      />
      <ModernDatePicker
        label=""
        size="small"
        value={draft.effective_from}
        onChange={(value) =>
          setDraft({ ...draft, effective_from: value })
        }
      />
      <ModernDatePicker
        label=""
        size="small"
        value={draft.effective_to}
        onChange={(value) => setDraft({ ...draft, effective_to: value })}
        helperText="Blank = open-ended"
      />
      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={add}
        disabled={!canAdd}
        sx={isPhone ? { alignSelf: 'flex-start' } : undefined}
      >
        Add
      </Button>
    </>
  );

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
        Rate bands
      </Typography>
      {isPhone ? (
        <Box>
          {rates.map((rate) => (
            <Box
              key={rate.id}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <MobileCardRow
                title={`${rate.room_type_name} (${rate.room_type_code})`}
                subtitle={`${formatHotelDate(rate.effective_from)} → ${rate.effective_to ? formatHotelDate(rate.effective_to) : 'Open'}`}
                status={
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {rate.price}
                  </Typography>
                }
                footer={
                  <Tooltip title="Delete band">
                    <IconButton
                      size="small"
                      aria-label={`Delete band for ${rate.room_type_name}`}
                      onClick={() => onDelete(rate.id)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              />
            </Box>
          ))}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              mt: 1.5,
              p: 1.5,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            {draftForm}
          </Box>
        </Box>
      ) : (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Room type</TableCell>
            <TableCell align="right">Price</TableCell>
            <TableCell>Effective from</TableCell>
            <TableCell>Effective to</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {rates.map((rate) => (
            <TableRow key={rate.id} hover>
              <TableCell>
                {rate.room_type_name}{' '}
                <Typography component="span" variant="caption" color="text.secondary">
                  {rate.room_type_code}
                </Typography>
              </TableCell>
              <TableCell align="right">{rate.price}</TableCell>
              <TableCell>{formatHotelDate(rate.effective_from)}</TableCell>
              <TableCell>
                {rate.effective_to ? formatHotelDate(rate.effective_to) : 'Open'}
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Delete band">
                  <IconButton size="small" onClick={() => onDelete(rate.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <TextField
                select
                size="small"
                value={draft.room_type_id}
                onChange={(event) =>
                  setDraft({ ...draft, room_type_id: event.target.value })
                }
                fullWidth
                aria-label="Band room type"
              >
                {roomTypes.map((type) => (
                  <MenuItem key={type.id} value={String(type.id)}>
                    {type.name}
                  </MenuItem>
                ))}
              </TextField>
            </TableCell>
            <TableCell align="right">
              <TextField
                size="small"
                type="number"
                value={draft.price}
                onChange={(event) =>
                  setDraft({ ...draft, price: event.target.value })
                }
                slotProps={{ htmlInput: { 'aria-label': 'Band price' } }}
                sx={{ width: 110 }}
              />
            </TableCell>
            <TableCell>
              <ModernDatePicker
                label=""
                size="small"
                value={draft.effective_from}
                onChange={(value) =>
                  setDraft({ ...draft, effective_from: value })
                }
              />
            </TableCell>
            <TableCell>
              <ModernDatePicker
                label=""
                size="small"
                value={draft.effective_to}
                onChange={(value) => setDraft({ ...draft, effective_to: value })}
                helperText="Blank = open-ended"
              />
            </TableCell>
            <TableCell align="right">
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={add}
                disabled={!canAdd}
              >
                Add
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      )}
      {rates.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No bands yet — dates fall back to the room type base rate.
        </Typography>
      )}
    </Box>
  );
};
