import React from 'react';
import { Card, CardContent, Box, Typography, alpha } from '@mui/material';
import { RoomStatusType, getStatusConfig } from '../../../../config/roomStatusConfig';

interface RoomStatusSummaryCardProps {
  status: RoomStatusType;
  count: number;
  total?: number;
  onClick?: () => void;
  showPercentage?: boolean;
  compact?: boolean;
  animated?: boolean;
}

/**
 * Room Status Summary Card Component
 * Displays status count with visual styling
 */
const RoomStatusSummaryCard: React.FC<RoomStatusSummaryCardProps> = ({
  status,
  count,
  total,
  onClick,
  showPercentage = true,
  compact = false,
  animated = false,
}) => {
  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  const percentage = total && total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        background: `linear-gradient(135deg, ${config.bgColor} 0%, ${alpha(config.bgColor, 0.8)} 100%)`,
        color: config.textColor,
        transition: 'all 0.3s ease-in-out',
        position: 'relative',
        overflow: 'hidden',
        '&:hover': onClick
          ? {
              transform: 'translateY(-4px)',
              boxShadow: 4,
            }
          : {},
        // Animated pulsing effect for statuses that require action
        ...(animated && config.requiresAction && count > 0 && {
          animation: 'cardPulse 2s ease-in-out infinite',
          '@keyframes cardPulse': {
            '0%, 100%': {
              boxShadow: 2,
            },
            '50%': {
              boxShadow: 6,
            },
          },
        }),
      }}
    >
      {/* Background Icon */}
      <Box
        sx={{
          position: 'absolute',
          right: -10,
          bottom: -10,
          opacity: 0.15,
          transform: 'rotate(-15deg)',
        }}
      >
        <IconComponent sx={{ fontSize: compact ? 80 : 100 }} />
      </Box>

      <CardContent sx={{ py: compact ? 1.5 : 2, position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Left side: Status info */}
          <Box>
            <Typography
              variant="caption"
              sx={{
                opacity: 0.9,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontWeight: 600,
                fontSize: compact ? '0.65rem' : '0.75rem',
              }}
            >
              {config.label}
            </Typography>
            <Typography
              variant={compact ? 'h5' : 'h4'}
              sx={{
                fontWeight: 700,
                mt: compact ? 0.5 : 1,
                display: 'flex',
                alignItems: 'baseline',
                gap: 0.5,
              }}
            >
              {count}
              {showPercentage && total && (
                <Typography
                  variant="caption"
                  sx={{
                    opacity: 0.8,
                    fontSize: compact ? '0.7rem' : '0.8rem',
                  }}
                >
                  ({percentage}%)
                </Typography>
              )}
            </Typography>

            {/* Action required indicator */}
            {config.requiresAction && count > 0 && !compact && (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.5,
                  opacity: 0.9,
                  fontStyle: 'italic',
                  fontSize: '0.7rem',
                }}
              >
                ⚠️ {config.actionLabel}
              </Typography>
            )}
          </Box>

          {/* Right side: Icon */}
          <IconComponent sx={{ fontSize: compact ? 32 : 40, opacity: 0.8 }} />
        </Box>

        {/* Progress bar (optional) */}
        {showPercentage && total && !compact && (
          <Box
            sx={{
              mt: 1.5,
              height: 4,
              borderRadius: 2,
              backgroundColor: alpha(config.textColor, 0.2),
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: `${percentage}%`,
                height: '100%',
                backgroundColor: config.textColor,
                transition: 'width 0.5s ease-in-out',
              }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default RoomStatusSummaryCard;
