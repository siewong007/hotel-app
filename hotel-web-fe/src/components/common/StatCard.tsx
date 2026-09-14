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
  // `appearance="gradient"` is a legacy flag kept for API compatibility — it
  // renders the standard surface now; full-bleed color washes are retired.
  const isGradient = appearance === 'gradient';
  const cardBackground = 'var(--hotel-surface-raised)';
  const valueColor = color.includes('gradient') ? 'text.primary' : color;
  const defaultIconBackground = color.startsWith('#')
    ? `${color}15`
    : `color-mix(in srgb, ${color} 8%, transparent)`;
  const trendColor = trend && trend.value >= 0 ? 'success.main' : 'error.main';
  const trendValue = trend
    ? `${showPositiveTrendSign && trend.value >= 0 ? '+' : ''}${showPositiveTrendSign ? trend.value : Math.abs(trend.value)}%`
    : '';

  const clickable = cardProps.onClick != null;
  return (
    <Card
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                cardProps.onClick?.(
                  event as unknown as React.MouseEvent<HTMLDivElement>,
                );
              }
            }
          : undefined
      }
      {...cardProps}
      sx={[
        {
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          ...(clickable && {
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
            },
          }),
          ...(isGradient && {
            background: cardBackground,
            borderColor: 'var(--hotel-border)',
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
        <Box
          sx={{
            display: "flex",
            alignItems: headerAlignItems,
            justifyContent: "space-between"
          }}>
          <Box>
            {titlePlacement === 'top' && (
              <Typography
                color="text.secondary"
                gutterBottom
                variant="body2"
                sx={[...toSxArray(titleSx)]}
              >
                {title}
              </Typography>
            )}
            <Typography
              variant="h4"
              component="div"
              sx={[
                {
                  fontWeight: 600,
                  color: valueColor,
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
                    color: 'text.secondary',
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
                color="text.secondary"
                sx={[...toSxArray(subtitleSx)]}
              >
                {subtitle}
              </Typography>
            )}
            {trend && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  mt: 1
                }}>
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
                  background: iconBackground || defaultIconBackground,
                  borderRadius: 2,
                  p: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: valueColor,
                  '& svg': { fontSize: 28 },
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
