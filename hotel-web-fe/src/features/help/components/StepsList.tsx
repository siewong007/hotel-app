import React from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { HelpStep } from '../types';

interface StepsListProps {
  steps: HelpStep[];
}

/** Numbered procedure list with a connecting rail — the visual signature of a
 * "how to" article. Ordered markup stays semantic for screen readers. */
const StepsList: React.FC<StepsListProps> = ({ steps }) => (
  <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
    {steps.map((step, index) => {
      const last = index === steps.length - 1;
      return (
        <Box
          component="li"
          key={index}
          sx={{ display: 'flex', gap: 1.75, pb: last ? 0 : 2.25 }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <Box
              aria-hidden="true"
              sx={(theme) => ({
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: 'primary.dark',
                fontSize: '0.8rem',
                fontWeight: 800,
                border: '1px solid',
                borderColor: alpha(theme.palette.primary.main, 0.3),
              })}
            >
              {index + 1}
            </Box>
            {!last && <Box sx={{ width: 2, flex: 1, mt: 0.5, bgcolor: 'divider' }} />}
          </Box>
          <Box sx={{ minWidth: 0, pt: 0.25 }}>
            <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 700 }}>
              {step.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {step.body}
            </Typography>
          </Box>
        </Box>
      );
    })}
  </Box>
);

export default StepsList;
