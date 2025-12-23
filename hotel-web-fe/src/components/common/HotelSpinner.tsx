import React from 'react';
import { Box, Typography, keyframes } from '@mui/material';

const rotate = keyframes`
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
`;

const fadeIn = keyframes`
  from {
    opacity: 0;
  }
  to {
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
        minHeight: '200px',
        gap: 3,
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
            border: `${size * 0.08}px solid transparent`,
            borderTopColor: primaryColor,
            borderRightColor: `${primaryColor}60`,
            animation: `${rotate} 1s linear infinite`,
          }}
        />

        {/* Middle rotating ring (slower) - Cyan */}
        <Box
          sx={{
            position: 'absolute',
            width: '75%',
            height: '75%',
            top: '12.5%',
            left: '12.5%',
            borderRadius: '50%',
            border: `${size * 0.06}px solid transparent`,
            borderBottomColor: `${secondaryColor}80`,
            borderLeftColor: `${secondaryColor}40`,
            animation: `${rotate} 1.5s linear infinite reverse`,
          }}
        />

        {/* Inner pulsing circle - Gradient */}
        <Box
          sx={{
            position: 'absolute',
            width: '50%',
            height: '50%',
            top: '25%',
            left: '25%',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${primaryColor}40, ${secondaryColor}30)`,
            animation: `${pulse} 1.5s ease-in-out infinite`,
          }}
        />
      </Box>

      {/* Loading Text */}
      <Typography
        sx={{
          fontSize: size * 0.12,
          color: '#1a4d42',
          fontWeight: 500,
          letterSpacing: '0.05em',
          animation: `${fadeIn} 0.5s ease-in`,
        }}
      >
        Loading...
      </Typography>
    </Box>
  );
};

export default HotelSpinner;
