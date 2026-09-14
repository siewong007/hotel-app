import React from 'react';
import { Box } from '@mui/material';
import {
  BlockOutlined as BlacklistIcon,
  EventOutlined as UpcomingIcon,
  HistoryOutlined as ReturningIcon,
  HotelOutlined as InHouseIcon,
  SnoozeOutlined as InactiveIcon,
  Star as MemberIcon,
  SupportAgentOutlined as OpenRequestsIcon,
  WarningAmberOutlined as MissingTourismIcon,
  WorkspacePremiumOutlined as VipIcon,
} from '@mui/icons-material';
import { GUEST_DESIGN } from '../../guests/constants';
import { useTranslation } from '../../../i18n/useTranslation';
import { GUEST_RELATIONS_SEGMENTS, type GuestRelationsSegment, type GuestRelationsSegmentCounts } from '../segments';

const SEGMENT_TONES: Partial<Record<GuestRelationsSegment, { icon?: React.ReactNode; tone?: string }>> = {
  member: { icon: <MemberIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.gold },
  incomplete: { tone: GUEST_DESIGN.amber },
  tourist: { tone: GUEST_DESIGN.blue },
  missingTourism: { icon: <MissingTourismIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.rose },
  vip: { icon: <VipIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.gold },
  blacklisted: { icon: <BlacklistIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.rose },
  openRequests: { icon: <OpenRequestsIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.blue },
  returning: { icon: <ReturningIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.green700 },
  inHouse: { icon: <InHouseIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.blue },
  upcoming: { icon: <UpcomingIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.amber },
  inactive: { icon: <InactiveIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.ink3 },
};

interface GuestSegmentChipsProps {
  segment: GuestRelationsSegment;
  counts: GuestRelationsSegmentCounts;
  onChange: (segment: GuestRelationsSegment) => void;
}

/** Pill-style filter row carried over from GuestConfigurationPage. */
const GuestSegmentChips: React.FC<GuestSegmentChipsProps> = ({ segment, counts, onChange }) => {
  const { t } = useTranslation('guests');
  return (
  <Box
    sx={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 0.75,
      p: '12px 16px',
      borderBottom: `1px solid ${GUEST_DESIGN.rule}`,
    }}
  >
    {GUEST_RELATIONS_SEGMENTS.map(({ key, labelKey }) => {
      const active = segment === key;
      const tone = SEGMENT_TONES[key];
      return (
        <Box
          key={key}
          component="button"
          onClick={() => onChange(key)}
          aria-pressed={active}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.5,
            py: 0.85,
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            border: active ? `1px solid ${GUEST_DESIGN.ink}` : `1px solid ${GUEST_DESIGN.rule}`,
            bgcolor: active ? GUEST_DESIGN.ink : 'background.paper',
            color: active ? '#fff' : GUEST_DESIGN.ink2,
            fontFamily: 'inherit',
            transition: 'background-color 120ms',
            '&:hover': { bgcolor: active ? GUEST_DESIGN.ink : GUEST_DESIGN.paper2 },
          }}
        >
          {tone?.icon && (
            <Box sx={{ display: 'inline-flex', color: active ? '#fff' : (tone.tone || GUEST_DESIGN.ink3) }}>
              {tone.icon}
            </Box>
          )}
          {t(labelKey)}
          <Box
            component="span"
            sx={{
              fontSize: 11,
              fontWeight: 700,
              px: 0.85,
              py: '1px',
              borderRadius: 999,
              minWidth: 18,
              textAlign: 'center',
              bgcolor: active ? 'rgba(255,255,255,0.18)' : (tone?.tone ? `color-mix(in srgb, ${tone.tone} 12%, transparent)` : GUEST_DESIGN.paper3),
              color: active ? '#fff' : (tone?.tone || GUEST_DESIGN.ink3),
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {counts[key]}
          </Box>
        </Box>
      );
    })}
  </Box>
  );
};

export default GuestSegmentChips;
