import { useEffect, useState, type ReactNode } from 'react';
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import HotelOutlinedIcon from '@mui/icons-material/HotelOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined';
import { Link, useLocation, useNavigate } from '../../../router';
import { GuestPortalThemeProvider } from '../theme/GuestPortalThemeProvider';
import { getValidPortalToken, PORTAL_TOKEN_CHANGE_EVENT } from '../api/portalTokenStore';
import { GuestPortalNotificationBell } from './GuestPortalNotificationBell';
import { PortalSupportWidget } from './PortalSupportWidget';
import { getHotelSettings } from '../../../utils/hotelSettings';

interface GuestPortalShellProps {
  children: ReactNode;
}

const FOREST = '#082B22';
const LINEN = '#F5F0E6';
const GOLD = '#C7A45B';

const DASHBOARD_LINK = '/guest-portal?section=overview';
const BOOKING_LINK = '/guest-portal?view=booking';
const HOTEL_INDEX_LINK = '/salim-inn/index.html?account=guest';
const MORE_VALUE = 'more';

// The shell owns the ONLY navigation in the guest portal: a top bar on web, a
// bottom bar on phones. Pages must not render their own section switcher.
// `primary` items are the phone bottom-bar slots; `secondary` items stay inline
// on web and move into the phone "More" sheet.
const primarySections = [
  { label: 'Home', section: 'overview', to: DASHBOARD_LINK, icon: <HomeOutlinedIcon /> },
  { label: 'Stays', section: 'stays', to: '/guest-portal?section=stays', icon: <HotelOutlinedIcon /> },
  { label: 'Points', section: 'points-history', to: '/guest-portal?section=points-history', icon: <HistoryOutlinedIcon /> },
] as const;

const secondarySections = [
  { label: 'Offers', section: 'offers', to: '/guest-portal?section=offers', icon: <LocalOfferOutlinedIcon /> },
  { label: 'Vouchers', section: 'vouchers', to: '/guest-portal?section=vouchers', icon: <ConfirmationNumberOutlinedIcon /> },
  { label: 'Free nights', section: 'credits', to: '/guest-portal?section=credits', icon: <CardGiftcardOutlinedIcon /> },
  { label: 'Preferences', section: 'preferences', to: '/guest-portal?section=preferences', icon: <TuneOutlinedIcon /> },
] as const;

type GuestSection =
  | (typeof primarySections)[number]['section']
  | (typeof secondarySections)[number]['section']
  | 'support'
  | 'booking';

function currentGuestSection(search: string): GuestSection {
  const params = new URLSearchParams(search);
  if (params.get('view') === 'booking') return 'booking';
  switch (params.get('section')) {
    case 'stays':
    case 'payments':
      return 'stays';
    case 'points-history':
    case 'rewards':
      return 'points-history';
    case 'offers':
      return 'offers';
    case 'vouchers':
      return 'vouchers';
    case 'credits':
      return 'credits';
    case 'preferences':
      return 'preferences';
    case 'support':
      return 'support';
    default:
      return 'overview';
  }
}

/** Guest-only navigation that preserves the existing portal route contract. */
export function GuestPortalShell({ children }: GuestPortalShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const hotelName = getHotelSettings().hotel_name;
  const [portalToken, setPortalToken] = useState<string | null>(() => getValidPortalToken());
  const [moreOpen, setMoreOpen] = useState(false);
  const activeSection = currentGuestSection(location.search);
  const isSecondaryActive = secondarySections.some((link) => link.section === activeSection);
  const mobileValue = activeSection === 'booking'
    ? BOOKING_LINK
    : isSecondaryActive
      ? MORE_VALUE
      : primarySections.find((link) => link.section === activeSection)?.to ?? DASHBOARD_LINK;

  useEffect(() => {
    const syncPortalToken = () => setPortalToken(getValidPortalToken());
    window.addEventListener(PORTAL_TOKEN_CHANGE_EVENT, syncPortalToken);
    return () => window.removeEventListener(PORTAL_TOKEN_CHANGE_EVENT, syncPortalToken);
  }, []);

  // Any navigation closes the phone "More" sheet, so it never covers the page
  // the guest just opened.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.search, location.pathname]);

  // Support has a single entry point everywhere: the floating launcher below.
  // `?section=support` stays supported as a deep link (shared/older links) and
  // simply opens that same panel. Navigating anywhere else closes it, so the
  // full-screen mobile sheet never stays stuck over the new page — in Safari
  // that reads as a hang.
  const [supportOpen, setSupportOpen] = useState(activeSection === 'support');
  useEffect(() => {
    setSupportOpen(activeSection === 'support');
  }, [activeSection, location.pathname]);

  const handleSupportOpenChange = (next: boolean) => {
    setSupportOpen(next);
    // Clear the deep link on close so the panel doesn't immediately reopen.
    if (!next && activeSection === 'support') navigate(DASHBOARD_LINK);
  };

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
            <Toolbar sx={{ minHeight: { xs: 64, md: 76 }, px: { xs: 2, sm: 3, lg: 4 }, gap: { xs: 1.5, md: 2 } }}>
              <Box
                component={Link}
                to={DASHBOARD_LINK}
                aria-label={`${hotelName} guest portal home`}
                sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, flexShrink: 0, textDecoration: 'none' }}
              >
                <Box component="img" src="/salim-inn/salim-inn-logo.svg" alt={hotelName} sx={{ display: 'block', width: { xs: 122, sm: 146 }, height: 'auto' }} />
              </Box>

              <Stack
                component="nav"
                aria-label="Guest portal"
                direction="row"
                spacing={0.5}
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  ml: 'auto',
                  minWidth: 0,
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                  '&::-webkit-scrollbar': { display: 'none' },
                }}
              >
                {[...primarySections, ...secondarySections].map(link => (
                  <Button
                    key={link.label}
                    component={Link}
                    to={link.to}
                    color="inherit"
                    aria-current={activeSection === link.section ? 'page' : undefined}
                    sx={{
                      flexShrink: 0,
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
                <Button component="a" href={HOTEL_INDEX_LINK} color="inherit" sx={{ flexShrink: 0, minHeight: 44, px: 1.5, color: 'rgba(255,255,255,0.72)', fontSize: '0.8125rem', '&:hover': { bgcolor: 'rgba(255,255,255,0.09)', color: '#FFFFFF', transform: 'translateY(-1px)' } }}>
                  Explore hotel
                </Button>
              </Stack>

              <Box sx={{ ml: { xs: 'auto', md: 0 }, flexShrink: 0 }}>
                <GuestPortalNotificationBell
                  token={portalToken}
                />
              </Box>

              {/* Phones book from the bottom bar's "Book" tab — showing this CTA
                  as well would put two identical actions on one screen. */}
              <Button
                component={Link}
                to={BOOKING_LINK}
                variant="contained"
                aria-current={activeSection === 'booking' ? 'page' : undefined}
                disableElevation
                sx={{
                  display: { xs: 'none', md: 'inline-flex' },
                  flexShrink: 0,
                  minHeight: 44,
                  px: 2,
                  bgcolor: GOLD,
                  color: '#1E2119',
                  fontSize: '0.8125rem',
                  whiteSpace: 'nowrap',
                  '&:hover': { bgcolor: '#D8B76F', transform: 'translateY(-1px)' },
                  '&:focus-visible': { outline: '3px solid #FFFFFF', outlineOffset: 3 },
                }}
              >
                Book a stay
              </Button>
            </Toolbar>
          </Container>
        </AppBar>

        <Box id="guest-portal-main" component="main" tabIndex={-1} sx={{ animation: 'guest-portal-enter 220ms ease-out both', '@media (prefers-reduced-motion: reduce)': { animation: 'none' }, '@keyframes guest-portal-enter': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
          {children}
        </Box>

        <Box component="nav" aria-label="Guest portal mobile navigation" sx={{ display: { xs: 'block', md: 'none' }, position: 'fixed', inset: 'auto 0 0', zIndex: theme => theme.zIndex.appBar, px: 1, pb: 'max(8px, env(safe-area-inset-bottom))', pt: 1, bgcolor: 'rgba(245,240,230,0.94)', backdropFilter: 'blur(14px)', borderTop: '1px solid rgba(23,33,29,0.12)' }}>
          <BottomNavigation showLabels value={mobileValue} sx={{ height: 64, borderRadius: 2, bgcolor: '#FFFCF6', boxShadow: '0 8px 24px rgba(24,35,29,0.12)', overflow: 'hidden', '& .MuiBottomNavigationAction-root': { minWidth: 0, maxWidth: 'none', color: '#56625B', transition: 'color 200ms ease, transform 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }, '& .MuiBottomNavigationAction-root.Mui-selected': { color: FOREST }, '& .MuiBottomNavigationAction-label': { fontSize: '0.625rem', fontWeight: 700, mt: 0.25 }, '& .MuiBottomNavigationAction-label.Mui-selected': { fontSize: '0.625rem' } }}>
            {primarySections.map(link => (
              <BottomNavigationAction key={link.label} component={Link} to={link.to} value={link.to} label={link.label} icon={link.icon} aria-current={activeSection === link.section ? 'page' : undefined} />
            ))}
            <BottomNavigationAction
              component={Link}
              to={BOOKING_LINK}
              value={BOOKING_LINK}
              label="Book"
              icon={<CalendarMonthOutlinedIcon />}
              aria-current={activeSection === 'booking' ? 'page' : undefined}
            />
            <BottomNavigationAction
              value={MORE_VALUE}
              label="More"
              icon={<MoreHorizOutlinedIcon />}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
            />
          </BottomNavigation>
        </Box>

        <Drawer
          anchor="bottom"
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          sx={{ display: { xs: 'block', md: 'none' } }}
          slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, bgcolor: '#FFFCF6', pb: 'max(8px, env(safe-area-inset-bottom))' } } }}
        >
          <Box sx={{ px: 2, pt: 2, pb: 1 }}>
            <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'rgba(23,33,29,0.18)', mx: 'auto', mb: 1.5 }} />
            <Typography variant="overline" sx={{ color: '#8d6b30', fontWeight: 700, letterSpacing: '.12em' }}>
              More
            </Typography>
          </Box>
          <List sx={{ pb: 1 }}>
            {secondarySections.map(link => (
              <ListItemButton
                key={link.label}
                component={Link}
                to={link.to}
                selected={activeSection === link.section}
                aria-current={activeSection === link.section ? 'page' : undefined}
                sx={{ minHeight: 52 }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: FOREST }}>{link.icon}</ListItemIcon>
                <ListItemText primary={link.label} primaryTypographyProps={{ fontWeight: 600 }} />
              </ListItemButton>
            ))}
            <Divider component="li" sx={{ my: 1 }} />
            <ListItemButton component="a" href={HOTEL_INDEX_LINK} sx={{ minHeight: 52 }}>
              <ListItemIcon sx={{ minWidth: 40, color: FOREST }}><OpenInNewOutlinedIcon /></ListItemIcon>
              <ListItemText primary="Explore hotel" primaryTypographyProps={{ fontWeight: 600 }} />
            </ListItemButton>
          </List>
        </Drawer>

        {portalToken ? (
          <PortalSupportWidget token={portalToken} open={supportOpen} onOpenChange={handleSupportOpenChange} />
        ) : null}
      </Box>
    </GuestPortalThemeProvider>
  );
}
