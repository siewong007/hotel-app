import React from 'react';
import { Box, Typography, alpha } from '@mui/material';
import { RoomStatusType, getStatusConfig } from '../../../../config/roomStatusConfig';

interface RoomStatusBadgeProps {
  status: RoomStatusType;
  showIcon?: boolean;
  showLabel?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'filled' | 'outlined' | 'soft';
}

/**
 * Room Status Badge Component
 * A more subtle alternative to chips, good for compact displays
 */
const RoomStatusBadge: React.FC<RoomStatusBadgeProps> = ({
  status,
  showIcon = true,
  showLabel = true,
  size = 'medium',
  variant = 'soft',
}) => {
  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  const sizeConfig = {
    small: { iconSize: 16, padding: '4px 8px', fontSize: '0.75rem' },
    medium: { iconSize: 20, padding: '6px 12px', fontSize: '0.875rem' },
    large: { iconSize: 24, padding: '8px 16px', fontSize: '1rem' },
  };

  const currentSize = sizeConfig[size];

  const getVariantStyles = () => {
    switch (variant) {
      case 'filled':
        return {
          backgroundColor: config.bgColor,
          color: config.textColor,
          border: `2px solid ${config.borderColor}`,
        };
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          color: config.bgColor,
          border: `2px solid ${config.bgColor}`,
        };
      case 'soft':
      default:
        return {
          backgroundColor: alpha(config.bgColor, 0.15),
          color: config.bgColor,
          border: `1px solid ${alpha(config.bgColor, 0.3)}`,
        };
    }
  };

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        padding: currentSize.padding,
        borderRadius: 1.5,
        fontWeight: 600,
        fontSize: currentSize.fontSize,
        transition: 'all 0.2s ease-in-out',
        ...getVariantStyles(),
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: 1,
        },
      }}
    >
      {showIcon && (
        <IconComponent sx={{ fontSize: currentSize.iconSize }} />
      )}
      {showLabel && (
        <Typography
          variant="body2"
          sx={{
            fontSize: 'inherit',
            fontWeight: 'inherit',
            color: 'inherit',
          }}
        >
          {config.shortLabel}
        </Typography>
      )}
    </Box>
  );
};

export default RoomStatusBadge;
