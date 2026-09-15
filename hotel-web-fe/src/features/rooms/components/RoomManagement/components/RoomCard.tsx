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
import type { RoomMenuAnchor } from '../types';
import { getRoomTypeCode, formatMenuBookingDate } from '../../../utils/roomManagementUtils';
import { useIsPhone } from '../../../../../hooks/useIsPhone';
import { useTranslation } from '../../../../../i18n/useTranslation';

// Ink and borders rendered ON the saturated status fill. The fill is the
// status accent token, which inverts between modes (deep in light, pastel in
// dark), so on-card ink uses --hotel-on-primary — the theme's contrast color
// for saturated accents — with color-mix tints for the dimmer tiers.
const ON_FILL = 'var(--hotel-on-primary)';
const onFill = (pct: number) => `color-mix(in srgb, ${ON_FILL} ${pct}%, transparent)`;

// Action row pinned to the card bottom so the primary action sits in the same
// spot on every card regardless of state.
const CardActionRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
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
    {children}
  </Box>
);

const CardPillButton: React.FC<{
  tone: 'dark' | 'paper';
  onClick: () => void;
  children: React.ReactNode;
}> = ({ tone, onClick, children }) => (
  <Button
    size="small"
    variant={tone === 'dark' ? 'contained' : 'outlined'}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    sx={{
      flex: 1,
      fontSize: '0.62rem',
      fontWeight: 700,
      textTransform: 'none',
      whiteSpace: 'nowrap',
      minWidth: 0,
      py: 0.35,
      px: 0.5,
      borderRadius: 999,
      ...(tone === 'dark'
        ? {
            color: 'var(--hotel-text)',
            bgcolor: ON_FILL,
            boxShadow: 'none',
            '&:hover': { bgcolor: onFill(85), boxShadow: 'none' },
          }
        : {
            color: 'text.primary',
            bgcolor: 'background.paper',
            borderColor: 'divider',
            borderWidth: 1,
            '&:hover': { borderColor: 'text.secondary', bgcolor: 'action.hover' },
          }),
    }}
  >
    {children}
  </Button>
);

const CardMoreButton: React.FC<{
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  /** Hit target in px — 24 on desktop, larger on phone for touch. */
  size?: number;
}> = ({ onClick, size = 24 }) => {
  const { t } = useTranslation('rooms');
  return (
  <Tooltip title={t('card.moreActions')} arrow>
    <IconButton
      size="small"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      sx={{
        border: '1px solid',
        borderColor: onFill(55),
        borderRadius: 999,
        width: size,
        height: size,
        flexShrink: 0,
        color: ON_FILL,
        bgcolor: 'transparent',
        '&:hover': { borderColor: ON_FILL, bgcolor: onFill(12) },
      }}
    >
      <MoreHorizIcon sx={{ fontSize: Math.round(size * 0.6) }} />
    </IconButton>
  </Tooltip>
  );
};

interface RoomCardProps {
  room: Room;
  computedStatus: string;
  statusLabel: string;
  booking: BookingWithDetails | undefined;
  reservedBooking: BookingWithDetails | undefined;
  hasReservationForToday: boolean;
  isOccupied: boolean;
  isReservedToday: boolean;
  isComplimentary: boolean;
  overdueDays?: number;
  cardFill: string;
  onMenuOpen: (anchor: RoomMenuAnchor, room: Room) => void;
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
  statusLabel,
  booking,
  reservedBooking,
  hasReservationForToday,
  isOccupied,
  isReservedToday,
  isComplimentary,
  overdueDays,
  cardFill,
  onMenuOpen,
  onEditNotes,
  onEditBookingNotes,
  onCheckOut,
  onChangeRoom,
  onCheckIn,
  onNewBooking,
  onMarkAvailable,
}) => {
  const isPhone = useIsPhone();
  const { t } = useTranslation('rooms');

  // Phone: compact card — room identity, a status line, the guest when one is
  // attached, and ONE next-step action + More (which opens the same context
  // menu that holds every secondary badge/note action).
  if (isPhone) {
    const primary = isOccupied
      ? { label: t('card.checkOut'), tone: 'paper' as const, onClick: () => onCheckOut(room) }
      : isReservedToday
        ? { label: t('card.checkIn'), tone: 'dark' as const, onClick: () => onCheckIn(room) }
        : computedStatus === 'dirty' || computedStatus === 'reserved_dirty'
          ? { label: t('card.markClean'), tone: 'dark' as const, onClick: () => onMarkAvailable(room) }
          : computedStatus === 'available'
            ? { label: t('card.newBooking'), tone: 'dark' as const, onClick: () => onNewBooking(room) }
            : null;
    const guestBooking = isOccupied ? booking : isReservedToday ? reservedBooking : undefined;

    return (
      <Box sx={{ minWidth: 0 }}>
        <Card
          elevation={0}
          className="hotel-room-card"
          sx={{
            bgcolor: cardFill,
            backgroundImage: 'none',
            border: '1px solid',
            borderColor: onFill(28),
            color: ON_FILL,
            cursor: 'pointer',
            position: 'relative',
            minHeight: 150,
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 2.5,
            transition: 'box-shadow 150ms ease',
            '&:hover': {
              boxShadow: 'var(--hotel-shadow-md)',
            },
            overflow: 'hidden',
          }}
          onClick={(e) => {
            e.preventDefault();
            onMenuOpen(e, room);
          }}
          role="button"
          tabIndex={0}
          aria-label={t('card.openActionsAria', { room: room.room_number, status: statusLabel })}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            onMenuOpen({ top: rect.top + 48, left: rect.left + 12 }, room);
          }}
        >
          <CardContent
            sx={{
              p: 1.25,
              pb: '44px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              '&:last-child': { pb: '44px' },
            }}
          >
            {/* Room number + type code */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
              <Typography
                title={room.room_number}
                sx={{
                  fontSize: '1.4rem',
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  // Same guard as the desktop header: an over-long room number
                  // must truncate rather than widen the card. The type code
                  // beside it already did; this did not.
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {room.room_number}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 800,
                  color: onFill(80),
                  letterSpacing: 0.6,
                  fontSize: '0.62rem',
                  lineHeight: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {room.room_type_code || getRoomTypeCode(room.room_type)}
              </Typography>
            </Box>

            {/* Status line — the fill color carries status on desktop; on the
                compact card it needs the explicit label. */}
            <Typography
              sx={{
                mt: 0.4,
                fontSize: '0.62rem',
                fontWeight: 800,
                letterSpacing: 0.7,
                textTransform: 'uppercase',
                color: onFill(85),
              }}
            >
              {statusLabel}
            </Typography>

            {/* Guest name + dates for occupied / arriving-today rooms */}
            {guestBooking && (
              <Box sx={{ mt: 0.75, minWidth: 0 }}>
                {guestBooking.guest_name && (
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 800,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.85rem',
                      lineHeight: 1.25,
                    }}
                  >
                    {guestBooking.guest_name}
                  </Typography>
                )}
                <Typography
                  sx={{
                    mt: 0.25,
                    color: onFill(80),
                    fontSize: '0.68rem',
                    fontWeight: 500,
                  }}
                >
                  {formatMenuBookingDate(guestBooking.check_in_date)} – {formatMenuBookingDate(guestBooking.check_out_date)}
                </Typography>
              </Box>
            )}

            {/* One primary action per status + More */}
            <CardActionRow>
              {primary ? (
                <CardPillButton tone={primary.tone} onClick={primary.onClick}>
                  {primary.label}
                </CardPillButton>
              ) : (
                <Box sx={{ flex: 1 }} />
              )}
              <CardMoreButton onClick={(e) => onMenuOpen(e, room)} size={32} />
            </CardActionRow>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      <Card
        elevation={0}
        // `hotel-room-card` opts out of the board-skin and dark-mode
        // nested-Paper rules in theme.ts, which otherwise force every card
        // back to a neutral surface.
        className="hotel-room-card"
        sx={{
          bgcolor: cardFill,
          backgroundImage: 'none',
          border: '1px solid',
          borderColor: onFill(28),
          color: ON_FILL,
          cursor: 'pointer',
          position: 'relative',
          height: 250,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 2.5,
          transition: 'box-shadow 150ms ease',
          '&:hover': {
            boxShadow: 'var(--hotel-shadow-md)',
          },
          overflow: 'hidden',
        }}
        onClick={(e) => {
          e.preventDefault();
          onMenuOpen(e, room);
        }}
        role="button"
        tabIndex={0}
        aria-label={t('card.openActionsAria', { room: room.room_number, status: statusLabel })}
        onKeyDown={(e) => {
          // Inner buttons handle their own keys — only open the menu when the
          // card itself is focused.
          if (e.target !== e.currentTarget) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onMenuOpen({ top: rect.top + 48, left: rect.left + 12 }, room);
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
          {/* Header row: room number + type code */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
              <Typography
                title={room.room_number}
                sx={{
                  fontSize: '1.75rem',
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  // A room number is normally 3-4 characters, but nothing in
                  // the schema caps it and imports have produced ID-shaped
                  // values. An unbroken 17-character token has no wrap
                  // opportunity, so at 1.75rem/900 its min-content width is
                  // ~294px against a 189px card: it rendered outside the card
                  // and `body { overflow-x: clip }` then hid the evidence.
                  // Truncate instead, with the full value on hover.
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {room.room_number}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25, minWidth: 0 }}>
                <Typography
                  variant="caption"
                  title={room.room_type_code || getRoomTypeCode(room.room_type)}
                  sx={{
                    fontWeight: 800,
                    color: onFill(80),
                    letterSpacing: 0.6,
                    fontSize: '0.7rem',
                    lineHeight: 1,
                    // Same exposure as the room number above: the type code is
                    // free text and a long one must not widen the card.
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {room.room_type_code || getRoomTypeCode(room.room_type)}
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
                    stroke={onFill(70)}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  />
                </Box>
              </Box>
              {room.is_smoking && (
                <Tooltip title={t('card.smokingTooltip')} arrow>
                  <Box
                    sx={{
                      alignSelf: 'center',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.4,
                      px: 0.75,
                      py: 0.3,
                      borderRadius: 0.75,
                      bgcolor: onFill(16),
                      border: '1px solid',
                      borderColor: onFill(40),
                      color: ON_FILL,
                    }}
                  >
                    <SmokingIcon sx={{ fontSize: 12 }} />
                    <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.7 }}>
                      {t('card.smoking')}
                    </Typography>
                  </Box>
                </Tooltip>
              )}
            </Box>

            {/* Overdue-checkout flag: the banner aggregates these, this ties
                the warning to the specific room card. */}
            {overdueDays != null && overdueDays > 0 && (
              <Tooltip title={t('card.overdueTooltip', { count: overdueDays })} arrow>
                <Box
                  sx={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    px: 0.75,
                    py: 0.3,
                    borderRadius: 0.75,
                    bgcolor: 'var(--hotel-danger)',
                    border: '1px solid',
                    borderColor: onFill(40),
                    color: ON_FILL,
                  }}
                >
                  <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.7 }}>
                    {t('card.overdueBadge', { count: overdueDays })}
                  </Typography>
                </Box>
              </Tooltip>
            )}

          </Box>

          {/* Empty-state placeholder for housekeeping / maintenance rooms with no booking */}
          {!isOccupied && !isReservedToday && (computedStatus === 'dirty' || computedStatus === 'reserved_dirty' || computedStatus === 'maintenance') && (
            <Typography
              sx={{
                mt: 1.25,
                fontStyle: 'italic',
                color: onFill(85),
                fontSize: '0.85rem',
                fontWeight: 500,
              }}
            >
              {computedStatus === 'reserved_dirty'
                ? t('card.reservedNeedsCleaning')
                : computedStatus === 'dirty'
                  ? t('card.awaitingCleaning')
                  : t('card.underMaintenance')}
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
                bgcolor: 'background.paper',
                color: 'var(--hotel-chart-4)',
              }}
            >
              <GiftIcon sx={{ fontSize: 12 }} />
              <Typography variant="caption" sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0.5 }}>
                {t('card.freeGift')}
              </Typography>
            </Box>
          )}

          <Divider sx={{ my: 1, borderStyle: 'dashed', borderColor: onFill(35) }} />

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
              {room.notes || room.status_notes || t('card.addNotes')}
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
                  color: onFill(80),
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {formatMenuBookingDate(booking.check_in_date)} – {formatMenuBookingDate(booking.check_out_date)}
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
                  title={booking.cleaning_preference ? t('card.cleaningYesHint') : t('card.cleaningNoHint')}
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
                            bgcolor: 'background.paper',
                            color: 'var(--hotel-success)',
                            border: '1px solid var(--hotel-success-border)',
                          }
                        : {
                            bgcolor: 'background.paper',
                            color: 'text.secondary',
                            border: '1.5px dashed var(--hotel-border-strong)',
                          }),
                    }}
                  >
                    {booking.cleaning_preference ? (
                      <SparkleIcon sx={{ fontSize: 13 }} />
                    ) : (
                      <BlockIcon sx={{ fontSize: 13 }} />
                    )}
                    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700 }}>
                      {booking.cleaning_preference ? t('card.dailyCleaning') : t('card.noDailyCleaning')}
                    </Typography>
                  </Box>
                </Tooltip>
              )}

              {/* Booking Notes - Clickable to edit */}
              <Tooltip title={booking.remarks || booking.special_requests ? t('card.clickToEditNotes') : t('card.clickToAddNotes')} arrow>
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
                      bgcolor: onFill(12),
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
                    {booking.remarks || booking.special_requests || t('card.addBookingNotes')}
                  </Typography>
                  <EditIcon sx={{ fontSize: 10, opacity: 0.6 }} />
                </Box>
              </Tooltip>

              {/* Action row: Check out, Move, More */}
              <CardActionRow>
                <CardPillButton tone="paper" onClick={() => onCheckOut(room)}>
                  {t('card.checkOut')}
                </CardPillButton>
                <CardPillButton tone="paper" onClick={() => onChangeRoom(room)}>
                  {t('card.move')}
                </CardPillButton>
                <CardMoreButton onClick={(e) => onMenuOpen(e, room)} />
              </CardActionRow>
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
                    color: onFill(80),
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {formatMenuBookingDate(reservedBooking.check_in_date)} – {formatMenuBookingDate(reservedBooking.check_out_date)}
                </Typography>

                {/* Editable booking notes — same affordance as occupied rooms */}
                <Tooltip title={reservedBooking.remarks || reservedBooking.special_requests ? t('card.clickToEditNotes') : t('card.clickToAddNotes')} arrow>
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
                      '&:hover': { bgcolor: onFill(12) },
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
                      {reservedBooking.remarks || reservedBooking.special_requests || t('card.addBookingNotes')}
                    </Typography>
                    <EditIcon sx={{ fontSize: 10, opacity: 0.6 }} />
                  </Box>
                </Tooltip>
              </Box>

              {/* Action row: Check in (primary) + More */}
              <CardActionRow>
                <CardPillButton tone="dark" onClick={() => onCheckIn(room)}>
                  {t('card.checkIn')}
                </CardPillButton>
                <CardMoreButton onClick={(e) => onMenuOpen(e, room)} />
              </CardActionRow>
            </>
          )}

          {/* Upcoming Same-Day Reservation for Rooms That Need Cleaning */}
          {(computedStatus === 'dirty' || computedStatus === 'reserved_dirty') && reservedBooking && hasReservationForToday && (
            <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${onFill(30)}` }}>
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.5,
                py: 0.25,
                bgcolor: onFill(15),
                borderRadius: 1,
              }}>
                <CalendarIcon sx={{ fontSize: 14, color: onFill(80) }} />
                <Typography variant="caption" sx={{ color: onFill(80), fontWeight: 600, fontSize: '0.65rem' }}>
                  {t('card.reservedOn', { date: formatMenuBookingDate(reservedBooking.check_in_date) })}
                </Typography>
              </Box>
              {reservedBooking.guest_name && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <PersonIcon sx={{ fontSize: 12, color: onFill(80) }} />
                  <Typography variant="caption" sx={{
                    color: ON_FILL,
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
            <CardActionRow>
              <CardPillButton tone="dark" onClick={() => onMarkAvailable(room)}>
                {computedStatus === 'reserved_dirty' ? t('card.markClean') : t('card.markAvailable')}
              </CardPillButton>
              <CardMoreButton onClick={(e) => onMenuOpen(e, room)} />
            </CardActionRow>
          )}

          {/* Action row for Available Rooms: + New booking (primary) + More */}
          {computedStatus === 'available' && (
            <CardActionRow>
              <CardPillButton tone="dark" onClick={() => onNewBooking(room)}>
                {t('card.newBooking')}
              </CardPillButton>
              <CardMoreButton onClick={(e) => onMenuOpen(e, room)} />
            </CardActionRow>
          )}

        </CardContent>
      </Card>
    </Box>
  );
};

// Memoized: card props are primitives or query-cache references (structural
// sharing keeps unchanged rooms/bookings identical across polls), and the
// page passes useCallback'd handlers — so unchanged cards skip re-rendering.
export default React.memo(RoomCard);
