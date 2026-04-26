import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  FormControl,
  Select,
  MenuItem,
  IconButton,
  Popover,
  Divider,
  alpha,
} from '@mui/material';
import {
  ChevronLeft,
  ChevronRight,
  Refresh,
  Person,
  Phone,
  Email,
  CalendarToday,
  Payment,
  CardGiftcard,
  Notes,
  AttachMoney,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, BookingWithDetails } from '../../../types';
import {
  getUnifiedStatusColor,
  getUnifiedStatusLabel,
} from '../config';
import { useCurrency } from '../../../hooks/useCurrency';

// ── Layout ────────────────────────────────────────────────────────────────
const ROOM_COL = 220;
const DAY_W = 88;
const ROW_H = 76;

// ── Concept B "sketchy" palette ───────────────────────────────────────────
const PALETTE = {
  pageBg: '#e8e4db',
  panelBg: '#f5f2eb',
  headerBg: '#ede9df',
  ink: '#1c1c1c',
  inkMuted: '#888',
  inkSubtle: '#555',
  todayAccent: '#e85d3a',
  rowDivider: '#c8c2b4',
  zebra: 'rgba(0,0,0,0.015)',
};

// Sketchy status colors (bar fill + border). Falls back through unified status helper.
function statusBarColors(status: string, isComplimentary?: boolean): { bg: string; border: string } {
  if (isComplimentary) return { bg: '#55efc4', border: '#00b894' };
  switch (status) {
    case 'checked_in':
    case 'auto_checked_in':
    case 'occupied':
      return { bg: '#ffd166', border: '#c9a100' };
    case 'reserved':
    case 'confirmed':
      return { bg: '#74b9ff', border: '#1a6fc9' };
    case 'pending':
      return { bg: '#a29bfe', border: '#6c5ce7' };
    default:
      return { bg: '#dcd6ca', border: '#666' };
  }
}

// Load Caveat handwritten font once on mount.
function useCaveatFont() {
  useEffect(() => {
    const id = 'caveat-font-link';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
}

// Day-precision delta — normalises both ends to local midnight so DST and
// the booking timestamp's time-of-day don't shift the column index.
function dayIndex(start: Date, target: Date | string): number {
  const a = new Date(start);
  a.setHours(0, 0, 0, 0);
  const b = typeof target === 'string' ? new Date(target) : new Date(target);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface TimelineBooking {
  id: number | string;
  booking_number?: string;
  room_id: number | string;
  room_number?: string;
  room_type?: string;
  guest_name: string;
  guest_email?: string;
  guest_phone?: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  payment_status?: string;
  payment_method?: string;
  total_amount?: number | string;
  price_per_night?: number | string;
  number_of_nights?: number;
  deposit_amount?: number | string;
  deposit_paid?: boolean;
  special_requests?: string;
  is_complimentary?: boolean;
  complimentary_nights?: number;
  complimentary_start_date?: string;
  complimentary_end_date?: string;
  complimentary_reason?: string;
  number_of_guests?: number;
  extra_bed_count?: number;
  extra_bed_charge?: number | string;
  company_name?: string;
  rate_code?: string;
}

const RoomReservationTimeline: React.FC = () => {
  useCaveatFont();
  const { format: formatCurrency } = useCurrency();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<TimelineBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daysToShow, setDaysToShow] = useState(14);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const loadingRef = useRef(false);

  // Hover popover (rich booking details)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [hoveredBooking, setHoveredBooking] = useState<TimelineBooking | null>(null);
  const popoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, daysToShow]);

  const loadData = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [roomsData, bookingsData] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getBookingsWithDetails(),
      ]);

      const sortedRooms = [...roomsData].sort((a, b) => {
        const na = parseInt(a.room_number);
        const nb = parseInt(b.room_number);
        return na - nb;
      });

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + daysToShow);

      const relevantBookings: TimelineBooking[] = bookingsData
        .filter((b: BookingWithDetails) => {
          if (['checked_out', 'voided'].includes(b.status as string)) return false;
          const isCheckedIn = b.status === 'checked_in' || b.status === 'auto_checked_in';
          if (isCheckedIn) return true;
          const bookingEnd = new Date(b.check_out_date);
          const bookingStart = new Date(b.check_in_date);
          return bookingStart <= endDate && bookingEnd >= startDate;
        })
        .map((b: BookingWithDetails) => ({
          id: b.id,
          booking_number: b.booking_number,
          room_id: b.room_id,
          room_number: b.room_number,
          room_type: b.room_type,
          guest_name: b.guest_name || 'Unknown Guest',
          guest_email: b.guest_email,
          guest_phone: b.guest_phone,
          check_in_date: b.check_in_date,
          check_out_date: b.check_out_date,
          status: b.status as string,
          payment_status: b.payment_status as string,
          payment_method: b.payment_method,
          total_amount: b.total_amount,
          price_per_night: b.price_per_night,
          number_of_nights: b.number_of_nights,
          deposit_amount: b.deposit_amount,
          deposit_paid: b.deposit_paid,
          special_requests: b.special_requests,
          is_complimentary: b.is_complimentary,
          complimentary_nights: b.complimentary_nights,
          complimentary_start_date: b.complimentary_start_date,
          complimentary_end_date: b.complimentary_end_date,
          complimentary_reason: b.complimentary_reason,
          number_of_guests: b.number_of_guests,
          extra_bed_count: b.extra_bed_count,
          extra_bed_charge: b.extra_bed_charge,
          company_name: b.company_name,
          rate_code: b.rate_code,
        }));

      // Synthetic entries for occupied/checked-in rooms with no booking record.
      const syntheticBookings: TimelineBooking[] = [];
      roomsData.forEach((room: Room) => {
        const hasBooking = relevantBookings.some(b => Number(b.room_id) === Number(room.id));
        if (hasBooking) return;
        if (room.status && ['occupied', 'checked_in'].includes(room.status)) {
          syntheticBookings.push({
            id: `synthetic-${room.id}`,
            room_id: room.id,
            guest_name: 'Walk-in Guest',
            check_in_date: room.reserved_start_date || startDate.toISOString().split('T')[0],
            check_out_date: room.reserved_end_date || endDate.toISOString().split('T')[0],
            status: room.status,
          });
        }
      });

      setRooms(sortedRooms);
      setBookings([...relevantBookings, ...syntheticBookings]);
    } catch (err: any) {
      setError(err.message || 'Failed to load timeline data');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const dates: Date[] = (() => {
    const arr: Date[] = [];
    for (let i = 0; i < daysToShow; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  })();

  const goToPreviousWeek = () => {
    const d = new Date(startDate);
    d.setDate(d.getDate() - 7);
    setStartDate(d);
  };
  const goToNextWeek = () => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 7);
    setStartDate(d);
  };
  const goToToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setStartDate(d);
  };

  const handleBarMouseEnter = (e: React.MouseEvent<HTMLElement>, booking: TimelineBooking) => {
    if (popoverTimeoutRef.current) clearTimeout(popoverTimeoutRef.current);
    const target = e.currentTarget;
    popoverTimeoutRef.current = setTimeout(() => {
      setPopoverAnchor(target);
      setHoveredBooking(booking);
    }, 250);
  };
  const handleBarMouseLeave = () => {
    if (popoverTimeoutRef.current) clearTimeout(popoverTimeoutRef.current);
    popoverTimeoutRef.current = setTimeout(() => {
      setPopoverAnchor(null);
      setHoveredBooking(null);
    }, 150);
  };
  const handlePopoverMouseEnter = () => {
    if (popoverTimeoutRef.current) clearTimeout(popoverTimeoutRef.current);
  };
  const handlePopoverMouseLeave = () => {
    setPopoverAnchor(null);
    setHoveredBooking(null);
  };

  const totalGridWidth = ROOM_COL + DAY_W * daysToShow;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeLabel = (() => {
    const last = dates[dates.length - 1];
    if (!last) return '';
    const sameYear = startDate.getFullYear() === last.getFullYear();
    const left = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const right = last.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    return `${left} – ${right}, ${last.getFullYear()}`;
  })();

  // Status pill colors for legend (matches statusBarColors above).
  const LEGEND: Array<{ label: string; color: string }> = [
    { label: 'Occupied', color: '#ffd166' },
    { label: 'Reserved', color: '#74b9ff' },
    { label: 'Pending', color: '#a29bfe' },
    { label: 'Complimentary', color: '#55efc4' },
  ];

  return (
    <Box
      sx={{
        p: 4,
        bgcolor: PALETTE.pageBg,
        minHeight: '100vh',
        fontFamily: "'Caveat', cursive",
      }}
    >
      <Box
        sx={{
          bgcolor: PALETTE.panelBg,
          border: `2.5px solid ${PALETTE.ink}`,
          borderRadius: '8px',
          boxShadow: `4px 4px 0 ${PALETTE.ink}`,
          overflow: 'hidden',
        }}
      >
        {/* ── Header bar ── */}
        <Box
          sx={{
            bgcolor: PALETTE.headerBg,
            borderBottom: `2px solid ${PALETTE.ink}`,
            px: 2,
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
            fontFamily: "'Caveat', cursive",
          }}
        >
          <Box>
            <Typography sx={{ fontFamily: 'inherit', fontSize: 26, fontWeight: 700, color: PALETTE.ink, lineHeight: 1.1 }}>
              Reservation Timeline
            </Typography>
            <Typography sx={{ fontFamily: 'inherit', fontSize: 16, color: PALETTE.inkMuted, lineHeight: 1.2 }}>
              {rooms.length} rooms · {bookings.length} active bookings
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <SketchyBtn onClick={goToPreviousWeek}>‹</SketchyBtn>
            <Box
              sx={{
                fontFamily: 'inherit',
                fontSize: 17,
                border: `1.5px solid ${PALETTE.ink}`,
                borderRadius: '4px',
                px: 1.75,
                py: 0.25,
                color: PALETTE.ink,
                whiteSpace: 'nowrap',
              }}
            >
              {rangeLabel}
            </Box>
            <SketchyBtn onClick={goToNextWeek}>›</SketchyBtn>
            <SketchyBtn filled onClick={goToToday}>Today</SketchyBtn>

            <FormControl size="small" sx={{ minWidth: 96 }}>
              <Select
                value={daysToShow}
                onChange={(e) => setDaysToShow(Number(e.target.value))}
                sx={{
                  fontFamily: "'Caveat', cursive",
                  fontSize: 16,
                  bgcolor: PALETTE.panelBg,
                  borderRadius: '4px',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: PALETTE.ink, borderWidth: 1.5 },
                }}
              >
                <MenuItem value={7}>7 Days</MenuItem>
                <MenuItem value={14}>14 Days</MenuItem>
                <MenuItem value={30}>30 Days</MenuItem>
                <MenuItem value={60}>60 Days</MenuItem>
              </Select>
            </FormControl>

            <IconButton
              onClick={loadData}
              size="small"
              sx={{ border: `1.5px solid ${PALETTE.ink}`, borderRadius: '4px', color: PALETTE.ink }}
            >
              <Refresh fontSize="small" />
            </IconButton>

            <Box sx={{ display: 'flex', gap: 0.75, ml: 1, flexWrap: 'wrap' }}>
              {LEGEND.map(({ label, color }) => (
                <Box
                  key={label}
                  sx={{
                    fontFamily: 'inherit',
                    fontSize: 14,
                    px: 1.25,
                    py: 0.25,
                    borderRadius: '20px',
                    border: `1.5px solid ${PALETTE.ink}`,
                    bgcolor: color,
                    color: PALETTE.ink,
                  }}
                >
                  {label}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ m: 2, fontFamily: 'sans-serif' }}>
            {error}
          </Alert>
        )}

        {/* ── Grid ── */}
        {loading && rooms.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ position: 'relative', overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
            <Box sx={{ width: totalGridWidth, position: 'relative' }}>
              {/* Day header row (sticky) */}
              <Box
                sx={{
                  display: 'flex',
                  borderBottom: `2px solid ${PALETTE.ink}`,
                  bgcolor: PALETTE.headerBg,
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                }}
              >
                <Box
                  sx={{
                    width: ROOM_COL,
                    flexShrink: 0,
                    px: 1.75,
                    py: 1,
                    borderRight: `2px solid ${PALETTE.ink}`,
                    position: 'sticky',
                    left: 0,
                    bgcolor: PALETTE.headerBg,
                    zIndex: 11,
                  }}
                >
                  <Typography sx={{ fontFamily: 'inherit', fontSize: 16, color: PALETTE.inkMuted }}>Room</Typography>
                </Box>
                {dates.map((d, i) => {
                  const isToday = sameDay(d, today);
                  return (
                    <Box
                      key={i}
                      sx={{
                        width: DAY_W,
                        flexShrink: 0,
                        textAlign: 'center',
                        py: 0.75,
                        borderRight: `1px solid ${PALETTE.rowDivider}`,
                        bgcolor: isToday ? alpha(PALETTE.todayAccent, 0.1) : 'transparent',
                      }}
                    >
                      <Typography sx={{ fontFamily: 'inherit', fontSize: 13, color: isToday ? PALETTE.todayAccent : PALETTE.inkMuted, lineHeight: 1.1 }}>
                        {d.toLocaleDateString('en-US', { weekday: 'short' })} · {d.toLocaleDateString('en-US', { month: 'short' })}
                      </Typography>
                      <Typography
                        sx={{
                          fontFamily: 'inherit',
                          fontSize: 24,
                          lineHeight: 1.05,
                          fontWeight: isToday ? 700 : 400,
                          color: isToday ? PALETTE.todayAccent : PALETTE.ink,
                        }}
                      >
                        {d.getDate()}
                      </Typography>
                      {isToday && (
                        <Typography sx={{ fontFamily: 'inherit', fontSize: 12, color: PALETTE.todayAccent, mt: '-2px' }}>
                          today
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>

              {/* Room rows */}
              {rooms.map((room) => {
                const roomBookings = bookings.filter((b) => Number(b.room_id) === Number(room.id));
                return (
                  <Box
                    key={room.id}
                    sx={{
                      display: 'flex',
                      borderBottom: `1px solid ${PALETTE.rowDivider}`,
                      position: 'relative',
                      height: ROW_H,
                    }}
                  >
                    {/* Room info cell (sticky) */}
                    <Box
                      sx={{
                        width: ROOM_COL,
                        flexShrink: 0,
                        borderRight: `2px solid ${PALETTE.ink}`,
                        px: 1.75,
                        py: 1.25,
                        bgcolor: PALETTE.panelBg,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        position: 'sticky',
                        left: 0,
                        zIndex: 5,
                      }}
                    >
                      <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 22, color: PALETTE.ink, lineHeight: 1.1 }}>
                        {room.room_number}
                      </Typography>
                      <Typography sx={{ fontFamily: 'inherit', fontSize: 14, color: PALETTE.inkSubtle, lineHeight: 1.1 }}>
                        {room.room_type}
                      </Typography>
                      <Typography sx={{ fontFamily: 'inherit', fontSize: 14, color: PALETTE.todayAccent, fontWeight: 600, lineHeight: 1.1 }}>
                        {formatCurrency(Number(room.price_per_night))}/night
                      </Typography>
                    </Box>

                    {/* Day cell backgrounds */}
                    <Box sx={{ position: 'absolute', left: ROOM_COL, top: 0, right: 0, bottom: 0, display: 'flex' }}>
                      {dates.map((d, i) => {
                        const isToday = sameDay(d, today);
                        return (
                          <Box
                            key={i}
                            sx={{
                              width: DAY_W,
                              flexShrink: 0,
                              height: '100%',
                              borderRight: `1px solid ${PALETTE.rowDivider}`,
                              bgcolor: isToday
                                ? alpha(PALETTE.todayAccent, 0.05)
                                : i % 2 === 0
                                ? 'transparent'
                                : PALETTE.zebra,
                            }}
                          />
                        );
                      })}
                    </Box>

                    {/* Booking bars */}
                    {roomBookings.map((b) => {
                      const startCol = Math.max(0, dayIndex(startDate, b.check_in_date));
                      let endCol = Math.min(daysToShow, dayIndex(startDate, b.check_out_date));
                      // For checked-in stays already past their checkout date, extend to today
                      const isCheckedIn = b.status === 'checked_in' || b.status === 'auto_checked_in';
                      if (isCheckedIn) {
                        const todayCol = dayIndex(startDate, today) + 1;
                        if (todayCol > endCol) endCol = Math.min(daysToShow, todayCol);
                      }
                      // Same-day stays: render as 1 day
                      if (endCol <= startCol) endCol = Math.min(daysToShow, startCol + 1);
                      const span = endCol - startCol;
                      if (span <= 0) return null;

                      const sc = statusBarColors(b.status, b.is_complimentary);
                      const left = ROOM_COL + startCol * DAY_W + 4;
                      const width = span * DAY_W - 8;
                      const showText = width > 90;
                      const showRate = width > 160;
                      const isSynthetic = String(b.id).startsWith('synthetic-');

                      return (
                        <Box
                          key={b.id}
                          onMouseEnter={(e) => handleBarMouseEnter(e, b)}
                          onMouseLeave={handleBarMouseLeave}
                          sx={{
                            position: 'absolute',
                            left,
                            top: 8,
                            bottom: 8,
                            width,
                            bgcolor: sc.bg,
                            border: `2px solid ${sc.border}`,
                            borderRadius: '5px',
                            px: 1,
                            py: 0.5,
                            cursor: 'pointer',
                            overflow: 'hidden',
                            zIndex: 4,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            transition: 'filter 0.15s',
                            background: isSynthetic
                              ? `repeating-linear-gradient(45deg, ${sc.bg} 0 8px, ${alpha(sc.bg, 0.7)} 8px 16px)`
                              : sc.bg,
                            '&:hover': { filter: 'brightness(1.05)' },
                          }}
                        >
                          {showText && (
                            <>
                              <Typography
                                sx={{
                                  fontFamily: "'Caveat', cursive",
                                  fontSize: 18,
                                  fontWeight: 700,
                                  color: PALETTE.ink,
                                  lineHeight: 1.05,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {b.guest_name}
                              </Typography>
                              <Typography
                                sx={{
                                  fontFamily: "'Caveat', cursive",
                                  fontSize: 14,
                                  color: PALETTE.inkSubtle,
                                  lineHeight: 1.1,
                                }}
                              >
                                {b.is_complimentary ? `Complimentary (${b.complimentary_nights || 0}N)` : getUnifiedStatusLabel(b.status)}
                              </Typography>
                              {showRate && b.price_per_night && !b.is_complimentary && (
                                <Typography
                                  sx={{
                                    fontFamily: "'Caveat', cursive",
                                    fontSize: 14,
                                    color: PALETTE.inkSubtle,
                                    lineHeight: 1.1,
                                  }}
                                >
                                  {formatCurrency(Number(b.price_per_night))}/night
                                </Typography>
                              )}
                            </>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}

              {rooms.length === 0 && !loading && (
                <Box sx={{ p: 6, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: "'Caveat', cursive", fontSize: 20, color: PALETTE.inkMuted }}>
                    No rooms found
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* ── Booking detail popover ── */}
      <Popover
        open={Boolean(popoverAnchor) && Boolean(hoveredBooking)}
        anchorEl={popoverAnchor}
        onClose={handlePopoverMouseLeave}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        disableRestoreFocus
        sx={{
          pointerEvents: 'none',
          '& .MuiPopover-paper': {
            pointerEvents: 'auto',
            border: `2px solid ${PALETTE.ink}`,
            borderRadius: '6px',
            boxShadow: `4px 4px 0 ${PALETTE.ink}`,
            maxWidth: 360,
            bgcolor: PALETTE.panelBg,
          },
        }}
        slotProps={{
          paper: {
            onMouseEnter: handlePopoverMouseEnter,
            onMouseLeave: handlePopoverMouseLeave,
          },
        }}
      >
        {hoveredBooking && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Person sx={{ fontSize: 20, color: PALETTE.ink }} />
                <Typography sx={{ fontWeight: 700, fontSize: 17 }}>{hoveredBooking.guest_name}</Typography>
              </Box>
              {hoveredBooking.booking_number && (
                <Chip
                  label={hoveredBooking.booking_number}
                  size="small"
                  sx={{
                    fontSize: '0.65rem',
                    height: 20,
                    bgcolor: alpha(PALETTE.ink, 0.08),
                    color: PALETTE.ink,
                    fontWeight: 600,
                  }}
                />
              )}
            </Box>

            <Divider sx={{ my: 1, borderColor: PALETTE.rowDivider }} />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
              {hoveredBooking.guest_email && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Email sx={{ fontSize: 16, color: PALETTE.inkMuted }} />
                  <Typography variant="body2" sx={{ color: PALETTE.inkSubtle }}>
                    {hoveredBooking.guest_email}
                  </Typography>
                </Box>
              )}
              {hoveredBooking.guest_phone && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Phone sx={{ fontSize: 16, color: PALETTE.inkMuted }} />
                  <Typography variant="body2" sx={{ color: PALETTE.inkSubtle }}>
                    {hoveredBooking.guest_phone}
                  </Typography>
                </Box>
              )}
            </Box>

            <Paper
              elevation={0}
              sx={{
                p: 1.25,
                bgcolor: PALETTE.headerBg,
                border: `1px solid ${PALETTE.rowDivider}`,
                borderRadius: '4px',
                mb: 1,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <CalendarToday sx={{ fontSize: 16, color: PALETTE.ink }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {new Date(hoveredBooking.check_in_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {' → '}
                  {new Date(hoveredBooking.check_out_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Nights</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {hoveredBooking.number_of_nights || Math.ceil((new Date(hoveredBooking.check_out_date).getTime() - new Date(hoveredBooking.check_in_date).getTime()) / 86400000)}
                  </Typography>
                </Box>
                {hoveredBooking.number_of_guests && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Guests</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {hoveredBooking.number_of_guests}
                    </Typography>
                  </Box>
                )}
                {!!hoveredBooking.extra_bed_count && hoveredBooking.extra_bed_count > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Extra Beds</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {hoveredBooking.extra_bed_count}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AttachMoney sx={{ fontSize: 18, color: 'success.main' }} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main' }}>
                    {formatCurrency(Number(hoveredBooking.total_amount || 0))}
                  </Typography>
                  {hoveredBooking.price_per_night && (
                    <Typography variant="caption" color="text.secondary">
                      {formatCurrency(Number(hoveredBooking.price_per_night))}/night
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Chip
                  label={getUnifiedStatusLabel(hoveredBooking.status)}
                  size="small"
                  sx={{
                    bgcolor: getUnifiedStatusColor(hoveredBooking.status),
                    color: 'white',
                    fontWeight: 600,
                    fontSize: '0.65rem',
                    height: 22,
                  }}
                />
                {hoveredBooking.payment_status && (
                  <Chip
                    icon={<Payment sx={{ fontSize: 14, color: 'inherit !important' }} />}
                    label={hoveredBooking.payment_status}
                    size="small"
                    sx={{
                      bgcolor: alpha(PALETTE.ink, 0.08),
                      color: PALETTE.ink,
                      fontWeight: 600,
                      fontSize: '0.65rem',
                      height: 22,
                    }}
                  />
                )}
              </Box>
            </Box>

            {(hoveredBooking.deposit_amount || hoveredBooking.deposit_paid) && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary">Deposit:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {formatCurrency(Number(hoveredBooking.deposit_amount || 0))}
                </Typography>
                {hoveredBooking.deposit_paid && (
                  <Chip label="Collected" size="small" color="success" sx={{ height: 18, fontSize: '0.6rem' }} />
                )}
              </Box>
            )}

            {hoveredBooking.company_name && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary">Company:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {hoveredBooking.company_name}
                </Typography>
              </Box>
            )}

            {hoveredBooking.is_complimentary && (
              <Paper
                elevation={0}
                sx={{
                  p: 0.75,
                  bgcolor: alpha('#00b894', 0.12),
                  border: `1px solid #00b894`,
                  borderRadius: '4px',
                  mb: 0.75,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CardGiftcard sx={{ fontSize: 16, color: '#00b894' }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#00b894' }}>
                    Complimentary: {hoveredBooking.complimentary_nights || 0} nights
                  </Typography>
                </Box>
                {hoveredBooking.complimentary_reason && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 3 }}>
                    {hoveredBooking.complimentary_reason}
                  </Typography>
                )}
              </Paper>
            )}

            {hoveredBooking.special_requests && (
              <Box sx={{ mt: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Notes sx={{ fontSize: 16, color: 'warning.main', mt: 0.25 }} />
                  <Box>
                    <Typography variant="caption" color="text.secondary">Special Requests</Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                      {hoveredBooking.special_requests}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Popover>
    </Box>
  );
};

// Small "sketchy" pill button matching the reference's nav controls.
const SketchyBtn: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  filled?: boolean;
}> = ({ children, onClick, filled }) => (
  <Box
    onClick={onClick}
    sx={{
      fontFamily: "'Caveat', cursive",
      fontSize: 17,
      px: 1.5,
      py: 0.25,
      borderRadius: '4px',
      cursor: 'pointer',
      border: `1.5px solid ${PALETTE.ink}`,
      bgcolor: filled ? PALETTE.ink : 'transparent',
      color: filled ? PALETTE.panelBg : PALETTE.ink,
      lineHeight: 1.2,
      userSelect: 'none',
      whiteSpace: 'nowrap',
      '&:hover': { bgcolor: filled ? '#000' : alpha(PALETTE.ink, 0.05) },
    }}
  >
    {children}
  </Box>
);

export default RoomReservationTimeline;
