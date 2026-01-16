import React from 'react';
import { Box, keyframes } from '@mui/material';

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

const dotPulse = keyframes`
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
`;

interface LoadingSpinnerProps {
  size?: number;
  color?: string;
  variant?: 'circular' | 'dots';
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 40,
  color = '#26a69a', // Comfortable teal-green color
  variant = 'circular'
}) => {
  if (variant === 'dots') {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: `${size * 0.15}px`,
        }}
      >
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              width: size * 0.25,
              height: size * 0.25,
              borderRadius: '50%',
              backgroundColor: color,
              animation: `${dotPulse} 1.4s ease-in-out infinite`,
              animationDelay: `${index * 0.16}s`,
            }}
          />
        ))}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Outer rotating ring */}
      <Box
        sx={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: `${Math.max(2, size * 0.08)}px solid transparent`,
          borderTopColor: color,
          borderRightColor: `${color}60`,
          animation: `${rotate} 1s linear infinite`,
        }}
      />

      {/* Inner pulsing circle */}
      <Box
        sx={{
          width: '50%',
          height: '50%',
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${color}40, ${color}20)`,
          animation: `${pulse} 1.5s ease-in-out infinite`,
        }}
      />
    </Box>
  );
};

export default LoadingSpinner;
