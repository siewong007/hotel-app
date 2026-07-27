// Single room card in the Room Management grid. Purely presentational: the
// parent computes per-room status info and passes plain values + callbacks.

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Person as PersonIcon,
  Block as BlockIcon,
  CardGiftcard as GiftIcon,
  CalendarMonth as CalendarIcon,
  Phone as PhoneIcon,
  Edit as EditIcon,
  Notes as NotesIcon,
  MoreHoriz as MoreHorizIcon,
  SmokingRooms as SmokingIcon,
  AutoAwesome as SparkleIcon,
} from '@mui/icons-material';
import type { Room, BookingWithDetails } from '../../../../../types';
import { getRoomTypeCode } from '../../../utils/roomManagementUtils';

interface RoomCardProps {
  room: Room;
  computedStatus: string;
  booking: BookingWithDetails | undefined;
  reservedBooking: BookingWithDetails | undefined;
  hasReservationForToday: boolean;
  isOccupied: boolean;
  isReservedToday: boolean;
  isComplimentary: boolean;
  cardFill: string;
  isDarkMode: boolean;
  onMenuOpen: (event: React.MouseEvent<HTMLElement>, room: Room) => void;
  onEditNotes: (room: Room) => void;
  onEditBookingNotes: (booking: BookingWithDetails, event: React.MouseEvent) => void;
  onCheckOut: (room: Room) => void;
  onChangeRoom: (room: Room) => void;
  onCheckIn: (room: Room) => void;
  onNewBooking: (room: Room) => void;
  onMarkAvailable: (room: Room) => void;
}

const RoomCard: React.FC<RoomCardProps> = ({
  room,
  computedStatus,
  booking,
  reservedBooking,
  hasReservationForToday,
  isOccupied,
  isReservedToday,
  isComplimentary,
  cardFill,
  isDarkMode,
  onMenuOpen,
  onEditNotes,
  onEditBookingNotes,
  onCheckOut,
  onChangeRoom,
  onCheckIn,
  onNewBooking,
  onMarkAvailable,
}) => {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Card
        elevation={0}
        ref={(el: HTMLDivElement | null) => {
          // Two global theme rules try to force this card back to a neutral
          // surface: theme.ts:276 (board-skin) and theme.ts:259 (dark-mode
          // nested-Paper, which uses `!important` AND has higher specificity
          // than any sx-generated class chain we can produce). Inline styles
          // set with `!important` via setProperty beat both — that's the
          // only reliable escape here.
          if (!el) return;
          el.style.setProperty('background-color', cardFill, 'important');
          el.style.setProperty('background-image', 'none', 'important');
          el.style.setProperty(
            'border-color',
            isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)',
            'important',
          );
          el.style.setProperty('border-width', '1px', 'important');
          el.style.setProperty('border-style', 'solid', 'important');
        }}
        sx={{
          color: '#fff',
          cursor: 'pointer',
          position: 'relative',
          height: 250,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 2.5,
          transition: 'box-shadow 150ms ease, transform 150ms ease',
          '&:hover': {
            boxShadow: isDarkMode
              ? '0 6px 20px rgba(0,0,0,0.55)'
              : '0 6px 18px rgba(0,0,0,0.18)',
            transform: 'translateY(-1px)',
          },
          overflow: 'hidden',
        }}
        onClick={(e) => {
          e.preventDefault();
          onMenuOpen(e, room);
        }}
      >
        <CardContent
          sx={{
            p: 1.5,
            pt: 1.25,
            // Reserve bottom space (~36px) so the absolutely-positioned
            // action row pinned at bottom: 12 doesn't overlap inline content.
            pb: '44px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            '&:last-child': { pb: '44px' },
          }}
        >
          {/* Header row: room number + type code on the left, status pill on the right */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '1.75rem',
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
              >
                {room.room_number}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.85)',
                    letterSpacing: 0.6,
                    fontSize: '0.7rem',
                    lineHeight: 1,
                  }}
                >
                  {getRoomTypeCode(room.room_type)}
                </Typography>
                <Box
                  component="svg"
                  viewBox="0 0 36 6"
                  sx={{ width: 36, height: 6, display: 'block', overflow: 'visible' }}
                  aria-hidden
                >
                  <path
                    d="M1 4 Q5 1 9 3 T17 3 T25 3 T35 3"
                    fill="none"
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  />
                </Box>
              </Box>
              {room.is_smoking && (
                <Tooltip title="Designated smoking room" arrow>
                  <Box
                    sx={{
                      alignSelf: 'center',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.4,
                      px: 0.75,
                      py: 0.3,
                      borderRadius: 0.75,
                      bgcolor: 'rgba(35,28,16,0.30)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      color: '#fff',
                    }}
                  >
                    <SmokingIcon sx={{ fontSize: 12 }} />
                    <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.7 }}>
                      SMOKING
                    </Typography>
                  </Box>
                </Tooltip>
              )}
            </Box>

          </Box>

          {/* Empty-state placeholder for housekeeping / maintenance rooms with no booking */}
          {!isOccupied && !isReservedToday && (computedStatus === 'dirty' || computedStatus === 'reserved_dirty' || computedStatus === 'maintenance') && (
            <Typography
              sx={{
                mt: 1.25,
                fontStyle: 'italic',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.85rem',
                fontWeight: 500,
              }}
            >
              {computedStatus === 'reserved_dirty'
                ? 'Reserved, needs cleaning'
                : computedStatus === 'dirty'
                  ? 'Awaiting cleaning'
                  : 'Under maintenance'}
            </Typography>
          )}

          {isComplimentary && (
            <Box
              sx={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                alignItems: 'center',
                gap: 0.4,
                mt: 0.75,
                px: 0.75,
                py: 0.15,
                borderRadius: 999,
                bgcolor: alpha('#9c27b0', 0.12),
                color: '#7b1fa2',
              }}
            >
              <GiftIcon sx={{ fontSize: 12 }} />
              <Typography variant="caption" sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.5 }}>
                FREE GIFT
              </Typography>
            </Box>
          )}

          <Divider sx={{ my: 1, borderStyle: 'dashed' }} />

          {/* Room Notes */}
          {!isOccupied && !isReservedToday && (
            <Typography
              variant="caption"
              onClick={(e) => {
                e.stopPropagation();
                onEditNotes(room);
              }}
              sx={{
                display: "block",
                fontSize: '0.6rem',
                fontStyle: 'italic',
                opacity: (room.notes || room.status_notes) ? 0.8 : 0.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                mb: 0.5,
                cursor: 'pointer',
                '&:hover': { opacity: 1 }
              }}>
              {room.notes || room.status_notes || '+ Add notes'}
            </Typography>
          )}

          {/* Guest Details for Occupied Rooms */}
          {booking?.guest_name && isOccupied ? (
            <Box sx={{ mt: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 800,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '0.95rem',
                  lineHeight: 1.2,
                }}
              >
                {booking.guest_name}
              </Typography>
              <Typography
                sx={{
                  mt: 0.4,
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {new Date(booking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(booking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.4 }}>
                {booking.guest_phone && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <PhoneIcon sx={{ fontSize: 12, opacity: 0.8 }} />
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.65rem',
                        opacity: 0.9,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {booking.guest_phone}
                    </Typography>
                  </Box>
                )}
              </Box>

              {/* Cleaning preference chip (guest preference, occupied only) */}
              {booking.cleaning_preference != null && (
                <Tooltip
                  title={booking.cleaning_preference ? 'Guest wants the room cleaned every day' : 'Guest declined daily cleaning'}
                  arrow
                >
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignSelf: 'flex-start',
                      alignItems: 'center',
                      gap: 0.5,
                      mt: 0.6,
                      px: 1,
                      py: 0.3,
                      borderRadius: 999,
                      ...(booking.cleaning_preference
                        ? {
                            bgcolor: 'rgba(255,255,255,0.92)',
                            color: '#9C6210',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                          }
                        : {
                            bgcolor: 'rgba(0,0,0,0.10)',
                            color: '#fff',
                            border: '1.5px dashed rgba(255,255,255,0.65)',
                          }),
                    }}
                  >
                    {booking.cleaning_preference ? (
                      <SparkleIcon sx={{ fontSize: 13 }} />
                    ) : (
                      <BlockIcon sx={{ fontSize: 13 }} />
                    )}
                    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700 }}>
                      {booking.cleaning_preference ? 'Daily cleaning' : 'No daily cleaning'}
                    </Typography>
                  </Box>
                </Tooltip>
              )}

              {/* Booking Notes - Clickable to edit */}
              <Tooltip title={booking.remarks || booking.special_requests ? "Click to edit notes" : "Click to add notes"} arrow>
                <Box
                  onClick={(e) => onEditBookingNotes(booking, e)}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 0.5,
                    mt: 0.5,
                    p: 0.5,
                    bgcolor: 'transparent',
                    borderRadius: 0.5,
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: 'rgba(255,255,255,0.18)',
                    },
                    minHeight: 24,
                  }}
                >
                  <NotesIcon sx={{ fontSize: 12, opacity: 0.8, mt: 0.25 }} />
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: '0.6rem',
                      opacity: 0.9,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      flex: 1,
                      fontStyle: (booking.remarks || booking.special_requests) ? 'normal' : 'italic',
                    }}
                  >
                    {booking.remarks || booking.special_requests || 'Add notes...'}
                  </Typography>
                  <EditIcon sx={{ fontSize: 10, opacity: 0.6 }} />
                </Box>
              </Tooltip>

              {/* Action row: Check out, Move, More — pinned to card bottom for cross-card alignment */}
              <Box sx={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', gap: 0.4, alignItems: 'center', minWidth: 0 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCheckOut(room);
                  }}
                  sx={{
                    flex: 1,
                    color: 'text.primary',
                    bgcolor: 'background.paper',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    whiteSpace: 'nowrap',
                    '&.MuiButton-root': {
                      minWidth: 0,
                      py: 0.35,
                      px: 0.5,
                      borderRadius: 999,
                      borderColor: 'divider',
                      borderWidth: 1,
                    },
                    '&:hover': { borderColor: 'text.primary', bgcolor: 'action.hover' },
                  }}
                >
                  Check out
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeRoom(room);
                  }}
                  sx={{
                    flex: 1,
                    color: 'text.primary',
                    bgcolor: 'background.paper',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    whiteSpace: 'nowrap',
                    '&.MuiButton-root': {
                      minWidth: 0,
                      py: 0.35,
                      px: 0.5,
                      borderRadius: 999,
                      borderColor: 'divider',
                      borderWidth: 1,
                    },
                    '&:hover': { borderColor: 'text.primary', bgcolor: 'action.hover' },
                  }}
                >
                  Move
                </Button>
                <Tooltip title="More actions" arrow>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMenuOpen(e, room);
                    }}
                    sx={{
                      border: '1px solid',
                      borderColor: 'rgba(255,255,255,0.55)',
                      borderRadius: 999,
                      width: 22,
                      height: 22,
                      flexShrink: 0,
                      color: '#fff',
                      '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
                    }}
                  >
                    <MoreHorizIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ) : null}

          {/* Reserved Room Guest Details - styled like Occupied room */}
          {isReservedToday && reservedBooking && (
            <>
              <Box sx={{ mt: 1 }}>
                {reservedBooking.guest_name && (
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 800,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.95rem',
                      lineHeight: 1.2,
                    }}
                  >
                    {reservedBooking.guest_name}
                  </Typography>
                )}
                <Typography
                  sx={{
                    mt: 0.4,
                    color: 'text.secondary',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {new Date(reservedBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(reservedBooking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Typography>

                {/* Editable booking notes — same affordance as occupied rooms */}
                <Tooltip title={reservedBooking.remarks || reservedBooking.special_requests ? 'Click to edit notes' : 'Click to add notes'} arrow>
                  <Box
                    onClick={(e) => onEditBookingNotes(reservedBooking, e)}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 0.5,
                      mt: 0.75,
                      p: 0.5,
                      bgcolor: 'transparent',
                      borderRadius: 0.5,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
                      minHeight: 24,
                    }}
                  >
                    <NotesIcon sx={{ fontSize: 12, opacity: 0.8, mt: 0.25 }} />
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.6rem',
                        opacity: 0.9,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        flex: 1,
                        fontStyle: (reservedBooking.remarks || reservedBooking.special_requests) ? 'normal' : 'italic',
                      }}
                    >
                      {reservedBooking.remarks || reservedBooking.special_requests || 'Add notes...'}
                    </Typography>
                    <EditIcon sx={{ fontSize: 10, opacity: 0.6 }} />
                  </Box>
                </Tooltip>
              </Box>

              {/* Action row: Check in (primary) + More — pinned to card bottom */}
              <Box sx={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', gap: 0.4, alignItems: 'center', minWidth: 0 }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCheckIn(room);
                  }}
                  sx={{
                    flex: 1,
                    color: 'background.paper',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: 'none',
                    '&.MuiButton-root': {
                      minWidth: 0,
                      py: 0.35,
                      px: 0.5,
                      borderRadius: 999,
                      bgcolor: 'text.primary',
                      borderWidth: 0,
                    },
                    '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                  }}
                >
                  Check in
                </Button>
                <Tooltip title="More actions" arrow>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMenuOpen(e, room);
                    }}
                    sx={{
                      border: '1px solid',
                      borderColor: 'rgba(255,255,255,0.55)',
                      borderRadius: 999,
                      width: 22,
                      height: 22,
                      flexShrink: 0,
                      color: '#fff',
                      '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
                    }}
                  >
                    <MoreHorizIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </>
          )}

          {/* Upcoming Same-Day Reservation for Rooms That Need Cleaning */}
          {(computedStatus === 'dirty' || computedStatus === 'reserved_dirty') && reservedBooking && hasReservationForToday && (
            <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.35)' }}>
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.5,
                py: 0.25,
                bgcolor: 'rgba(255,255,255,0.18)',
                borderRadius: 1,
              }}>
                <CalendarIcon sx={{ fontSize: 14, color: '#fff' }} />
                <Typography variant="caption" sx={{ color: '#fff', fontWeight: 600, fontSize: '0.65rem' }}>
                  Reserved: {new Date(reservedBooking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Typography>
              </Box>
              {reservedBooking.guest_name && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <PersonIcon sx={{ fontSize: 12, color: '#fff' }} />
                  <Typography variant="caption" sx={{
                    color: '#fff',
                    fontWeight: 500,
                    fontSize: '0.6rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {reservedBooking.guest_name}
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Action row for Dirty Rooms: Mark clean (primary) + More */}
          {(computedStatus === 'dirty' || computedStatus === 'reserved_dirty') && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                right: 12,
                display: 'flex',
                gap: 0.4,
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <Button
                size="small"
                variant="contained"
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkAvailable(room);
                }}
                sx={{
                  flex: 1,
                  color: 'background.paper',
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                  boxShadow: 'none',
                  '&.MuiButton-root': {
                    minWidth: 0,
                    py: 0.35,
                    px: 0.5,
                    borderRadius: 999,
                    bgcolor: 'text.primary',
                    borderWidth: 0,
                  },
                  '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                }}
              >
                {computedStatus === 'reserved_dirty' ? 'Mark clean' : 'Mark available'}
              </Button>
              <Tooltip title="More actions" arrow>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMenuOpen(e, room);
                  }}
                  sx={{
                    border: '1px solid',
                    borderColor: 'rgba(255,255,255,0.55)',
                    borderRadius: 999,
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    color: '#fff',
                    '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
                  }}
                >
                  <MoreHorizIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* Action row for Available Rooms: + New booking (primary) + More — pinned to card bottom */}
          {computedStatus === 'available' && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                right: 12,
                display: 'flex',
                gap: 0.4,
                alignItems: 'center',
                minWidth: 0,
              }}
            >
              <Button
                size="small"
                variant="contained"
                onClick={(e) => {
                  e.stopPropagation();
                  onNewBooking(room);
                }}
                sx={{
                  flex: 1,
                  color: 'background.paper',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                  boxShadow: 'none',
                  '&.MuiButton-root': {
                    minWidth: 0,
                    py: 0.5,
                    px: 0.75,
                    borderRadius: 999,
                    bgcolor: 'text.primary',
                    borderWidth: 0,
                  },
                  '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
                }}
              >
                + New booking
              </Button>
              <Tooltip title="More actions" arrow>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMenuOpen(e, room);
                  }}
                  sx={{
                    border: '1px solid',
                    borderColor: 'rgba(255,255,255,0.55)',
                    borderRadius: 999,
                    width: 24,
                    height: 24,
                    flexShrink: 0,
                    color: '#fff',
                    bgcolor: 'transparent',
                    '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.12)' },
                  }}
                >
                  <MoreHorizIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}

        </CardContent>
      </Card>
    </Box>
  );
};

export default RoomCard;
