import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { ListAlt as SummaryIcon, Check as CheckIcon } from '@mui/icons-material';
import { Room } from '../../../../../types';
import { BookingTokens } from '../bookingTokens';
import { isPositiveMoney } from '../../../../../utils/money';
import { useTranslation } from '../../../../../i18n/useTranslation';

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
}) => {
  const { t } = useTranslation('rooms');

  return (
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
      <SummaryIcon sx={{ fontSize: 14 }} /> {t('unified.summaryTitle')}
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
            {roomCount > 1 ? t('common:count.rooms', { count: roomCount }) : room.room_number}
          </Typography>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.ink3, letterSpacing: 0.6, mt: 0.25, textTransform: 'uppercase' }}>
            {roomCount > 1 ? selectedRoomNumbers : room.room_type}
          </Typography>
          <Typography sx={{ fontSize: 11, color: D.green, fontWeight: 700, mt: 0.5 }}>
            ● {roomIsAvailable === false ? t('unified.conflict') : t('unified.availNow')}
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
        { k: t('fields.guest'),    v: summaryGuestName },
        { k: t('title'),           v: selectedRoomNumbers || '—' },
        { k: t('unified.sumSource'),   v: effectiveType === 'online' ? (bookingChannel || '—') : (effectiveType === 'walk_in' ? t('unified.sourceWalkIn') : effectiveType === 'complimentary' ? t('unified.sourceFreeCredit') : '—') },
        { k: t('fields.checkIn'),  v: formatHumanDate(checkInDate) || '—' },
        { k: t('fields.checkOut'), v: isHourlyBooking ? t('unified.hourlyCheckout', { date: formatHumanDate(checkInDate) }) : (formatHumanDate(checkOutDate) || '—') },
        { k: t('unified.sumDuration'), v: t('common:count.nights', { count: billableNights }) },
      ].map((r) => (
        <Box key={r.k} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 0.75, fontSize: 12.5 }}>
          <Box sx={{ color: D.ink3 }}>{r.k}</Box>
          <Box sx={{ color: D.ink, fontWeight: 600, textAlign: 'right', maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.v}</Box>
        </Box>
      ))}
    </Box>

    <Box sx={{ bgcolor: D.surface, border: `1px solid ${D.border}`, borderRadius: 1.5, p: 1.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
        <Box sx={{ color: D.ink3 }}>{roomCount > 1 ? t('unified.sumRoomRates') : t('fields.rate')}</Box>
        <Box sx={{ color: D.ink, fontWeight: 600 }}>
          {roomCount > 1
            ? t('unified.ratePerNightTotal', { amount: formatCurrency(nightlyRoomTotal) })
            : t('unified.ratePerNightValue', { amount: formatCurrency(ratePerNight) })}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
        <Box sx={{ color: D.ink3 }}>{t('unified.subtotal', { count: billableNights })}</Box>
        <Box sx={{ color: D.ink, fontWeight: 600 }}>{formatCurrency(subtotal)}</Box>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
        <Box sx={{ color: D.ink3 }}>{t('unified.tourismTax')}</Box>
        <Box sx={{ color: isPositiveMoney(tourismTaxAmount) ? D.ink : D.ink3, fontWeight: isPositiveMoney(tourismTaxAmount) ? 600 : 500 }}>
          {isPositiveMoney(tourismTaxAmount) ? formatCurrency(tourismTaxAmount) : '—'}
        </Box>
      </Box>
      {isPositiveMoney(extraBedCharge) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, fontSize: 12.5 }}>
          <Box sx={{ color: D.ink3 }}>{t('config.extraBed')}</Box>
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
        <Box sx={{ color: D.ink, fontWeight: 700 }}>{t('common:field.total')}</Box>
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
          <CircularProgress size={12} /> {t('unified.checkingAvailability')}
        </Box>
      ) : roomIsAvailable === false ? (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: D.orange, fontWeight: 700, mb: 0.5 }}>
            <CheckIcon sx={{ fontSize: 13 }} /> {t('unified.roomConflict')}
          </Box>
          {t('unified.conflictBody')}
        </Box>
      ) : (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: D.green, fontWeight: 700, mb: 0.5 }}>
            <CheckIcon sx={{ fontSize: 13 }} /> {t('unified.noConflicts')}
          </Box>
          {checkInDate && checkOutDate && room
            ? t(roomCount > 1 ? 'unified.availForMulti' : 'unified.availForSingle', { from: formatHumanDate(checkInDate), to: formatHumanDate(checkOutDate) })
            : t('unified.pickDatesVerify')}
        </Box>
      )}
    </Box>
  </Box>
  );
};

export default BookingSummaryAside;
