import React from 'react';
import { Box, Typography } from '@mui/material';
import type { BoxProps } from '@mui/material';

export interface PageHeaderProps extends Omit<BoxProps, 'title'> {
  /** Small-caps context line above the title, e.g. `FRONT DESK · SUNDAY, SEPTEMBER 13, 2026`. */
  kicker?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned action row (buttons, toggles). */
  actions?: React.ReactNode;
}

/** Canonical page header: kicker + title + subtitle left, actions right,
 * wrapping onto two rows on narrow screens. */
const PageHeader: React.FC<PageHeaderProps> = ({
  kicker,
  title,
  subtitle,
  actions,
  sx,
  ...boxProps
}) => (
  <Box
    sx={[
      {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: { xs: 'flex-start', sm: 'flex-end' },
        justifyContent: 'space-between',
        gap: 1.5,
        mb: 2.5,
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
    {...boxProps}
  >
    <Box sx={{ minWidth: 0 }}>
      {kicker && (
        <Typography
          variant="overline"
          component="div"
          sx={{ color: 'text.secondary', letterSpacing: '0.08em', lineHeight: 1.6 }}
        >
          {kicker}
        </Typography>
      )}
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {actions && (
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          flexShrink: 0,
        }}
      >
        {actions}
      </Box>
    )}
  </Box>
);

export default PageHeader;
