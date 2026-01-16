import React, { ReactNode } from 'react';
import { Box } from '@mui/material';

interface AnimatedRouteProps {
  children: ReactNode;
  animationType?: 'fade' | 'slide' | 'grow';
}

// Animation configurations - using CSS keyframes only
const animationConfigs = {
  fade: 'smoothFadeIn 0.2s ease-out forwards',
  slide: 'smoothSlideIn 0.2s ease-out forwards',
  grow: 'smoothGrowIn 0.2s ease-out forwards',
};

export const AnimatedRoute: React.FC<AnimatedRouteProps> = ({
  children,
  animationType = 'fade'
}) => {
  return (
    <Box
      sx={{
        width: '100%',
        minHeight: '100%',
        animation: animationConfigs[animationType],
        // GPU acceleration
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
      }}
    >
      {children}
    </Box>
  );
};
