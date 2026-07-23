import React from 'react';
import { Box, Typography } from '@mui/material';
import { GUEST_DESIGN } from '../constants';

interface ContactRowProps {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  placeholder: string;
  onAdd?: () => void;
  readOnly?: boolean;
}

export const ContactRow: React.FC<ContactRowProps> = ({ icon, label, value, placeholder, onAdd, readOnly = false }) => {
  const empty = !value;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, borderBottom: `1px dashed ${GUEST_DESIGN.rule}` }}>
      <Box sx={{
        width: 30,
        height: 30,
        borderRadius: 1,
        bgcolor: empty ? GUEST_DESIGN.paper3 : GUEST_DESIGN.green50,
        color: empty ? GUEST_DESIGN.ink4 : GUEST_DESIGN.green700,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'inline-flex', '& svg': { fontSize: 16 } }}>{icon}</Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, color: GUEST_DESIGN.ink3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          {label}
        </Typography>
        {empty && !readOnly ? (
          <Box
            component="button"
            onClick={onAdd}
            sx={{
              fontSize: 13,
              color: GUEST_DESIGN.green700,
              fontWeight: 600,
              border: 0,
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            + {placeholder}
          </Box>
        ) : (
          <Typography sx={{ fontSize: 13.5, color: GUEST_DESIGN.ink, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>
            {value || '—'}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  small?: boolean;
  accent?: 'green' | 'gold';
  onClick?: () => void;
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, small, accent, onClick }) => {
  const tones = {
    green: { bg: GUEST_DESIGN.green50, fg: GUEST_DESIGN.green700 },
    gold: { bg: GUEST_DESIGN.goldBg, fg: GUEST_DESIGN.gold },
  } as const;
  const c = accent ? tones[accent] : { bg: GUEST_DESIGN.paper2, fg: GUEST_DESIGN.ink };
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      sx={{
        bgcolor: c.bg,
        borderRadius: 1,
        px: 1.5,
        py: 1.25,
        textAlign: 'left',
        border: 0,
        fontFamily: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 120ms',
        '&:hover': onClick ? { transform: 'translateY(-1px)' } : undefined,
      }}
    >
      <Typography sx={{ fontSize: 11, color: GUEST_DESIGN.ink3, fontWeight: 600, mb: 0.25 }}>{label}</Typography>
      <Typography sx={{ fontSize: small ? 13 : 18, fontWeight: 700, color: c.fg, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
};
