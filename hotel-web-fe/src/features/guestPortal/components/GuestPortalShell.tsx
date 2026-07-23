import { useEffect, useState, type ReactNode } from 'react';
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
} from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import HotelOutlinedIcon from '@mui/icons-material/HotelOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import { Link, useLocation } from '../../../router';
import { GuestPortalThemeProvider } from '../theme/GuestPortalThemeProvider';
import { getValidPortalToken, PORTAL_TOKEN_CHANGE_EVENT } from '../api/portalTokenStore';
import { GuestPortalNotificationBell } from './GuestPortalNotificationBell';

interface GuestPortalShellProps {
  children: ReactNode;
}

const FOREST = '#082B22';
const LINEN = '#F5F0E6';
const GOLD = '#C7A45B';

const DASHBOARD_LINK = '/guest-portal?section=overview';
const BOOKING_LINK = '/guest-portal?view=booking';
const HOTEL_INDEX_LINK = '/salim-inn/index.html?account=guest';

const desktopLinks = [
  { label: 'Home', section: 'overview', to: '/guest-portal?section=overview' },
  { label: 'Stays', section: 'stays', to: '/guest-portal?section=stays' },
  { label: 'Points history', section: 'points-history', to: '/guest-portal?section=points-history' },
  { label: 'Help', section: 'support', to: '/guest-portal?section=support' },
] as const;

const mobileLinks = [
  { label: 'Home', section: 'overview', to: '/guest-portal?section=overview', icon: <HomeOutlinedIcon /> },
  { label: 'Stays', section: 'stays', to: '/guest-portal?section=stays', icon: <HotelOutlinedIcon /> },
  { label: 'Book', section: 'booking', to: BOOKING_LINK, icon: <CalendarMonthOutlinedIcon /> },
  { label: 'Points history', section: 'points-history', to: '/guest-portal?section=points-history', icon: <HistoryOutlinedIcon /> },
  { label: 'Help', section: 'support', to: '/guest-portal?section=support', icon: <SupportAgentOutlinedIcon /> },
] as const;

type GuestSection = (typeof mobileLinks)[number]['section'];

function currentGuestSection(search: string): GuestSection {
  const params = new URLSearchParams(search);
  if (params.get('view') === 'booking') return 'booking';
  const section = params.get('section');
  if (section === 'stays' || section === 'payments') return 'stays';
  if (section === 'points-history' || section === 'rewards' || section === 'offers' || section === 'vouchers') return 'points-history';
  if (section === 'support') return 'support';
  return 'overview';
}

/** Guest-only navigation that preserves the existing portal route contract. */
export function GuestPortalShell({ children }: GuestPortalShellProps) {
  const location = useLocation();
  const [portalToken, setPortalToken] = useState<string | null>(() => getValidPortalToken());
  const activeSection = currentGuestSection(location.search);
  const mobileValue = mobileLinks.find((link) => link.section === activeSection)?.to ?? DASHBOARD_LINK;

  useEffect(() => {
    const syncPortalToken = () => setPortalToken(getValidPortalToken());
    window.addEventListener(PORTAL_TOKEN_CHANGE_EVENT, syncPortalToken);
    return () => window.removeEventListener(PORTAL_TOKEN_CHANGE_EVENT, syncPortalToken);
  }, []);

  return (
    <GuestPortalThemeProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: LINEN, color: 'text.primary', pb: { xs: 10, md: 0 } }}>
        <Box
          component="a"
          href="#guest-portal-main"
          sx={{
            position: 'fixed',
            top: 8,
            left: 8,
            zIndex: (theme) => theme.zIndex.modal + 1,
            px: 2,
            py: 1,
            borderRadius: 1,
            bgcolor: '#FFFCF6',
            color: FOREST,
            fontWeight: 800,
            textDecoration: 'none',
            transform: 'translateY(-160%)',
            transition: 'transform 200ms ease',
            '&:focus-visible': { transform: 'translateY(0)' },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          Skip to content
        </Box>
        <AppBar
          component="header"
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: FOREST,
            borderBottom: '1px solid rgba(199, 164, 91, 0.34)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <Container maxWidth="xl" disableGutters>
            <Toolbar sx={{ minHeight: { xs: 64, md: 76 }, px: { xs: 2, sm: 3, lg: 4 }, gap: { xs: 1.5, md: 4 } }}>
              <Box
                component={Link}
                to={DASHBOARD_LINK}
                aria-label="Salim Inn guest portal home"
                sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, textDecoration: 'none' }}
              >
                <Box component="img" src="/salim-inn/salim-inn-logo.svg" alt="Salim Inn" sx={{ display: 'block', width: { xs: 122, sm: 146 }, height: 'auto' }} />
              </Box>

              <Stack component="nav" aria-label="Guest portal" direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, ml: 'auto' }}>
                {desktopLinks.map(link => (
                  <Button
                    key={link.label}
                    component={Link}
                    to={link.to}
                    color="inherit"
                    aria-current={activeSection === link.section ? 'page' : undefined}
                    sx={{
                      minHeight: 44,
                      px: 1.5,
                      color: activeSection === link.section ? '#FFFFFF' : 'rgba(255,255,255,0.78)',
                      fontSize: '0.8125rem',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.09)', color: '#FFFFFF', transform: 'translateY(-1px)' },
                      '&:focus-visible': { outline: `3px solid ${GOLD}`, outlineOffset: 3 },
                    }}
                  >
                    {link.label}
                  </Button>
                ))}
                <Button component="a" href={HOTEL_INDEX_LINK} color="inherit" sx={{ minHeight: 44, px: 1.5, color: 'rgba(255,255,255,0.72)', fontSize: '0.8125rem', '&:hover': { bgcolor: 'rgba(255,255,255,0.09)', color: '#FFFFFF', transform: 'translateY(-1px)' } }}>
                  Explore hotel
                </Button>
              </Stack>

              <GuestPortalNotificationBell
                token={portalToken}
              />

              <Button
                component={Link}
                to={BOOKING_LINK}
                variant="contained"
                aria-current={activeSection === 'booking' ? 'page' : undefined}
                disableElevation
                sx={{
                  ml: { xs: 'auto', md: 0 },
                  minHeight: 44,
                  px: { xs: 1.5, sm: 2 },
                  bgcolor: GOLD,
                  color: '#1E2119',
                  fontSize: { xs: '0.75rem', sm: '0.8125rem' },
                  whiteSpace: 'nowrap',
                  '&:hover': { bgcolor: '#D8B76F', transform: 'translateY(-1px)' },
                  '&:focus-visible': { outline: '3px solid #FFFFFF', outlineOffset: 3 },
                }}
              >
                <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Book</Box>
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Book a stay</Box>
              </Button>
            </Toolbar>
          </Container>
        </AppBar>

        <Box id="guest-portal-main" component="main" tabIndex={-1} sx={{ animation: 'guest-portal-enter 220ms ease-out both', '@media (prefers-reduced-motion: reduce)': { animation: 'none' }, '@keyframes guest-portal-enter': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
          {children}
        </Box>

        <Box component="nav" aria-label="Guest portal mobile navigation" sx={{ display: { xs: 'block', md: 'none' }, position: 'fixed', inset: 'auto 0 0', zIndex: theme => theme.zIndex.appBar, px: 1, pb: 'max(8px, env(safe-area-inset-bottom))', pt: 1, bgcolor: 'rgba(245,240,230,0.94)', backdropFilter: 'blur(14px)', borderTop: '1px solid rgba(23,33,29,0.12)' }}>
          <BottomNavigation showLabels value={mobileValue} sx={{ height: 64, borderRadius: 2, bgcolor: '#FFFCF6', boxShadow: '0 8px 24px rgba(24,35,29,0.12)', overflow: 'hidden', '& .MuiBottomNavigationAction-root': { minWidth: 0, maxWidth: 'none', color: '#56625B', transition: 'color 200ms ease, transform 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }, '& .MuiBottomNavigationAction-root.Mui-selected': { color: FOREST }, '& .MuiBottomNavigationAction-label': { fontSize: '0.625rem', fontWeight: 700, mt: 0.25 }, '& .MuiBottomNavigationAction-label.Mui-selected': { fontSize: '0.625rem' } }}>
            {mobileLinks.map(link => (
              <BottomNavigationAction key={link.label} component={Link} to={link.to} value={link.to} label={link.label} icon={link.icon} aria-current={activeSection === link.section ? 'page' : undefined} />
            ))}
          </BottomNavigation>
        </Box>
      </Box>
    </GuestPortalThemeProvider>
  );
}
