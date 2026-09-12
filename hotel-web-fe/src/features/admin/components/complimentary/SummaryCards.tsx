import React from 'react';
import { Box, Card, CardContent, Grid, Typography } from '@mui/material';
import {
  Hotel as HotelIcon,
  NightsStay as NightsIcon,
  Person as PersonIcon,
  AttachMoney as MoneyIcon,
} from '@mui/icons-material';
import { useCurrency } from '../../../../hooks/useCurrency';
import type { ComplimentarySummary } from './types';

interface SummaryCardsProps {
  summary: ComplimentarySummary;
}

const SummaryCards: React.FC<SummaryCardsProps> = ({ summary }) => {
  const { format: formatCurrency } = useCurrency();

  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <Card>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 1
              }}>
              <HotelIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="subtitle2" sx={{
                color: "text.secondary"
              }}>
                Complimentary Bookings
              </Typography>
            </Box>
            <Typography variant="h4" color="primary">
              {summary.total_complimentary_bookings}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <Card>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 1
              }}>
              <NightsIcon color="secondary" sx={{ mr: 1 }} />
              <Typography variant="subtitle2" sx={{
                color: "text.secondary"
              }}>
                Total Nights Given
              </Typography>
            </Box>
            <Typography variant="h4" color="secondary">
              {summary.total_complimentary_nights}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <Card>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 1
              }}>
              <PersonIcon color="info" sx={{ mr: 1 }} />
              <Typography variant="subtitle2" sx={{
                color: "text.secondary"
              }}>
                Credits Available
              </Typography>
            </Box>
            <Typography variant="h4" sx={{
              color: "info.main"
            }}>
              {summary.total_credits_available}
            </Typography>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              (room-type specific credits)
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <Card>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 1
              }}>
              <MoneyIcon color="success" sx={{ mr: 1 }} />
              <Typography variant="subtitle2" sx={{
                color: "text.secondary"
              }}>
                Value Given
              </Typography>
            </Box>
            <Typography variant="h4" sx={{
              color: "success.main"
            }}>
              {formatCurrency(parseFloat(summary.value_of_complimentary_nights) || 0)}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};

export default SummaryCards;
