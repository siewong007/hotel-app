import React from 'react';
import { Box, Typography, keyframes } from '@mui/material';

const rotate = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
`;

interface HotelSpinnerProps {
  size?: number;
}

const HotelSpinner: React.FC<HotelSpinnerProps> = ({ size = 120 }) => {
  const primaryColor = '#26a69a'; // Comfortable teal-green
  const secondaryColor = '#00bcd4'; // Bright cyan

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: size + 60,
        gap: 2,
      }}
    >
      {/* Main Spinner */}
      <Box
        sx={{
          position: 'relative',
          width: size,
          height: size,
        }}
      >
        {/* Outer rotating ring - Teal Green */}
        <Box
          sx={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            border: `${size * 0.06}px solid transparent`,
            borderTopColor: primaryColor,
            borderRightColor: `${primaryColor}40`,
            animation: `${rotate} 0.8s linear infinite`,
            transform: 'translateZ(0)',
          }}
        />

        {/* Inner static circle with pulse */}
        <Box
          sx={{
            position: 'absolute',
            width: '60%',
            height: '60%',
            top: '20%',
            left: '20%',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${primaryColor}30, ${secondaryColor}20)`,
            animation: `${pulse} 1.2s ease-in-out infinite`,
          }}
        />
      </Box>

      {/* Loading Text */}
      <Typography
        sx={{
          fontSize: Math.max(size * 0.11, 12),
          color: '#1a4d42',
          fontWeight: 500,
          letterSpacing: '0.03em',
        }}
      >
        Loading...
      </Typography>
    </Box>
  );
};

export default HotelSpinner;
