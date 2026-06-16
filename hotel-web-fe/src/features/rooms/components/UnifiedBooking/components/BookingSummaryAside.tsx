import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { ListAlt as SummaryIcon, Check as CheckIcon } from '@mui/icons-material';
import { Room } from '../../../../../types';
import { BookingTokens } from '../bookingTokens';

interface BookingSummaryAsideProps {
  D: BookingTokens;
  room: Room | null;
  roomCount: number;
  selectedRoomNumbers: string;
  roomIsAvailable: boolean | null;
  checkingAvailability: boolean;
  tagColor: string;
  tagSoft: string;
  tagLabel: string;
  summaryGuestName: string;
  effectiveType: 'walk_in' | 'online' | 'complimentary' | null;
  bookingChannel: string;
  checkInDate: string;
  checkOutDate: string;
  isHourlyBooking: boolean;
  billableNights: number;
  ratePerNight: number;
  nightlyRoomTotal: number;
  subtotal: number;
  tourismTaxAmount: number;
  extraBedCharge: number;
  total: number;
  formatCurrency: (value: number) => string;
  formatHumanDate: (d: string) => string;
}

const BookingSummaryAside: React.FC<BookingSummaryAsideProps> = ({
  D,
  room,
  roomCount,
  selectedRoomNumbers,
  roomIsAvailable,
  checkingAvailability,
  tagColor,
  tagSoft,
  tagLabel,
  summaryGuestName,
  effectiveType,
  bookingChannel,
  checkInDate,
  checkOutDate,
  isHourlyBooking,
  billableNights,
  ratePerNight,
  nightlyRoomTotal,
  subtotal,
  tourismTaxAmount,
  extraBedCharge,
  total,
  formatCurrency,
  formatHumanDate,
}) => (
  <Box sx={{
    display: { xs: 'none', md: 'flex' },
    flexDirection: 'column',
    gap: 1.75,
    bgcolor: D.surface2,
    borderLeft: `1px solid ${D.border}`,
    p: 2.75,
    overflowY: 'auto',
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 11, letterSpacing: 1.2, fontWeight: 700, color: D.ink3, textTransform: 'uppercase' }}>
      <SummaryIcon sx={{ fontSize: 14 }} /> Booking summary
    </Box>

    {room && (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.75,
        bgcolor: D.surface,
        border: `1px solid ${D.border}`,
        borderRadius: 1.5,
        borderLeft: `4px solid ${D.green}`,
      }}>
        <Box>
          <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, color: D.ink }}>
            {roomCount > 1 ? `${roomCount} rooms` : room.room_number}
          </Typography>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.ink3, letterSpacing: 0.6, mt: 0.25, textTransform: 'uppercase' }}>
            {roomCount > 1 ? selectedRoomNumbers : room.room_type}
          </Typography>
          <Typography sx={{ fontSize: 11, color: D.green, fontWeight: 700, mt: 0.5 }}>
            ● {roomIsAvailable === false ? 'Conflict' : 'Available now'}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, textAlign: 'right' }}>
          <Box sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            px: 1,
            py: 0.4,
            borderRadius: 999,
            bgcolor: tagSoft,
            color: tagColor,
          }}>
            {tagLabel}
          </Box>
        </Box>
      </Box>
    )}

    <Box sx={{ bgcolor: D.surface, border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1.75 }}>
      {[
        { k: 'Guest',     v: summaryGuestName },
        { k: 'Rooms',     v: selectedRoomNumbers || '—' },
        { k: 'Source',    v: effectiveType === 'online' ? (bookingChannel || '—') : (effectiveType === 'walk_in' ? 'Walk-in' : effectiveType === 'complimentary' ? 'Free credit' : '—') },
        { k: 'Check-in',  v: formatHumanDate(checkInDate) || '—' },
        { k: 'Check-out', v: isHourlyBooking ? `${formatHumanDate(checkInDate)} (hourly)` : (formatHumanDate(checkOutDate) || '—') },
        { k: 'Duration',  v: `${billableNights} ${billableNights === 1 ? 'night' : 'nights'}` },
      ].map((r) => (
        <Box key={r.k} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 0.75, fontSize: 12.5 }}>
          <Box sx={{ color: D.ink3 }}>{r.k}</Box>
          <Box sx={{ color: D.ink, fontWeight: 600, textAlign: 'right', maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.v}</Box>
        </Box>
      ))}
    </Box>

    <Box sx={{ bgcolor: D.surface, border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
        <Box sx={{ color: D.ink3 }}>{roomCount > 1 ? 'Room rates' : 'Rate'}</Box>
        <Box sx={{ color: D.ink, fontWeight: 600 }}>
          {roomCount > 1
            ? `${formatCurrency(nightlyRoomTotal)} / night total`
            : `${formatCurrency(ratePerNight)} / night`}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
        <Box sx={{ color: D.ink3 }}>Subtotal (×{billableNights})</Box>
        <Box sx={{ color: D.ink, fontWeight: 600 }}>{formatCurrency(subtotal)}</Box>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
        <Box sx={{ color: D.ink3 }}>Tourism tax</Box>
        <Box sx={{ color: tourismTaxAmount > 0 ? D.ink : D.ink3, fontWeight: tourismTaxAmount > 0 ? 600 : 500 }}>
          {tourismTaxAmount > 0 ? formatCurrency(tourismTaxAmount) : '—'}
        </Box>
      </Box>
      {extraBedCharge > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
          <Box sx={{ color: D.ink3 }}>Extra bed</Box>
          <Box sx={{ color: D.ink, fontWeight: 600 }}>{formatCurrency(extraBedCharge)}</Box>
        </Box>
      )}
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        borderTop: `1px solid ${D.border}`,
        mt: 1,
        pt: 1.5,
        fontSize: 14,
      }}>
        <Box sx={{ color: D.ink, fontWeight: 700 }}>Total</Box>
        <Box sx={{ color: D.emerald, fontWeight: 800, fontSize: 20, letterSpacing: '-0.4px' }}>
          {formatCurrency(total)}
        </Box>
      </Box>
    </Box>

    <Box sx={{
      bgcolor: D.surface,
      border: `1px solid ${D.border}`,
      borderRadius: 1.5,
      p: 1.5,
      fontSize: 11,
      color: D.ink2,
      lineHeight: 1.5,
    }}>
      {checkingAvailability ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: D.ink3 }}>
          <CircularProgress size={12} /> Checking availability…
        </Box>
      ) : roomIsAvailable === false ? (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: D.orange, fontWeight: 700, mb: 0.5 }}>
            <CheckIcon sx={{ fontSize: 13 }} /> Room conflict
          </Box>
          Another booking exists for the selected dates.
        </Box>
      ) : (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: D.green, fontWeight: 700, mb: 0.5 }}>
            <CheckIcon sx={{ fontSize: 13 }} /> No conflicts found
          </Box>
          {checkInDate && checkOutDate && room
            ? `${roomCount > 1 ? 'Selected rooms are' : 'Room is'} available for ${formatHumanDate(checkInDate)} → ${formatHumanDate(checkOutDate)}.`
            : 'Pick check-in and check-out dates to verify.'}
        </Box>
      )}
    </Box>
  </Box>
);

export default BookingSummaryAside;
