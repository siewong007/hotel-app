import React from 'react';
import { Navigate, useLocation, useNavigate } from '../../../router';
import { Alert, Box, Button, Container, CircularProgress, Fade, Paper, Stack, Typography } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import DiamondOutlinedIcon from '@mui/icons-material/DiamondOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { BookingsSection, EmbeddedSection, OverviewSection, PaymentsSection, RewardsSection } from './dashboard/PortalDashboardSections';
import { parsePortalSection, type PortalSection } from './dashboard/dashboardUtils';

export const PortalDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    token,
    status: sessionStatus,
    error: sessionError,
    canRetry,
    needsLogin,
    isStaffAccount,
    retry,
    restartSignIn,
    signOut,
  } = usePortalSessionBootstrap();
  // Staff accounts belong in the admin portal, not the guest portal.
  if (isStaffAccount) {
    return <Navigate to="/admin-portal" replace />;
  }

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

  return <AuthenticatedDashboard token={token} navigate={navigate} signOut={signOut} />;
};

const AuthenticatedDashboard: React.FC<{
  token: string;
  navigate: ReturnType<typeof useNavigate>;
  signOut: () => void;
}> = ({ token, navigate, signOut }) => {
  const location = useLocation();
  const activeSection = parsePortalSection(location.search);
  const changeSection = (section: PortalSection) => {
    const params = new URLSearchParams(location.search);
    params.set('section', section);
    navigate(`/guest-portal?${params.toString()}`);
  };

  return (
    <Container maxWidth="lg" sx={{ mt: { xs: 2, sm: 4 }, mb: 7, px: { xs: 2, sm: 3 } }}>
      <Paper elevation={0} sx={{ overflow: 'hidden', border: '1px solid rgba(6,17,14,.12)', borderRadius: 3 }}>
        <Box sx={{ p: { xs: 2.5, sm: 4 }, bgcolor: '#fffdf9', borderBottom: '1px solid rgba(6,17,14,.1)' }}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 2 }}>
          <Box><Typography variant="overline" sx={{ color: '#8d6b30', fontWeight: 700, letterSpacing: '.12em' }}>Salim Inn</Typography><Typography variant="h4" component="h1" sx={{ color: '#06110e', fontWeight: 700 }}>My stay</Typography></Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="contained" onClick={() => navigate('/guest-portal?view=booking')} sx={{ width: { xs: '100%', sm: 'auto' }, bgcolor: '#d9b572', color: '#06110e', fontWeight: 700, '&:hover': { bgcolor: '#e4c487' } }}>
              Book a stay
            </Button>
            <Button variant="outlined" onClick={signOut} sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Sign Out
            </Button>
          </Stack>
          </Box>
          <Box
            component="nav"
            aria-label="Guest portal sections"
            sx={{
              display: 'flex',
              gap: 0.5,
              overflowX: 'auto',
              mt: 3,
              pb: 0.5,
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {[
              ['overview', 'Overview', CalendarMonthOutlinedIcon], ['stays', 'My stays', CalendarMonthOutlinedIcon], ['payments', 'Payments', CreditCardOutlinedIcon], ['rewards', 'Rewards', DiamondOutlinedIcon], ['offers', 'Offers', LocalOfferOutlinedIcon], ['vouchers', 'Vouchers', ConfirmationNumberOutlinedIcon], ['support', 'Support', SupportAgentOutlinedIcon], ['preferences', 'Preferences', TuneOutlinedIcon],
            ].map(([value, label, Icon]) => { const isActive = activeSection === value; const SectionIcon = Icon as typeof CalendarMonthOutlinedIcon; return <Button key={value as string} startIcon={<SectionIcon />} onClick={() => changeSection(value as PortalSection)} aria-current={isActive ? 'page' : undefined} sx={{ flexShrink: 0, color: isActive ? '#06110e' : 'text.secondary', bgcolor: isActive ? 'rgba(217,181,114,.35)' : 'transparent', fontWeight: isActive ? 700 : 500, '&:hover': { bgcolor: 'rgba(217,181,114,.22)' } }}>{label as string}</Button>; })}
          </Box>
        </Box>
        <Fade in key={activeSection} timeout={220}><Box component="section" aria-live="polite" sx={{ p: { xs: 2.5, sm: 4 } }}>
          {activeSection === 'overview' ? (
            <OverviewSection
              token={token}
              onSectionChange={changeSection}
              onBook={() => navigate('/guest-portal?view=booking')}
            />
          ) : null}
          {activeSection === 'stays' ? <BookingsSection token={token} /> : null}
          {activeSection === 'payments' ? <PaymentsSection token={token} /> : null}
          {activeSection === 'rewards' ? <RewardsSection token={token} /> : null}
          {['offers', 'vouchers', 'support', 'preferences'].includes(activeSection) ? <EmbeddedSection section={activeSection} token={token} /> : null}
        </Box></Fade>
      </Paper>
    </Container>
  );
};

export default PortalDashboardPage;
