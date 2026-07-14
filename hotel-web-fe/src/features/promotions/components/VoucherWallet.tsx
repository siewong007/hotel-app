import { Alert, Box, CircularProgress, Grid, Typography } from '@mui/material';
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
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (vouchersQuery.error) {
    return (
      <Alert severity="error">
        {getQueryErrorMessage(vouchersQuery.error, 'Unable to load your vouchers')}
      </Alert>
    );
  }

  const vouchers = vouchersQuery.data?.items ?? [];
  if (vouchers.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 7 }}>
        <Typography variant="h6">Your voucher wallet is empty</Typography>
        <Typography variant="body2" color="text.secondary">
          Claim an eligible deal and it will appear here.
        </Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {vouchers.map((voucher) => (
        <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={voucher.id}>
          <VoucherCard voucher={voucher} />
        </Grid>
      ))}
    </Grid>
  );
}
