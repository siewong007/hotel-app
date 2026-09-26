import React, { ReactNode } from 'react';
import { Box } from '@mui/material';

interface AnimatedRouteProps {
  children: ReactNode;
  animationType?: 'fade' | 'slide' | 'grow';
}

// Animation configurations - using CSS keyframes only.
// `backwards` (not `forwards`): once the entrance finishes the keyframe
// styles are dropped, so no transform lingers on the route wrapper. A
// lingering transform makes the wrapper the containing block for every
// `position: fixed` descendant, pinning page-level bars to the content
// instead of the viewport.
export const animationConfigs = {
  fade: 'smoothFadeIn 0.2s ease-out backwards',
  slide: 'smoothSlideIn 0.2s ease-out backwards',
  grow: 'smoothGrowIn 0.2s ease-out backwards',
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
      }}
    >
      {children}
    </Box>
  );
};
