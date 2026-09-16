import { Alert, Box, Button, Grid, Stack, Typography } from '@mui/material';
import { LogoLoader } from '../../../components';
import { useState } from 'react';
import { useNavigate } from '../../../router';
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation, type UseTranslationResult } from '../../../i18n';
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

/** Localizes the backend's `claim_unavailable_*` code; falls back to the
 *  server-supplied English reason for codes this build doesn't know. */
function claimUnavailableLabel(
  entry: GuestPromotion,
  t: UseTranslationResult['t'],
): string | null | undefined {
  switch (entry.claim_unavailable_code) {
    case 'insufficient_points':
      return t('offers.needPoints', { points: entry.claim_unavailable_points ?? 0 });
    case 'not_configured':
      return t('offers.notConfigured');
    default:
      return entry.claim_unavailable_reason;
  }
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
  const claimErrorRef = useAutoFocusError(claimMutation.error);

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
    return <LogoLoader variant="page" />;
  }

  if (error) {
    return (
      <Alert
        severity="error"
        role="alert"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() =>
              void (isPortal ? portalQuery.refetch() : publicQuery.refetch())
            }
          >
            {t('common:actions.retry')}
          </Button>
        }
      >
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
        <Alert severity="error" role="alert" ref={claimErrorRef} tabIndex={-1} onClose={() => claimMutation.reset()}>
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
              claimUnavailableReason={claimUnavailableLabel(entry, t)}
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
