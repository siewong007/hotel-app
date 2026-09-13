import React from 'react';
import { Box, Card, CardContent, Grid, Typography, alpha } from '@mui/material';
import {
  EventAvailable as BookIcon,
  ArrowForward as ArrowForwardIcon,
  ArrowBack as ArrowBackIcon,
  Payment as PaymentIcon,
  Receipt as ReceiptIcon,
  Bed as BedIcon,
} from '@mui/icons-material';
import { useCurrency } from '../../../../hooks/useCurrency';
import { isPositiveMoney } from '../../../../utils/money';
import type { BookingView, SummaryStatCard } from '../../utils/bookingPageUtils';

export interface BookingSummaryStats {
  arrivingCount: number;
  readyToCheckInCount: number;
  todayCheckIns: number;
  totalGuestsInHouse: number;
  inHouseCount: number;
  roomCount: number;
  departingCount: number;
  upcomingCount: number;
  normalOutstandingDue: number;
  normalDueCount: number;
  normalBalanceScope: string;
  companyOutstandingDue: number;
  companyDueCount: number;
  companyBalanceScope: string;
}

interface BookingSummarySectionProps {
  stats: BookingSummaryStats;
  activeView: BookingView;
  onSelectView: (view: BookingView) => void;
  onTakePayment: () => void;
}

const BookingSummarySection: React.FC<BookingSummarySectionProps> = ({
  stats,
  activeView,
  onSelectView,
  onTakePayment,
}) => {
  const { format: formatCurrency } = useCurrency();

  const summaryStatCards: SummaryStatCard[] = [
    {
      title: 'Arrivals / Check-in',
      value: stats.arrivingCount,
      detail: `${stats.readyToCheckInCount} ready to check in`,
      subValue: stats.arrivingCount || stats.todayCheckIns || 1,
      color: '#2f6f52',
      icon: <ArrowForwardIcon fontSize="small" />,
      view: 'arriving',
    },
    {
      title: 'In-house guests',
      value: stats.totalGuestsInHouse,
      detail: `across ${stats.inHouseCount} rooms`,
      subValue: Math.max(stats.totalGuestsInHouse, stats.roomCount || 1),
      color: '#2f64b3',
      icon: <BedIcon fontSize="small" />,
      view: 'in_house',
    },
    {
      title: 'Departures / Check-out',
      value: stats.departingCount,
      detail: `${stats.departingCount} ready to check out`,
      subValue: stats.departingCount || 1,
      color: '#c47b1e',
      icon: <ArrowBackIcon fontSize="small" />,
      view: 'departing',
    },
    {
      title: 'Upcoming bookings',
      value: stats.upcomingCount,
      detail: `${stats.upcomingCount} future reservations`,
      subValue: stats.upcomingCount || 1,
      color: '#7c4dff',
      icon: <BookIcon fontSize="small" />,
      view: 'upcoming',
    },
    ...(isPositiveMoney(stats.normalOutstandingDue)
      ? [{
        title: 'Normal outstanding',
        value: formatCurrency(stats.normalOutstandingDue),
        detail: `${stats.normalDueCount} ${stats.normalBalanceScope}`,
        color: '#c43d32',
        icon: <PaymentIcon fontSize="small" />,
        view: 'normal_balance' as BookingView,
        alert: true,
      }]
      : []),
    ...(isPositiveMoney(stats.companyOutstandingDue)
      ? [{
        title: 'Company outstanding',
        value: formatCurrency(stats.companyOutstandingDue),
        detail: `${stats.companyDueCount} ${stats.companyBalanceScope}`,
        color: '#8f3d5f',
        icon: <ReceiptIcon fontSize="small" />,
        view: 'company_balance' as BookingView,
        alert: true,
      }]
      : []),
  ];
  const summaryGridColumns = Math.max(1, Math.min(summaryStatCards.length, 6));

  return (
    <>
      {/* On phones the strip scrolls horizontally so the booking list — the
          actionable content — is not buried under six stacked stat cards. */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 2.5,
          gridTemplateColumns: {
            xs: `repeat(${summaryStatCards.length}, minmax(230px, 1fr))`,
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
            lg: `repeat(${summaryGridColumns}, minmax(0, 1fr))`,
          },
          overflowX: { xs: 'auto', sm: 'visible' },
          scrollSnapType: { xs: 'x proximity', sm: 'none' },
          pb: { xs: 1, sm: 0 },
        }}
      >
        {summaryStatCards.map((stat) => (
          <Card
            key={stat.title}
            elevation={0}
            onClick={() => onSelectView(stat.view)}
            sx={{
              height: '100%',
              cursor: 'pointer',
              scrollSnapAlign: 'start',
              borderLeft: stat.alert ? `4px solid ${stat.color}` : '1px solid',
              borderColor: stat.alert ? stat.color : 'divider',
              bgcolor: activeView === stat.view ? alpha(stat.color, 0.08) : 'background.paper',
            }}
          >
            <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 800, color: 'text.secondary' }}>{stat.title}</Typography>
                <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: alpha(stat.color, 0.12), color: stat.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {stat.icon}
                </Box>
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 900, color: 'text.primary', lineHeight: 1 }}>
                {stat.value}
                {stat.subValue != null && typeof stat.value === 'number' && (
                  <Typography component="span" variant="h6" sx={{
                    color: "text.secondary"
                  }}>/{stat.subValue}</Typography>
                )}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{stat.detail}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
      {isPositiveMoney(stats.normalOutstandingDue) && (
        <Grid container spacing={2} sx={{
          mb: 2.5
        }}>
          <Grid size={{ xs: 12 }}>
            <Card
              elevation={0}
              onClick={onTakePayment}
              // Use `&.MuiCard-root` to match the specificity of the global
              // `.hotel-board-skin .MuiCard-root` theme rule; without this the
              // primary background gets overridden back to plain paper white.
              sx={{
                cursor: 'pointer',
                color: 'white',
                '&.MuiCard-root': {
                  bgcolor: '#c43d32',
                  borderColor: '#c43d32',
                },
              }}
            >
              <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.18)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PaymentIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, lineHeight: 1.1, color: 'inherit' }}>Take payment</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)' }}>
                    {formatCurrency(stats.normalOutstandingDue)} normal outstanding
                  </Typography>
                </Box>
                <ArrowForwardIcon sx={{ color: 'white' }} />
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </>
  );
};

export default BookingSummarySection;
