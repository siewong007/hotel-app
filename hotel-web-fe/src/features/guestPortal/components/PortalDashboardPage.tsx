import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from '../../../router';
import {
  Box,
  Container,
  Paper,
  Typography,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert,
  CircularProgress,
  Button,
  Stack,
} from '@mui/material';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { PortalSupportTab } from './PortalSupportTab';
import { PromotionCatalog, VoucherWallet } from '../../promotions';
import PortalNotificationPreferences from '../../communications/components/PortalNotificationPreferences';
import { parseLocalDate } from '../../../utils/date';
import type {
  GuestPortalBenefitsResponse,
  GuestPortalBookingSummary,
  GuestPortalMembershipResponse,
  GuestPortalTransaction,
} from '../../../types';

function formatDisplayDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  try {
    return parseLocalDate(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function formatAmount(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return '-';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(value)) return String(amount);
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index} id={`portal-tabpanel-${index}`} aria-labelledby={`portal-tab-${index}`}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export const PortalDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    token,
    status: sessionStatus,
    error: sessionError,
    canRetry,
    needsLogin,
    retry,
    restartSignIn,
    signOut,
  } = usePortalSessionBootstrap();
  const [activeTab, setActiveTab] = useState(0);

  if (needsLogin) {
    return <Navigate to="/login?account=guest" replace />;
  }

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        {sessionError ? (
          <Alert
            severity="error"
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={canRetry ? retry : restartSignIn}
              >
                {canRetry ? 'Retry' : 'Sign in again'}
              </Button>
            )}
          >
            {sessionError}
          </Alert>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={24} />
            <Typography>
              {sessionStatus === 'checking-account'
                ? 'Checking your account session…'
                : 'Opening your guest portal…'}
            </Typography>
          </Box>
        )}
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 6 }}>
      <Paper elevation={2} sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
          <Typography variant="h4" component="h1">
            My Account
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => navigate('/portal/book')}>
              Book a Room
            </Button>
            <Button variant="outlined" onClick={signOut}>
              Sign Out
            </Button>
          </Stack>
        </Box>

        <Tabs
          value={activeTab}
          onChange={(_, next) => setActiveTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ mb: 2 }}
        >
          <Tab label="Bookings" id="portal-tab-0" aria-controls="portal-tabpanel-0" />
          <Tab label="Transactions" id="portal-tab-1" aria-controls="portal-tabpanel-1" />
          <Tab label="Membership" id="portal-tab-2" aria-controls="portal-tabpanel-2" />
          <Tab label="Benefits" id="portal-tab-3" aria-controls="portal-tabpanel-3" />
          <Tab label="Deals" id="portal-tab-4" aria-controls="portal-tabpanel-4" />
          <Tab label="My Vouchers" id="portal-tab-5" aria-controls="portal-tabpanel-5" />
          <Tab label="Support & Help" id="portal-tab-6" aria-controls="portal-tabpanel-6" />
          <Tab label="Preferences" id="portal-tab-7" aria-controls="portal-tabpanel-7" />
        </Tabs>

        <TabPanel value={activeTab} index={0}>
          <BookingsTab token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={1}>
          <TransactionsTab token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={2}>
          <MembershipTab token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={3}>
          <BenefitsTab token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={4}>
          <PromotionCatalog token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={5}>
          <VoucherWallet token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={6}>
          <PortalSupportTab token={token} />
        </TabPanel>
        <TabPanel value={activeTab} index={7}>
          <PortalNotificationPreferences />
        </TabPanel>
      </Paper>
    </Container>
  );
};

const BookingsTab: React.FC<{ token: string }> = ({ token }) => {
  const [items, setItems] = useState<GuestPortalBookingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await GuestPortalDashboardService.bookings(
        { page: page + 1, per_page: pageSize },
        token
      );
      setItems(response.items);
      setTotal(response.total);
    } catch {
      setError('Unable to load your bookings right now. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (items.length === 0) {
    return <EmptyState message="You have no bookings on file yet." />;
  }

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Booking #</TableCell>
            <TableCell>Check-In</TableCell>
            <TableCell>Check-Out</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((booking) => (
            <TableRow key={booking.booking_number}>
              <TableCell>{booking.booking_number}</TableCell>
              <TableCell>{formatDisplayDate(booking.check_in_date)}</TableCell>
              <TableCell>{formatDisplayDate(booking.check_out_date)}</TableCell>
              <TableCell>
                <Chip label={booking.status} size="small" />
              </TableCell>
              <TableCell align="right">{formatAmount(booking.total_amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={PAGE_SIZE_OPTIONS}
        onRowsPerPageChange={(event) => {
          setPageSize(parseInt(event.target.value, 10));
          setPage(0);
        }}
      />
    </TableContainer>
  );
};

const TransactionsTab: React.FC<{ token: string }> = ({ token }) => {
  const [items, setItems] = useState<GuestPortalTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await GuestPortalDashboardService.transactions(
        { page: page + 1, per_page: pageSize },
        token
      );
      setItems(response.items);
      setTotal(response.total);
    } catch {
      setError('Unable to load your transactions right now. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (items.length === 0) {
    return <EmptyState message="No transactions found." />;
  }

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Reference</TableCell>
            <TableCell>Booking #</TableCell>
            <TableCell>Method</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((tx, idx) => (
            <TableRow key={`${tx.kind}-${tx.reference ?? tx.invoice_number ?? idx}-${idx}`}>
              <TableCell>{formatDisplayDate(tx.date)}</TableCell>
              <TableCell>
                <Chip
                  label={tx.kind === 'payment' ? 'Payment' : 'Invoice'}
                  size="small"
                  color={tx.kind === 'payment' ? 'success' : 'default'}
                />
              </TableCell>
              <TableCell>{tx.invoice_number ?? tx.reference ?? '-'}</TableCell>
              <TableCell>{tx.booking_number ?? '-'}</TableCell>
              <TableCell>{tx.method ?? '-'}</TableCell>
              <TableCell>{tx.status ?? '-'}</TableCell>
              <TableCell align="right">{formatAmount(tx.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={pageSize}
        rowsPerPageOptions={PAGE_SIZE_OPTIONS}
        onRowsPerPageChange={(event) => {
          setPageSize(parseInt(event.target.value, 10));
          setPage(0);
        }}
      />
    </TableContainer>
  );
};

const MembershipTab: React.FC<{ token: string }> = ({ token }) => {
  const [data, setData] = useState<GuestPortalMembershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await GuestPortalDashboardService.membership(token);
        if (!cancelled) setData(response);
      } catch {
        if (!cancelled) setError('Unable to load your membership details right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!data || !data.membership) {
    return <EmptyState message="You are not enrolled in the loyalty program yet." />;
  }

  const { membership, recent_activity } = data;

  return (
    <Box>
      <Card sx={{ mb: 3, background: 'linear-gradient(135deg, #1976d2 0%, #0d47a1 100%)', color: 'white' }}>
        <CardContent>
          <Grid container spacing={3} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="overline">Member Number</Typography>
              <Typography variant="h5">{membership.member_number}</Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Tier: {membership.tier_name} (Level {membership.tier_level})
              </Typography>
              <Chip
                label={membership.status}
                size="small"
                sx={{ mt: 1, bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="overline">Points Balance</Typography>
              <Typography variant="h4">{membership.points_balance.toLocaleString()}</Typography>
              <Typography variant="body2">
                Lifetime Points: {membership.lifetime_points.toLocaleString()}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Typography variant="h6" gutterBottom>
        Recent Activity
      </Typography>
      {recent_activity.length === 0 ? (
        <EmptyState message="No recent point activity." />
      ) : (
        <List>
          {recent_activity.map((activity, idx) => (
            <React.Fragment key={`${activity.date}-${idx}`}>
              <ListItem>
                <ListItemText
                  primary={`${activity.transaction_type} — ${activity.points > 0 ? '+' : ''}${activity.points} points`}
                  secondary={`${formatDisplayDate(activity.date)} · Balance: ${activity.balance_after.toLocaleString()}`}
                />
              </ListItem>
              {idx < recent_activity.length - 1 && <Divider component="li" />}
            </React.Fragment>
          ))}
        </List>
      )}
    </Box>
  );
};

const BenefitsTab: React.FC<{ token: string }> = ({ token }) => {
  const [data, setData] = useState<GuestPortalBenefitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await GuestPortalDashboardService.benefits(token);
        if (!cancelled) setData(response);
      } catch {
        if (!cancelled) setError('Unable to load benefits right now.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const hasContent = useMemo(
    () => Boolean(data && (data.tier_benefits.length > 0 || data.rewards.length > 0)),
    [data]
  );

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!data || !hasContent) {
    return <EmptyState message="No benefits or rewards are available yet." />;
  }

  return (
    <Box>
      {data.tier_benefits.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Tier Benefits
          </Typography>
          <Grid container spacing={2}>
            {data.tier_benefits.map((benefit) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={benefit.tier_name}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1">{benefit.tier_name}</Typography>
                    <Typography variant="h5" color="primary">
                      {benefit.discount_percentage}% off
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {data.rewards.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            Rewards
          </Typography>
          <Grid container spacing={2}>
            {data.rewards.map((reward) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={reward.id}>
                <Card variant="outlined" sx={{ opacity: reward.affordable ? 1 : 0.6 }}>
                  <CardContent>
                    <Typography variant="subtitle1">{reward.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {reward.description}
                    </Typography>
                    <Chip label={reward.category} size="small" sx={{ mr: 1 }} />
                    <Chip
                      label={`${reward.points_required.toLocaleString()} pts`}
                      size="small"
                      color={reward.affordable ? 'success' : 'default'}
                    />
                    {!reward.affordable && (
                      <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
                        Not enough points yet
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
};

const LoadingState: React.FC = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
    <CircularProgress />
  </Box>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ textAlign: 'center', py: 6 }}>
    <Typography variant="body1" color="text.secondary">
      {message}
    </Typography>
  </Box>
);

export default PortalDashboardPage;
