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
          border: '1px dashed rgba(6, 35, 27, 0.2)',
          borderRadius: 3,
          backgroundColor: 'rgba(251, 245, 233, 0.65)',
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
            color: '#8b692e',
            backgroundColor: '#f2e6ce',
          }}
        >
          <ConfirmationNumberOutlinedIcon />
        </Box>
        <Typography variant="h6" sx={{ color: '#061b15', fontWeight: 750 }}>
          Your voucher wallet is empty
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
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
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography sx={{ color: '#061b15', fontWeight: 750 }}>
            {readyCount > 0
              ? `${readyCount} voucher${readyCount === 1 ? '' : 's'} ready to use`
              : 'Your saved vouchers'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Copy a code now, or choose the voucher when you book.
          </Typography>
        </Box>
        <Chip
          label={`${vouchers.length} total`}
          size="small"
          variant="outlined"
          sx={{ borderColor: 'rgba(6, 35, 27, 0.18)', color: '#3f514b', fontWeight: 700 }}
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
