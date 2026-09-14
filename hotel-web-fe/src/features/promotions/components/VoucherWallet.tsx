import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation } from '../../../i18n';
import { useVoucherWallet } from '../hooks/useVoucherWallet';
import { VoucherCard } from './VoucherCard';

interface VoucherWalletProps {
  token: string;
}

export function VoucherWallet({ token }: VoucherWalletProps) {
  const { t } = useTranslation('guestPortal');
  const vouchersQuery = useVoucherWallet(token, { page: 1, page_size: 50 });

  if (vouchersQuery.isLoading) {
    return (
      <Stack spacing={2} aria-label={t('vouchers.loadingAria')}>
        <Skeleton variant="rounded" height={40} sx={{ maxWidth: 280 }} />
        <Skeleton variant="rounded" height={250} sx={{ borderRadius: 3 }} />
        <Skeleton variant="rounded" height={250} sx={{ borderRadius: 3 }} />
      </Stack>
    );
  }

  if (vouchersQuery.error) {
    return (
      <Alert
        severity="error"
        role="alert"
        action={
          <Button color="inherit" size="small" onClick={() => void vouchersQuery.refetch()}>
            {t('common:actions.retry')}
          </Button>
        }
      >
        {guestErrorMessage(vouchersQuery.error, t('vouchers.loadFailed'))}
      </Alert>
    );
  }

  const vouchers = vouchersQuery.data?.items ?? [];
  if (vouchers.length === 0) {
    return (
      <Box
        sx={{
          textAlign: 'center',
          py: { xs: 6, sm: 8 },
          px: 3,
          border: '1px dashed var(--hotel-border-strong)',
          borderRadius: 3,
          backgroundColor: 'var(--hotel-surface-sunken)',
        }}
      >
        <Box
          sx={{
            width: 54,
            height: 54,
            mx: 'auto',
            mb: 2,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--hotel-primary-text)',
            backgroundColor: 'var(--hotel-primary-subtle)',
          }}
        >
          <ConfirmationNumberOutlinedIcon />
        </Box>
        <Typography variant="h6" sx={{ color: 'var(--hotel-text)', fontWeight: 750 }}>
          {t('vouchers.emptyTitle')}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.75
          }}>
          {t('vouchers.emptyBody')}
        </Typography>
      </Box>
    );
  }

  const readyCount = vouchers.filter(
    (voucher) =>
      voucher.status === 'available' &&
      (!voucher.expires_at || new Date(voucher.expires_at).getTime() >= Date.now())
  ).length;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: "space-between",
          mb: 2.5
        }}>
        <Box>
          <Typography sx={{ color: 'var(--hotel-text)', fontWeight: 750 }}>
            {readyCount > 0
              ? t('vouchers.ready', { count: readyCount })
              : t('vouchers.savedTitle')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('vouchers.subtitle')}
          </Typography>
        </Box>
        <Chip
          label={t('vouchers.totalCount', { count: vouchers.length })}
          size="small"
          variant="outlined"
          sx={{ borderColor: 'var(--hotel-border-strong)', color: 'var(--hotel-text-secondary)', fontWeight: 700 }}
        />
      </Stack>
      <Stack spacing={2.25}>
        {vouchers.map((voucher) => (
          <VoucherCard voucher={voucher} key={voucher.id} />
        ))}
      </Stack>
    </Box>
  );
}
