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
import { useTranslation } from '../../../i18n';
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
  const { t } = useTranslation('guestPortal');
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
            label={promotion.promotion_kind === 'voucher' ? t('offers.kind.voucher') : t('offers.kind.deal')}
            color={promotion.promotion_kind === 'voucher' ? 'secondary' : 'primary'}
            size="small"
          />
          {hasVoucher ? <Chip label={t('offers.claimed')} color="success" size="small" /> : null}
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
          {formatPromotionDiscount(promotion, t)}
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
              {t('offers.claimBy', { date: claimEnd })}
            </Typography>
          ) : null}
          {stayStart || stayEnd ? (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('offers.stayDates', {
                start: stayStart ?? t('offers.anyTime'),
                end: stayEnd ?? t('offers.noEndDate'),
              })}
            </Typography>
          ) : null}
          {promotion.min_nights ? (
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('offers.minNights', { count: promotion.min_nights })}
            </Typography>
          ) : null}
          {promotion.terms ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" sx={{
                fontWeight: 600
              }}>
                {t('offers.terms')}
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
                ? t('offers.redeeming')
                : hasVoucher
                  ? t('offers.alreadyClaimed')
                  : promotion.slug === 'july-deluxe-20-loyalty'
                    ? t('offers.redeemPoints')
                    : t('offers.claimDeal')}
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
            {t('offers.signInToClaim')}
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
