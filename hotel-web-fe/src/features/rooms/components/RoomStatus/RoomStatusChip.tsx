import React from 'react';
import { Chip, ChipProps, Tooltip, Box } from '@mui/material';
import { RoomStatusType, getStatusConfig } from '../../../../config/roomStatusConfig';

interface RoomStatusChipProps {
  status: RoomStatusType;
  size?: ChipProps['size'];
  variant?: ChipProps['variant'];
  showIcon?: boolean;
  showTooltip?: boolean;
  onClick?: () => void;
  animated?: boolean;
}

/**
 * Reusable Room Status Chip Component
 * Displays status with consistent styling across the application
 */
const RoomStatusChip: React.FC<RoomStatusChipProps> = ({
  status,
  size = 'small',
  variant = 'filled',
  showIcon = true,
  showTooltip = true,
  onClick,
  animated = false,
}) => {
  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  const chip = (
    <Chip
      icon={showIcon ? <IconComponent /> : undefined}
      label={config.label}
      size={size}
      color={config.color}
      variant={variant}
      onClick={onClick}
      clickable={!!onClick}
      sx={{
        fontWeight: 600,
        minWidth: size === 'small' ? 90 : 110,
        '& .MuiChip-icon': {
          color: 'inherit',
        },
        // Animated pulsing effect for statuses that require action
        ...(animated && config.requiresAction && {
          animation: 'pulse 2s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': {
              opacity: 1,
              transform: 'scale(1)',
            },
            '50%': {
              opacity: 0.8,
              transform: 'scale(1.05)',
            },
          },
        }),
        // Hover effect
        ...({
          transition: 'all 0.2s ease-in-out',
          '&:hover': onClick ? {
            transform: 'scale(1.05)',
            boxShadow: 2,
          } : {},
        }),
      }}
    />
  );

  if (showTooltip) {
    return (
      <Tooltip
        title={
          <Box>
            <div style={{ fontWeight: 600 }}>{config.label}</div>
            <div style={{ fontSize: '0.85em', marginTop: 4 }}>{config.description}</div>
            {config.requiresAction && config.actionLabel && (
              <div style={{ fontSize: '0.85em', marginTop: 4, fontStyle: 'italic' }}>
                Action: {config.actionLabel}
              </div>
            )}
          </Box>
        }
        arrow
        placement="top"
      >
        {chip}
      </Tooltip>
    );
  }

  return chip;
};

export default RoomStatusChip;
