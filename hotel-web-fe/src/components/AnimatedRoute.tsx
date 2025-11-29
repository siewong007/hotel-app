import React, { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Fade, Grow, Slide } from '@mui/material';

interface AnimatedRouteProps {
  children: ReactNode;
  animationType?: 'fade' | 'slide' | 'grow';
}

export const AnimatedRoute: React.FC<AnimatedRouteProps> = ({ 
  children, 
  animationType = 'fade' 
}) => {
  const location = useLocation();

  const commonProps = {
    in: true,
    timeout: {
      enter: 300,
      exit: 200,
    },
    appear: true,
  };

  const renderAnimation = () => {
    switch (animationType) {
      case 'slide':
        return (
          <Slide direction="left" {...commonProps}>
            <Box 
              sx={{ 
                width: '100%', 
                minHeight: '100%',
                animation: 'slideInRight 0.3s ease-out',
              }}
            >
              {children}
            </Box>
          </Slide>
        );
      case 'grow':
        return (
          <Grow {...commonProps}>
            <Box 
              sx={{ 
                width: '100%', 
                minHeight: '100%',
                animation: 'growIn 0.3s ease-out',
              }}
            >
              {children}
            </Box>
          </Grow>
        );
      default:
        return (
          <Fade {...commonProps}>
            <Box 
              sx={{ 
                width: '100%', 
                minHeight: '100%',
                animation: 'fadeIn 0.3s ease-out',
              }}
            >
              {children}
            </Box>
          </Fade>
        );
    }
  };

  return (
    <Box
      key={location.pathname}
      sx={{
        position: 'relative',
        width: '100%',
        minHeight: '100%',
      }}
    >
      {renderAnimation()}
    </Box>
  );
};
