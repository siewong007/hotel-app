import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import type { Promotion } from '../types';
import { formatPromotionDate, formatPromotionDiscount } from '../utils';

interface PromotionCardProps {
  promotion: Promotion;
  isPortal?: boolean;
  canClaim?: boolean;
  hasVoucher?: boolean;
  claimUnavailableReason?: string | null;
  isClaiming?: boolean;
  onClaim?: () => void;
  onSignIn?: () => void;
}

export function PromotionCard({
  promotion,
  isPortal = false,
  canClaim = false,
  hasVoucher = false,
  claimUnavailableReason,
  isClaiming = false,
  onClaim,
  onSignIn,
}: PromotionCardProps) {
  const claimEnd = formatPromotionDate(promotion.claim_ends_at);
  const stayStart = formatPromotionDate(promotion.stay_starts_on);
  const stayEnd = formatPromotionDate(promotion.stay_ends_on);

  return (
    <Card
      variant="outlined"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardContent sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            label={promotion.promotion_kind === 'voucher' ? 'Voucher' : 'Deal'}
            color={promotion.promotion_kind === 'voucher' ? 'secondary' : 'primary'}
            size="small"
          />
          {hasVoucher ? <Chip label="Claimed" color="success" size="small" /> : null}
        </Stack>

        <Typography variant="h6" component="h2" gutterBottom>
          {promotion.name}
        </Typography>
        <Typography
          variant="h4"
          sx={{
            color: "primary.main",
            mb: 1
          }}>
          {formatPromotionDiscount(promotion)}
        </Typography>
        {promotion.description ? (
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2
            }}>
            {promotion.description}
          </Typography>
        ) : null}

        <Divider sx={{ my: 1.5 }} />
        <Stack spacing={0.5}>
          {claimEnd ? (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              Claim by {claimEnd}
            </Typography>
          ) : null}
          {stayStart || stayEnd ? (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              Stay dates: {stayStart ?? 'Any time'} – {stayEnd ?? 'No end date'}
            </Typography>
          ) : null}
          {promotion.min_nights ? (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              Minimum stay: {promotion.min_nights} night{promotion.min_nights === 1 ? '' : 's'}
            </Typography>
          ) : null}
          {promotion.terms ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" sx={{
                fontWeight: 600
              }}>
                Terms
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: "block"
                }}>
                {promotion.terms}
              </Typography>
            </Box>
          ) : null}
        </Stack>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2 }}>
        {isPortal ? (
          <Stack spacing={0.5} sx={{ width: '100%' }}>
            <Button
              variant="contained"
              fullWidth
              disabled={!canClaim || hasVoucher || isClaiming}
              onClick={onClaim}
            >
              {isClaiming
                ? 'Redeeming…'
                : hasVoucher
                  ? 'Already claimed'
                  : promotion.slug === 'july-deluxe-20-loyalty'
                    ? 'Redeem 2,000 points'
                    : 'Claim deal'}
            </Button>
            {!canClaim && !hasVoucher && claimUnavailableReason ? (
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  textAlign: "center"
                }}>
                {claimUnavailableReason}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          <Button variant="contained" fullWidth onClick={onSignIn}>
            Sign in to claim
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
