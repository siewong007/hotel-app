import React from 'react';
import { Box, Typography } from '@mui/material';
import type { BoxProps } from '@mui/material';

export interface EmptyStateProps extends Omit<BoxProps, 'title'> {
  /** Optional icon rendered muted above the title. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** One line telling the user why it's empty or what to do next. */
  description?: React.ReactNode;
  /** Optional call-to-action (button/link node). */
  action?: React.ReactNode;
}

/** Canonical empty state: icon + title + hint + optional action. Replaces the
 * ~70 one-off "No X found" blocks. */
const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  sx,
  ...boxProps
}) => (
  <Box
    sx={[
      {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 5,
        px: 2,
        gap: 0.5,
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}
    {...boxProps}
  >
    {icon && (
      <Box sx={{ color: 'text.disabled', mb: 0.5, '& svg': { fontSize: 40 } }}>{icon}</Box>
    )}
    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
      {title}
    </Typography>
    {description && (
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {description}
      </Typography>
    )}
    {action && <Box sx={{ mt: 1.5 }}>{action}</Box>}
  </Box>
);

export default EmptyState;
