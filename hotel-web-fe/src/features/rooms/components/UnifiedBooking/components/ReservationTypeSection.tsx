import React from 'react';
import { Box, Typography, TextField } from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  EventAvailable as BookingIcon,
  CardGiftcard as GiftIcon,
  Public as PublicIcon,
} from '@mui/icons-material';
import { BookingTokens } from '../bookingTokens';
import { ReservationType } from '../bookingTypes';
import CollapsibleSection from '../../../../../components/common/CollapsibleSection';
import { useTranslation } from '../../../../../i18n/useTranslation';

interface BookingChannel {
  name: string;
  abbreviation?: string;
}

interface ReservationTypeSectionProps {
  D: BookingTokens;
  glyph: string;
  reservationType: ReservationType | null;
  onSelectType: (type: ReservationType) => void;
  bookingChannels: BookingChannel[];
  bookingChannel: string;
  onChannelSelect: (name: string) => void;
  bookingReference: string;
  onReferenceChange: (value: string) => void;
  currencySymbol: string;
}

/** Map a booking channel name → 1-2 letter logo + brand colour.
 *  OTA brand colours are intentionally literal — they identify the channel. */
const channelLogo = (name: string, emerald: string): { letters: string; bg: string; fg: string } => {
  const lc = name.toLowerCase();
  if (lc.includes('agoda'))     return { letters: 'A',  bg: '#FF4E63', fg: '#fff' };
  if (lc.includes('booking'))   return { letters: 'B.', bg: '#003580', fg: '#fff' };
  if (lc.includes('traveloka')) return { letters: 'T',  bg: '#0194F3', fg: '#fff' };
  if (lc.includes('expedia'))   return { letters: 'E',  bg: '#FFC72C', fg: '#1F2F4F' };
  if (lc.includes('airbnb'))    return { letters: 'A',  bg: '#FF5A5F', fg: '#fff' };
  if (lc.includes('hotels'))    return { letters: 'H',  bg: '#D32F2F', fg: '#fff' };
  if (lc.includes('trip'))      return { letters: 'TR', bg: '#287DFA', fg: '#fff' };
  if (lc.includes('direct'))    return { letters: '⌂',  bg: emerald, fg: 'var(--hotel-on-primary)' };
  return { letters: '+', bg: 'var(--hotel-neutral)', fg: 'var(--hotel-surface)' };
};

const ReservationTypeSection: React.FC<ReservationTypeSectionProps> = ({
  D,
  glyph,
  reservationType,
  onSelectType,
  bookingChannels,
  bookingChannel,
  onChannelSelect,
  bookingReference,
  onReferenceChange,
  currencySymbol,
}) => {
  const { t } = useTranslation('rooms');

  const typeTiles: Array<{
    k: ReservationType;
    label: string;
    desc: string;
    icon: React.ReactNode;
    color: string;
    soft: string;
  }> = [
    { k: 'walk_in',       label: t('unified.typeWalkIn'), desc: t('unified.typeWalkInDesc'), icon: <PersonAddIcon sx={{ fontSize: 20 }} />, color: D.orange, soft: D.orangeSoft },
    { k: 'online',        label: t('unified.typeOnline'), desc: t('unified.typeOnlineDesc'), icon: <BookingIcon sx={{ fontSize: 20 }} />,   color: D.blue,   soft: D.blueSoft },
    { k: 'complimentary', label: t('unified.typeComp'),   desc: t('unified.typeCompDesc'),   icon: <GiftIcon sx={{ fontSize: 20 }} />,      color: D.purple, soft: D.purpleSoft },
  ];

  return (
    <CollapsibleSection
      title={`${glyph} ${t('unified.secResType')}`}
      subtitle={reservationType ? typeTiles.find((tile) => tile.k === reservationType)?.label : undefined}
      collapseOnPhone
      sx={{ mb: 2.75 }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.25 }}>
        {typeTiles.map((tile) => {
          const on = reservationType === tile.k;
          return (
            <Box
              key={tile.k}
              component="button"
              onClick={() => onSelectType(tile.k)}
              sx={{
                bgcolor: on ? tile.soft : D.surface,
                border: `1.5px solid ${on ? tile.color : D.border}`,
                borderRadius: 1.5,
                p: '14px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.25,
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: D.ink,
                textAlign: 'center',
                transition: 'border-color 120ms, background 120ms',
                '&:hover': { borderColor: on ? tile.color : D.borderHi },
              }}
            >
              <Box sx={{ width: 38, height: 38, borderRadius: 1.25, display: 'grid', placeItems: 'center', bgcolor: tile.soft, color: tile.color }}>
                {tile.icon}
              </Box>
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: D.ink, lineHeight: 1.2 }}>{tile.label}</Typography>
                <Typography sx={{ fontSize: 11, color: D.ink3, lineHeight: 1.35 }}>{tile.desc}</Typography>
              </Box>
              {on && (
                <Box sx={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: tile.color, bgcolor: D.surface, border: `1px solid ${tile.color}`, px: 0.85, py: '2px', borderRadius: 999 }}>
                  {t('unified.selected')}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Channel picker — only for Online */}
      {reservationType === 'online' && (
        <Box sx={{ mt: 1.5, bgcolor: D.blueSoft, border: '1px solid var(--hotel-info-border)', borderRadius: 1.5, p: 1.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12, fontWeight: 700, color: D.blue, mb: 1.25 }}>
            <PublicIcon sx={{ fontSize: 14 }} /> {t('fields.channel')} <Box component="span" sx={{ color: D.blue }}>*</Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {bookingChannels.map((channel) => {
              const on = bookingChannel === channel.name;
              const logo = channelLogo(channel.name, D.emerald);
              return (
                <Box
                  key={channel.name}
                  component="button"
                  onClick={() => onChannelSelect(channel.name)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: on ? D.blueSoft : D.surface,
                    border: `1px solid ${on ? D.blue : D.border}`,
                    borderRadius: 999,
                    pl: '5px',
                    pr: 1.75,
                    py: '5px',
                    fontSize: 12,
                    fontWeight: on ? 600 : 500,
                    color: on ? D.blue : D.ink2,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    boxShadow: 'none',
                  }}
                >
                  <Box sx={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '-0.5px',
                    bgcolor: logo.bg,
                    color: logo.fg,
                  }}>
                    {logo.letters}
                  </Box>
                  {channel.name}
                </Box>
              );
            })}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 1.5 }}>
            <Box>
              <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>{t('fields.bookingReference')} *</Typography>
              <TextField
                fullWidth
                size="small"
                placeholder={t('unified.refPlaceholder')}
                value={bookingReference}
                onChange={(e) => onReferenceChange(e.target.value)}
                sx={{ bgcolor: D.surface }}
              />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>{t('fields.prepaidAmount')}</Typography>
              <TextField
                fullWidth
                size="small"
                placeholder={`${currencySymbol} 0.00`}
                sx={{ bgcolor: D.surface }}
                disabled
                helperText={t('unified.trackedAtCheckIn')}
              />
            </Box>
          </Box>
        </Box>
      )}
    </CollapsibleSection>
  );
};

export default ReservationTypeSection;
