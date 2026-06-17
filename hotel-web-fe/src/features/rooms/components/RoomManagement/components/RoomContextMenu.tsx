// Right-click / overflow context menu for a room: header, primary action,
// sectioned actions, and an at-a-glance side panel for occupied/arriving rooms.

import React from 'react';
import {
  Box,
  Menu,
  MenuItem,
  Typography,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Room } from '../../../../../types';
import type { MenuLayout } from '../types';
import type { RoomManagementStatusInfo } from '../../../hooks/useRoomManagementFilters';
import { getRoomStatusColor, getRoomStatusLabel } from '../roomCardPresentation';
import {
  getPositiveRatePerNight,
  formatMenuBookingDate,
} from '../../../utils/roomManagementUtils';

interface RoomContextMenuProps {
  menuPosition: { top: number; left: number } | null;
  onClose: () => void;
  room: Room | null;
  getStatusInfo: (room: Room) => RoomManagementStatusInfo;
  getMenuLayout: (room: Room | null) => MenuLayout;
  formatCurrency: (value: number) => string;
}

const RoomContextMenu: React.FC<RoomContextMenuProps> = ({
  menuPosition,
  onClose,
  room,
  getStatusInfo,
  getMenuLayout,
  formatCurrency,
}) => {
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
            boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
            border: '1px solid',
            borderColor: 'divider',
          },
        },
      }}
      MenuListProps={{ sx: { py: 0 } }}
    >
      {room && (() => {
        const selectedRoom = room;
        const info = getStatusInfo(selectedRoom);
        const layout = getMenuLayout(selectedRoom);
        const displayRoom = { ...selectedRoom, status: info.computedStatus };
        const statusColor = getRoomStatusColor(displayRoom);
        const activeBooking = info.booking || info.reservedBooking || null;
        const showAside = info.isOccupied || info.isReservedToday;

        const ratePerNight = getPositiveRatePerNight(activeBooking);

        return (
          <Box sx={{ display: 'flex', minWidth: showAside ? 460 : 280, maxWidth: 520 }}>
            <Box sx={{ flex: 1, py: 1, minWidth: 260 }}>
              {/* Header */}
              <Box sx={{ px: 2, pt: 0.5, pb: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    Room {selectedRoom.room_number}
                  </Typography>
                  <Box
                    sx={{
                      px: 0.85,
                      py: 0.2,
                      borderRadius: 999,
                      bgcolor: alpha(statusColor, 0.14),
                      color: info.computedStatus === 'dirty' ? '#8a6d00' : statusColor,
                      border: '1px solid',
                      borderColor: alpha(statusColor, 0.35),
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                    }}
                  >
                    {getRoomStatusLabel(displayRoom)}
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
                    onClick={() => layout.primary!.onClick(selectedRoom)}
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
                      onClick={() => action.onClick(selectedRoom)}
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
                      {action.badge != null && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, ml: 1 }}>
                          {action.badge}
                        </Typography>
                      )}
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
                    {getRoomStatusLabel(displayRoom)}
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
