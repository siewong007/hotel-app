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
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { useVoucherWallet } from '../hooks/useVoucherWallet';
import { VoucherCard } from './VoucherCard';

interface VoucherWalletProps {
  token: string;
}

export function VoucherWallet({ token }: VoucherWalletProps) {
  const vouchersQuery = useVoucherWallet(token, { page: 1, page_size: 50 });

  if (vouchersQuery.isLoading) {
    return (
      <Stack spacing={2} aria-label="Loading vouchers">
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
        action={
          <Button color="inherit" size="small" onClick={() => void vouchersQuery.refetch()}>
            Try again
          </Button>
        }
      >
        {getQueryErrorMessage(vouchersQuery.error, 'Unable to load your vouchers')}
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
          Your voucher wallet is empty
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.75
          }}>
          Claim an eligible offer and your voucher will appear here, ready for your next stay.
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
              ? `${readyCount} voucher${readyCount === 1 ? '' : 's'} ready to use`
              : 'Your saved vouchers'}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            Copy a code now, or choose the voucher when you book.
          </Typography>
        </Box>
        <Chip
          label={`${vouchers.length} total`}
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
