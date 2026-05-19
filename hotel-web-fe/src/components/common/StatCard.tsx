import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
} from '@mui/material';
import type { CardProps, SxProps, Theme, TypographyProps } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

export interface StatCardTrend {
  value: number;
  label: string;
}

export interface StatCardProps extends Omit<CardProps, 'title' | 'color'> {
  title: React.ReactNode;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
  gradient?: string;
  appearance?: 'default' | 'gradient';
  titlePlacement?: 'top' | 'bottom';
  headerAlignItems?: 'flex-start' | 'center';
  iconBackground?: string;
  showPositiveTrendSign?: boolean;
  subtitleVariant?: TypographyProps['variant'];
  trend?: StatCardTrend;
  contentSx?: SxProps<Theme>;
  iconSx?: SxProps<Theme>;
  titleSx?: SxProps<Theme>;
  valueSx?: SxProps<Theme>;
  subtitleSx?: SxProps<Theme>;
}

const toSxArray = (sx?: SxProps<Theme>) => {
  if (!sx) {
    return [];
  }

  return Array.isArray(sx) ? sx : [sx];
};

export const StatCard = React.memo(function StatCard({
  title,
  value,
  subtitle,
  icon,
  color = 'primary.main',
  gradient,
  appearance = 'default',
  titlePlacement = 'top',
  headerAlignItems = 'flex-start',
  iconBackground,
  showPositiveTrendSign = false,
  subtitleVariant = 'body2',
  trend,
  contentSx,
  iconSx,
  titleSx,
  valueSx,
  subtitleSx,
  sx,
  ...cardProps
}: StatCardProps) {
  const isGradient = appearance === 'gradient';
  const cardBackground = gradient || `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`;
  const valueColor = color.includes('gradient') ? 'text.primary' : color;
  const defaultIconBackground = color.startsWith('#') ? `${color}15` : 'action.hover';
  const trendColor = trend && trend.value >= 0 ? 'success.main' : 'error.main';
  const trendValue = trend
    ? `${showPositiveTrendSign && trend.value >= 0 ? '+' : ''}${showPositiveTrendSign ? trend.value : Math.abs(trend.value)}%`
    : '';

  return (
    <Card
      {...cardProps}
      sx={[
        {
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          ...(isGradient && {
            background: cardBackground,
            color: 'white',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: -50,
              right: -50,
              width: 150,
              height: 150,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.1)',
            },
          }),
        },
        ...toSxArray(sx),
      ]}
    >
      <CardContent
        sx={[
          {
            position: isGradient ? 'relative' : undefined,
            zIndex: isGradient ? 1 : undefined,
          },
          ...toSxArray(contentSx),
        ]}
      >
        <Box display="flex" alignItems={headerAlignItems} justifyContent="space-between">
          <Box>
            {titlePlacement === 'top' && (
              <Typography
                color={isGradient ? undefined : 'text.secondary'}
                gutterBottom
                variant="body2"
                sx={[
                  {
                    color: isGradient ? 'rgba(255, 255, 255, 0.9)' : undefined,
                    fontWeight: isGradient ? 500 : undefined,
                  },
                  ...toSxArray(titleSx),
                ]}
              >
                {title}
              </Typography>
            )}
            <Typography
              variant="h4"
              component="div"
              sx={[
                {
                  fontWeight: isGradient ? 700 : 600,
                  color: isGradient ? 'white' : valueColor,
                  mb: 0.5,
                },
                ...toSxArray(valueSx),
              ]}
            >
              {value}
            </Typography>
            {titlePlacement === 'bottom' && (
              <Typography
                variant="body2"
                sx={[
                  {
                    color: isGradient ? 'rgba(255, 255, 255, 0.9)' : 'text.secondary',
                    fontWeight: isGradient ? 500 : undefined,
                  },
                  ...toSxArray(titleSx),
                ]}
              >
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography
                variant={subtitleVariant}
                color={isGradient ? undefined : 'text.secondary'}
                sx={[
                  {
                    color: isGradient ? 'rgba(255, 255, 255, 0.9)' : undefined,
                  },
                  ...toSxArray(subtitleSx),
                ]}
              >
                {subtitle}
              </Typography>
            )}
            {trend && (
              <Box display="flex" alignItems="center" mt={1}>
                <TrendingUpIcon
                  fontSize="small"
                  sx={{
                    color: trendColor,
                    mr: 0.5,
                    transform: trend.value < 0 ? 'rotate(180deg)' : 'none',
                  }}
                />
                <Typography variant="caption" sx={{ color: trendColor, fontWeight: 600 }}>
                  {trendValue} {trend.label}
                </Typography>
              </Box>
            )}
          </Box>
          {icon && (
            <Box
              sx={[
                {
                  background: isGradient ? 'rgba(255, 255, 255, 0.2)' : iconBackground || defaultIconBackground,
                  borderRadius: 2,
                  p: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isGradient ? 'white' : valueColor,
                  '& svg': { fontSize: isGradient ? 32 : 28 },
                },
                ...toSxArray(iconSx),
              ]}
            >
              {icon}
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
});

export default StatCard;
