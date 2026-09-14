import { Alert, Box, CircularProgress, Grid, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from '../../../router';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation } from '../../../i18n';
import {
  useClaimPromotion,
  useGuestPromotionCatalog,
  usePromotionCatalog,
} from '../hooks/usePromotionCatalog';
import type { GuestPromotion } from '../types';
import { PromotionCard } from './PromotionCard';

interface PromotionCatalogProps {
  token?: string;
}

function createClaimRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PromotionCatalog({ token }: PromotionCatalogProps) {
  const { t } = useTranslation('guestPortal');
  const navigate = useNavigate();
  const isPortal = Boolean(token);
  const publicQuery = usePromotionCatalog({ page: 1, page_size: 50 }, !isPortal);
  const portalQuery = useGuestPromotionCatalog(
    token,
    { page: 1, page_size: 50 },
    isPortal
  );
  const claimMutation = useClaimPromotion(token);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const entries: GuestPromotion[] = isPortal
    ? portalQuery.data?.items ?? []
    : (publicQuery.data?.items ?? []).map((promotion) => ({
        promotion,
        can_claim: false,
        has_voucher: false,
      }));
  const isLoading = isPortal ? portalQuery.isLoading : publicQuery.isLoading;
  const error = isPortal ? portalQuery.error : publicQuery.error;

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" role="alert">
        {guestErrorMessage(error, t('offers.loadFailed'))}
      </Alert>
    );
  }

  if (entries.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 7 }}>
        <Typography variant="h6">{t('offers.emptyTitle')}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {t('offers.emptyBody')}
        </Typography>
      </Box>
    );
  }

  const handleClaim = (entry: GuestPromotion) => {
    setSuccessMessage(null);
    claimMutation.reset();
    claimMutation.mutate(
      {
        promotionId: entry.promotion.id,
        input: { client_request_id: createClaimRequestId() },
      },
      {
        onSuccess: (voucher) => {
          setSuccessMessage(
            voucher.code
              ? t('offers.claimSuccessWithCode', { name: entry.promotion.name, code: voucher.code })
              : t('offers.claimSuccess', { name: entry.promotion.name })
          );
        },
      }
    );
  };

  return (
    <Stack spacing={2}>
      {successMessage ? (
        <Alert severity="success" role="alert" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      ) : null}
      {claimMutation.error ? (
        <Alert severity="error" role="alert" onClose={() => claimMutation.reset()}>
          {guestErrorMessage(claimMutation.error, t('offers.claimFailed'))}
        </Alert>
      ) : null}
      <Grid container spacing={2}>
        {entries.map((entry) => (
          <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={entry.promotion.id}>
            <PromotionCard
              promotion={entry.promotion}
              isPortal={isPortal}
              canClaim={entry.can_claim}
              hasVoucher={entry.has_voucher}
              claimUnavailableReason={entry.claim_unavailable_reason}
              isClaiming={
                claimMutation.isPending &&
                claimMutation.variables?.promotionId === entry.promotion.id
              }
              onClaim={() => handleClaim(entry)}
              onSignIn={() => navigate('/login')}
            />
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
