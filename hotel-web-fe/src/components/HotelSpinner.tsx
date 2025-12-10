import React from 'react';
import { Box, keyframes } from '@mui/material';

const spin = keyframes`
  0% {
    transform: rotateY(0deg);
  }
  100% {
    transform: rotateY(360deg);
  }
`;

const shimmer = keyframes`
  0% {
    background-position: -200% center;
  }
  100% {
    background-position: 200% center;
  }
`;

interface HotelSpinnerProps {
  size?: number;
}

const HotelSpinner: React.FC<HotelSpinnerProps> = ({ size = 120 }) => {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
      }}
    >
      <Box
        sx={{
          width: `${size}px`,
          height: `${size * 0.63}px`, // Credit card ratio (3.375:2.125)
          position: 'relative',
          transformStyle: 'preserve-3d',
          animation: `${spin} 2s linear infinite`,
        }}
      >
        {/* Hotel Access Card */}
        <Box
          sx={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 50%, #1a73e8 100%)',
            borderRadius: '8px',
            boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
            position: 'relative',
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.2)',
            backfaceVisibility: 'hidden',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              backgroundSize: '200% 100%',
              animation: `${shimmer} 2s linear infinite`,
            },
          }}
        >
          {/* Card Content */}
          <Box sx={{ position: 'relative', p: 2, height: '100%' }}>
            {/* Hotel Logo/Icon */}
            <Box
              sx={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1a73e8',
              }}
            >
              H
            </Box>

            {/* Magnetic Stripe (no weird sensor in the middle) */}
            <Box
              sx={{
                position: 'absolute',
                top: '40%',
                left: 0,
                right: 0,
                height: '20%',
                background: 'linear-gradient(90deg, #2c2c2c 0%, #1a1a1a 50%, #2c2c2c 100%)',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
              }}
            />

            {/* Card Number Pattern */}
            <Box
              sx={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                right: '12px',
                display: 'flex',
                gap: '8px',
              }}
            >
              {[1, 2, 3, 4].map((i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1,
                    height: '4px',
                    background: 'rgba(255,255,255,0.4)',
                    borderRadius: '2px',
                  }}
                />
              ))}
            </Box>

            {/* Hotel Text */}
            <Box
              sx={{
                position: 'absolute',
                bottom: '24px',
                right: '12px',
                fontSize: '10px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.9)',
                letterSpacing: '1px',
              }}
            >
              HOTEL
            </Box>
          </Box>
        </Box>

        {/* Card Back (for 3D effect) */}
        <Box
          sx={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #4285f4 0%, #1a73e8 50%, #4285f4 100%)',
            borderRadius: '8px',
            boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
            position: 'absolute',
            top: 0,
            left: 0,
            transform: 'rotateY(180deg)',
            backfaceVisibility: 'hidden',
            border: '2px solid rgba(255,255,255,0.2)',
          }}
        />
      </Box>
    </Box>
  );
};

export default HotelSpinner;
