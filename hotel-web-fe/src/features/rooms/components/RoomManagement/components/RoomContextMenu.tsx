// Right-click / overflow context menu for a room: header, primary action,
// sectioned actions, and an at-a-glance side panel for occupied/arriving rooms.
// On phone the same derived model renders inside a BottomSheet — the 460px
// anchored Menu clips below the `sm` breakpoint.

import React from 'react';
import {
  Box,
  Menu,
  MenuItem,
  Typography,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import type { BookingWithDetails, Room } from '../../../../../types';
import type { MenuLayout } from '../types';
import type { RoomManagementStatusInfo } from '../../../hooks/useRoomManagementFilters';
import { getStatusAccentColor } from '../../../config';
import { getRoomStatusColor, getRoomStatusLabel } from '../roomCardPresentation';
import {
  getPositiveRatePerNight,
  formatMenuBookingDate,
} from '../../../utils/roomManagementUtils';
import { useIsPhone } from '../../../../../hooks/useIsPhone';
import { BottomSheet } from '../../../../../components/common/BottomSheet';

interface RoomContextMenuProps {
  menuPosition: { top: number; left: number } | null;
  onClose: () => void;
  room: Room | null;
  getStatusInfo: (room: Room) => RoomManagementStatusInfo;
  getMenuLayout: (room: Room | null) => MenuLayout;
  formatCurrency: (value: number) => string;
}

// Everything both surfaces render, derived once per open: status info, the
// page-built action model, and the aside facts (rate / booking / housekeeping).
interface RoomMenuModel {
  selectedRoom: Room;
  info: RoomManagementStatusInfo;
  layout: MenuLayout;
  statusColor: string;
  statusLabel: string;
  activeBooking: BookingWithDetails | null;
  showAside: boolean;
  ratePerNight: number | null;
}

const deriveRoomMenuModel = (
  room: Room,
  getStatusInfo: (room: Room) => RoomManagementStatusInfo,
  getMenuLayout: (room: Room | null) => MenuLayout,
): RoomMenuModel => {
  const info = getStatusInfo(room);
  const layout = getMenuLayout(room);
  const displayRoom = { ...room, status: info.computedStatus };
  const statusColor = getRoomStatusColor(displayRoom);
  const statusLabel = getRoomStatusLabel(displayRoom);
  const activeBooking = info.booking || info.reservedBooking || null;
  const showAside = info.isOccupied || info.isReservedToday;
  const ratePerNight = getPositiveRatePerNight(activeBooking);
  return {
    selectedRoom: room,
    info,
    layout,
    statusColor,
    statusLabel,
    activeBooking,
    showAside,
    ratePerNight,
  };
};

// Identical to the desktop header pill — flexShrink only matters on phone,
// where the sheet title row can squeeze it against the close button.
const statusPillSx = (model: RoomMenuModel) => ({
  px: 0.85,
  py: 0.2,
  borderRadius: 999,
  bgcolor: `color-mix(in srgb, ${model.statusColor} 14%, transparent)`,
  color: getStatusAccentColor(model.info.computedStatus),
  border: '1px solid',
  borderColor: `color-mix(in srgb, ${model.statusColor} 35%, transparent)`,
  fontSize: '0.6rem',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
});

// Phone surface: the aside panel folds into caption rows under the room
// header, then the primary action, then each section as an overline-labeled
// list — the same handlers the desktop Menu runs.
const RoomMenuSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  model: RoomMenuModel | null;
  formatCurrency: (value: number) => string;
}> = ({ open, onClose, model, formatCurrency }) => (
  <BottomSheet
    open={open}
    onClose={onClose}
    title={model ? `Room ${model.selectedRoom.room_number}` : undefined}
    headerAction={model ? <Box sx={{ ...statusPillSx(model), flexShrink: 0 }}>{model.statusLabel}</Box> : undefined}
  >
    {model && (() => {
      const { selectedRoom, info, layout, statusColor, statusLabel, activeBooking, showAside, ratePerNight } = model;
      const bookingByline = activeBooking
        ? [activeBooking.source, activeBooking.guest_name].filter(Boolean).join(' · ')
        : '';
      return (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {selectedRoom.room_type}
            {info.isOccupied && info.booking?.guest_name && ` · ${info.booking.guest_name}`}
          </Typography>

          {/* Aside facts folded inline as caption rows */}
          {showAside && activeBooking && (
            <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {ratePerNight != null && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {'Rate · '}
                  <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>
                    {formatCurrency(ratePerNight)}
                  </Box>
                  {' per night'}
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {`${info.isOccupied ? 'Current booking' : 'Next booking'} · `}
                <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  {formatMenuBookingDate(activeBooking.check_in_date)} – {formatMenuBookingDate(activeBooking.check_out_date)}
                </Box>
                {bookingByline && ` — ${bookingByline}`}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {'Housekeeping · '}
                <Box component="span" sx={{ fontWeight: 700, color: statusColor }}>
                  {statusLabel}
                </Box>
              </Typography>
            </Box>
          )}

          {/* Primary action — mirrors the desktop menu's header button */}
          {layout.primary && (
            <Button
              fullWidth
              variant="contained"
              color={layout.primary.dark ? 'inherit' : layout.primary.color || 'primary'}
              startIcon={layout.primary.icon}
              onClick={() => {
                layout.primary!.onClick(selectedRoom);
                onClose();
              }}
              sx={{
                mt: 1.25,
                borderRadius: 1.5,
                py: 1,
                fontWeight: 700,
                textTransform: 'none',
                fontSize: '0.85rem',
                boxShadow: 'none',
                ...(layout.primary.dark && {
                  bgcolor: 'text.primary',
                  color: 'background.paper',
                  '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                }),
              }}
            >
              {layout.primary.label}
            </Button>
          )}

          {/* Sectioned actions — mx:-2 stretches rows to the sheet edge while
              px:2 keeps labels aligned with the sheet padding. */}
          <List disablePadding sx={{ mx: -2 }}>
            {layout.sections.map((section, sIdx) => (
              <Box component="li" key={section.title} sx={{ listStyle: 'none' }}>
                {sIdx > 0 && <Divider sx={{ my: 0.5 }} />}
                <Typography
                  variant="overline"
                  sx={{
                    display: 'block',
                    px: 2,
                    pt: 0.75,
                    pb: 0.25,
                    color: 'text.secondary',
                    fontWeight: 700,
                    fontSize: '0.62rem',
                    letterSpacing: 1.2,
                    lineHeight: 1.4,
                  }}
                >
                  {section.title}
                </Typography>
                {section.actions.map((action) => (
                  <ListItemButton
                    key={action.id}
                    onClick={() => {
                      action.onClick(selectedRoom);
                      onClose();
                    }}
                    sx={{ borderRadius: 2, color: action.color || 'inherit' }}
                  >
                    <ListItemIcon sx={{ color: action.color || 'text.secondary', minWidth: 40 }}>
                      {action.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={action.label}
                      secondary={action.secondary}
                      slotProps={{
                        primary: { sx: { color: action.color || 'inherit', fontSize: '0.9rem' } },
                        secondary: { sx: { fontSize: '0.72rem' } },
                      }}
                    />
                  </ListItemButton>
                ))}
              </Box>
            ))}
          </List>
        </>
      );
    })()}
  </BottomSheet>
);

const RoomContextMenu: React.FC<RoomContextMenuProps> = ({
  menuPosition,
  onClose,
  room,
  getStatusInfo,
  getMenuLayout,
  formatCurrency,
}) => {
  const isPhone = useIsPhone();
  const model = room ? deriveRoomMenuModel(room, getStatusInfo, getMenuLayout) : null;

  if (isPhone) {
    return (
      <RoomMenuSheet
        open={Boolean(menuPosition) && model != null}
        onClose={onClose}
        model={model}
        formatCurrency={formatCurrency}
      />
    );
  }

  return (
    <Menu
      open={Boolean(menuPosition)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={menuPosition ? { top: menuPosition.top, left: menuPosition.left } : undefined}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            overflow: 'hidden',
            boxShadow: 'var(--hotel-shadow-md)',
            border: '1px solid',
            borderColor: 'divider',
          },
        },

        list: { sx: { py: 0 } }
      }}>
      {model && (() => {
        const { selectedRoom, info, layout, statusColor, activeBooking, showAside, ratePerNight } = model;
        return (
          <Box sx={{ display: 'flex', minWidth: showAside ? 460 : 280, maxWidth: 520 }}>
            <Box sx={{ flex: 1, py: 1, minWidth: 260 }}>
              {/* Header */}
              <Box sx={{ px: 2, pt: 0.5, pb: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    Room {selectedRoom.room_number}
                  </Typography>
                  <Box sx={statusPillSx(model)}>
                    {model.statusLabel}
                  </Box>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                  {selectedRoom.room_type}
                  {info.isOccupied && info.booking?.guest_name && ` · ${info.booking.guest_name}`}
                </Typography>
              </Box>

              {/* Primary action */}
              {layout.primary && (
                <Box sx={{ px: 2, pb: 1.25 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    color={layout.primary.dark ? 'inherit' : layout.primary.color || 'primary'}
                    startIcon={layout.primary.icon}
                    onClick={() => {
                      layout.primary!.onClick(selectedRoom);
                      onClose();
                    }}
                    sx={{
                      borderRadius: 1.5,
                      py: 1,
                      fontWeight: 700,
                      textTransform: 'none',
                      fontSize: '0.85rem',
                      boxShadow: 'none',
                      ...(layout.primary.dark && {
                        bgcolor: 'text.primary',
                        color: 'background.paper',
                        '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                      }),
                    }}
                  >
                    {layout.primary.label}
                  </Button>
                </Box>
              )}

              {/* Sectioned actions */}
              {layout.sections.map((section, sIdx) => (
                <Box key={section.title}>
                  {sIdx > 0 && <Divider sx={{ my: 0.5 }} />}
                  <Typography
                    variant="overline"
                    sx={{
                      display: 'block',
                      px: 2,
                      pt: 0.75,
                      pb: 0.25,
                      color: 'text.secondary',
                      fontWeight: 700,
                      fontSize: '0.62rem',
                      letterSpacing: 1.2,
                      lineHeight: 1.4,
                    }}
                  >
                    {section.title}
                  </Typography>
                  {section.actions.map((action) => (
                    <MenuItem
                      key={action.id}
                      onClick={() => {
                        action.onClick(selectedRoom);
                        onClose();
                      }}
                      sx={{ py: 0.75, px: 2 }}
                    >
                      <ListItemIcon sx={{ color: action.color || 'text.secondary', minWidth: 32 }}>
                        {action.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={action.label}
                        secondary={action.secondary}
                        slotProps={{
                          primary: { sx: { color: action.color || 'inherit', fontSize: '0.875rem' } },
                          secondary: { sx: { fontSize: '0.7rem' } },
                        }}
                      />
                    </MenuItem>
                  ))}
                </Box>
              ))}
            </Box>

            {/* At-a-glance side panel for occupied / arriving rooms */}
            {showAside && activeBooking && (
              <Box
                sx={{
                  width: 180,
                  flexShrink: 0,
                  bgcolor: 'action.hover',
                  borderLeft: '1px solid',
                  borderColor: 'divider',
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                }}
              >
                {ratePerNight != null && (
                  <Box>
                    <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.6rem', letterSpacing: 1.2, lineHeight: 1.4 }}>
                      Rate
                    </Typography>
                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2 }}>
                      {formatCurrency(ratePerNight)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                      per night
                    </Typography>
                  </Box>
                )}

                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.6rem', letterSpacing: 1.2, lineHeight: 1.4 }}>
                    {info.isOccupied ? 'Current Booking' : 'Next Booking'}
                  </Typography>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', lineHeight: 1.3 }}>
                    {formatMenuBookingDate(activeBooking.check_in_date)} – {formatMenuBookingDate(activeBooking.check_out_date)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[activeBooking.source, activeBooking.guest_name].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.6rem', letterSpacing: 1.2, lineHeight: 1.4 }}>
                    Housekeeping
                  </Typography>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: statusColor, lineHeight: 1.3 }}>
                    {model.statusLabel}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        );
      })()}
    </Menu>
  );
};

export default RoomContextMenu;
