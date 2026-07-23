import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from '../../../router';
import { Alert, Box, Button, Container, CircularProgress, Fade, Paper, Stack, Typography } from '@mui/material';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { BookingsSection, EmbeddedSection, OverviewSection, PointsHistorySection } from './dashboard/PortalDashboardSections';
import { PortalSupportWidget } from './PortalSupportWidget';
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
  const [supportOpen, setSupportOpen] = useState(false);
  // Support is a floating panel rather than a page: any link to ?section=support
  // (top nav "Help", mobile nav, deep links) opens the widget, and the page behind
  // falls back to the overview instead of rendering the section inline.
  const displaySection: PortalSection = activeSection === 'support' ? 'overview' : activeSection;
  const changeSection = (section: PortalSection) => {
    const params = new URLSearchParams(location.search);
    params.set('section', section);
    navigate(`/guest-portal?${params.toString()}`);
  };

  useEffect(() => {
    // Opening support is a deep-link (?section=support). Navigating to any other
    // section (e.g. Payments) closes the panel, so it never stays stuck over the
    // new page — which in Safari reads as a hang, especially on the full-screen
    // mobile sheet.
    setSupportOpen(activeSection === 'support');
  }, [activeSection]);

  const handleSupportOpenChange = (next: boolean) => {
    setSupportOpen(next);
    // Clear the support deep-link on close so the widget doesn't immediately reopen.
    if (!next && activeSection === 'support') changeSection('overview');
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
              ['overview', 'Overview', CalendarMonthOutlinedIcon], ['stays', 'My stays', CalendarMonthOutlinedIcon], ['points-history', 'Points history', HistoryOutlinedIcon], ['offers', 'Offers', LocalOfferOutlinedIcon], ['vouchers', 'Vouchers', ConfirmationNumberOutlinedIcon], ['support', 'Support', SupportAgentOutlinedIcon], ['preferences', 'Preferences', TuneOutlinedIcon],
            ].map(([value, label, Icon]) => { const isSupport = value === 'support'; const isActive = isSupport ? supportOpen : displaySection === value; const SectionIcon = Icon as typeof CalendarMonthOutlinedIcon; return <Button key={value as string} startIcon={<SectionIcon />} onClick={() => (isSupport ? setSupportOpen(true) : changeSection(value as PortalSection))} aria-current={isActive ? 'page' : undefined} sx={{ flexShrink: 0, color: isActive ? '#06110e' : 'text.secondary', bgcolor: isActive ? 'rgba(217,181,114,.35)' : 'transparent', fontWeight: isActive ? 700 : 500, '&:hover': { bgcolor: 'rgba(217,181,114,.22)' } }}>{label as string}</Button>; })}
          </Box>
        </Box>
        <Fade in key={displaySection} timeout={220}><Box component="section" aria-live="polite" sx={{ p: { xs: 2.5, sm: 4 } }}>
          {displaySection === 'overview' ? (
            <OverviewSection
              token={token}
              onSectionChange={changeSection}
              onBook={() => navigate('/guest-portal?view=booking')}
            />
          ) : null}
          {displaySection === 'stays' ? <BookingsSection token={token} /> : null}
          {displaySection === 'points-history' ? <PointsHistorySection token={token} /> : null}
          {['offers', 'vouchers', 'preferences'].includes(displaySection) ? <EmbeddedSection section={displaySection} token={token} /> : null}
        </Box></Fade>
      </Paper>
      <PortalSupportWidget token={token} open={supportOpen} onOpenChange={handleSupportOpenChange} />
    </Container>
  );
};

export default PortalDashboardPage;
