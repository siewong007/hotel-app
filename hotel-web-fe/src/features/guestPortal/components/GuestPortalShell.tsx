import { useEffect, useState, type ReactNode } from 'react';
import {
  AppBar,
  Avatar,
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
  Menu,
  MenuItem,
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
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined';
import KeyboardArrowDownOutlinedIcon from '@mui/icons-material/KeyboardArrowDownOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import { Link, useLocation, useNavigate } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import { GuestPortalThemeProvider } from '../theme/GuestPortalThemeProvider';
import { GUEST_BRAND } from '../theme/guestPortalTheme';
import { getValidPortalToken, PORTAL_TOKEN_CHANGE_EVENT } from '../api/portalTokenStore';
import { useGuestSignOut } from '../hooks/useGuestSignOut';
import { GuestPortalNotificationBell } from './GuestPortalNotificationBell';
import { PortalSupportWidget } from './PortalSupportWidget';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { useTranslation } from '../../../i18n';
import { LanguageSwitcher } from '../../../components/common/LanguageSwitcher';

interface GuestPortalShellProps {
  children: ReactNode;
  /**
   * Whether to show the account sections (stays, points, offers, support).
   *
   * Passed down rather than read from auth context here: RootLayout already
   * decides who may see this shell, and a visitor booking anonymously has no
   * account behind any of those sections. Defaults to `true` so the signed-in
   * portal — every other caller — is unchanged.
   */
  showAccountNav?: boolean;
}

const DASHBOARD_LINK = '/guest-portal?section=overview';
const BOOKING_LINK = '/guest-portal?view=booking';
const SIGN_IN_LINK = '/login?redirect=%2Fguest-portal%3Fview%3Dbooking';
const HOTEL_INDEX_LINK = '/salim-inn/index.html?account=guest';
const MORE_VALUE = 'more';

// The shell owns the ONLY navigation in the guest portal: a top bar on web, a
// bottom bar on phones. Pages must not render their own section switcher.
// `primary` items are the phone bottom-bar slots and stay inline on web;
// `rewards` group under a desktop dropdown and the phone "More" sheet;
// `account` items live in the avatar menu on web and the "More" sheet on
// phones.
// Labels come from `guestPortal:nav.<section>` at render time; every section
// id below has a key in all three locales.
const primarySections = [
  { section: 'overview', to: DASHBOARD_LINK, icon: <HomeOutlinedIcon /> },
  { section: 'stays', to: '/guest-portal?section=stays', icon: <HotelOutlinedIcon /> },
  { section: 'points-history', to: '/guest-portal?section=points-history', icon: <HistoryOutlinedIcon /> },
] as const;

const rewardsSections = [
  { section: 'offers', to: '/guest-portal?section=offers', icon: <LocalOfferOutlinedIcon /> },
  { section: 'vouchers', to: '/guest-portal?section=vouchers', icon: <ConfirmationNumberOutlinedIcon /> },
  { section: 'credits', to: '/guest-portal?section=credits', icon: <CardGiftcardOutlinedIcon /> },
] as const;

const accountSections = [
  { section: 'profile', to: '/guest-portal?section=profile', icon: <PersonOutlineOutlinedIcon /> },
  { section: 'identity', to: '/guest-portal?section=identity', icon: <BadgeOutlinedIcon /> },
  { section: 'security', to: '/guest-portal?section=security', icon: <ShieldOutlinedIcon /> },
  { section: 'preferences', to: '/guest-portal?section=preferences', icon: <TuneOutlinedIcon /> },
] as const;

type GuestSection =
  | (typeof primarySections)[number]['section']
  | (typeof rewardsSections)[number]['section']
  | (typeof accountSections)[number]['section']
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
    case 'identity':
      return 'identity';
    case 'security':
      return 'security';
    case 'preferences':
      return 'preferences';
    case 'support':
      return 'support';
    default:
      return 'overview';
  }
}

const navButtonSx = (active: boolean) => ({
  flexShrink: 0,
  minHeight: 44,
  px: 1.5,
  borderRadius: 1.5,
  color: active ? GUEST_BRAND.text : GUEST_BRAND.muted,
  fontSize: '0.8125rem',
  boxShadow: active ? `inset 0 -2px 0 ${GUEST_BRAND.accent}` : 'none',
  '&:hover': { bgcolor: GUEST_BRAND.hover, color: GUEST_BRAND.text },
  '&:focus-visible': { outline: `3px solid ${GUEST_BRAND.accent}`, outlineOffset: 3 },
});

const sheetRowSx = { minHeight: 52 };
const sheetIconSx = { minWidth: 40, color: 'var(--hotel-primary)' };
const groupLabelSx = {
  px: 2,
  pt: 1.5,
  pb: 0.5,
  color: 'var(--hotel-primary-text)',
  fontWeight: 700,
  letterSpacing: '.12em',
};

/** Guest-only navigation that preserves the existing portal route contract. */
export function GuestPortalShell({ children, showAccountNav = true }: GuestPortalShellProps) {
  const { t } = useTranslation('guestPortal');
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const signOut = useGuestSignOut();
  const hotelName = getHotelSettings().hotel_name;
  const [portalToken, setPortalToken] = useState<string | null>(() => getValidPortalToken());
  const [moreOpen, setMoreOpen] = useState(false);
  const [rewardsAnchor, setRewardsAnchor] = useState<HTMLElement | null>(null);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const activeSection = currentGuestSection(location.search);
  const isUtilityActive = [...rewardsSections, ...accountSections].some(
    (link) => link.section === activeSection,
  );
  const isRewardsActive = rewardsSections.some((link) => link.section === activeSection);
  const mobileValue = activeSection === 'booking'
    ? BOOKING_LINK
    : isUtilityActive
      ? MORE_VALUE
      : primarySections.find((link) => link.section === activeSection)?.to ?? DASHBOARD_LINK;

  const rewardsOpen = Boolean(rewardsAnchor);
  const accountOpen = Boolean(accountAnchor);

  const displayName =
    user?.full_name?.trim() || user?.username || t('account.guest');
  const avatarInitials = displayName
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

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

  const handleSignOut = () => {
    setAccountAnchor(null);
    setMoreOpen(false);
    signOut();
  };

  return (
    <GuestPortalThemeProvider>
      <Box sx={{ minHeight: '100vh', bgcolor: 'var(--hotel-bg)', color: 'text.primary', pb: { xs: showAccountNav ? 10 : 2, md: 0 } }}>
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
            bgcolor: 'var(--hotel-surface-overlay)',
            color: 'var(--hotel-text)',
            fontWeight: 800,
            textDecoration: 'none',
            transform: 'translateY(-160%)',
            transition: 'transform 200ms ease',
            '&:focus-visible': { transform: 'translateY(0)' },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          {t('shell.skipToContent')}
        </Box>
        <AppBar
          component="header"
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: GUEST_BRAND.bg,
            color: GUEST_BRAND.text,
            borderBottom: `1px solid ${GUEST_BRAND.border}`,
          }}
        >
          <Container maxWidth="xl" disableGutters>
            <Toolbar sx={{ minHeight: { xs: 64, md: 76 }, px: { xs: 2, sm: 3, lg: 4 }, gap: { xs: 1.5, md: 2 } }}>
              <Box
                component={Link}
                to={DASHBOARD_LINK}
                aria-label={t('shell.homeAria', { hotel: hotelName })}
                sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, flexShrink: 0, textDecoration: 'none' }}
              >
                <Box component="img" src="/salim-inn/salim-inn-logo.svg" alt={hotelName} sx={{ display: 'block', width: { xs: 122, sm: 146 }, height: 'auto' }} />
              </Box>

              <Stack
                component="nav"
                aria-label={t('shell.navAria')}
                direction="row"
                spacing={0.5}
                sx={{
                  display: { xs: 'none', md: showAccountNav ? 'flex' : 'none' },
                  ml: 'auto',
                  minWidth: 0,
                  alignItems: 'center',
                }}
              >
                {primarySections.map(link => (
                  <Button
                    key={link.section}
                    component={Link}
                    to={link.to}
                    color="inherit"
                    aria-current={activeSection === link.section ? 'page' : undefined}
                    sx={navButtonSx(activeSection === link.section)}
                  >
                    {t(`nav.${link.section}`)}
                  </Button>
                ))}
                <Button
                  color="inherit"
                  aria-haspopup="menu"
                  aria-expanded={rewardsOpen}
                  aria-controls={rewardsOpen ? 'guest-rewards-menu' : undefined}
                  onClick={(event) => setRewardsAnchor(event.currentTarget)}
                  endIcon={<KeyboardArrowDownOutlinedIcon fontSize="small" />}
                  sx={navButtonSx(isRewardsActive)}
                >
                  {t('nav.rewards')}
                </Button>
                <Menu
                  id="guest-rewards-menu"
                  anchorEl={rewardsAnchor}
                  open={rewardsOpen}
                  onClose={() => setRewardsAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                  slotProps={{ list: { 'aria-label': t('nav.rewards') } }}
                >
                  {rewardsSections.map(link => (
                    <MenuItem
                      key={link.section}
                      component={Link}
                      to={link.to}
                      onClick={() => setRewardsAnchor(null)}
                      aria-current={activeSection === link.section ? 'page' : undefined}
                      sx={{ gap: 1.25, minHeight: 44 }}
                    >
                      <ListItemIcon sx={{ minWidth: 0, color: 'var(--hotel-primary)' }}>{link.icon}</ListItemIcon>
                      {t(`nav.${link.section}`)}
                    </MenuItem>
                  ))}
                </Menu>
              </Stack>

              <Box sx={{ ml: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <LanguageSwitcher color="inherit" size="small" />
                {showAccountNav ? (
                  <>
                    <GuestPortalNotificationBell token={portalToken} />
                    <Button
                      color="inherit"
                      aria-label={t('account.title')}
                      aria-haspopup="menu"
                      aria-expanded={accountOpen}
                      aria-controls={accountOpen ? 'guest-account-menu' : undefined}
                      onClick={(event) => setAccountAnchor(event.currentTarget)}
                      sx={{
                        minHeight: 44,
                        pl: 0.75,
                        pr: 1.25,
                        gap: 1,
                        borderRadius: 999,
                        color: GUEST_BRAND.text,
                        textTransform: 'none',
                        '&:hover': { bgcolor: GUEST_BRAND.hover },
                        '&:focus-visible': { outline: `3px solid ${GUEST_BRAND.accent}`, outlineOffset: 3 },
                      }}
                    >
                      <Avatar sx={{ width: 32, height: 32, fontSize: '0.8125rem', fontWeight: 700, bgcolor: GUEST_BRAND.accent, color: GUEST_BRAND.accentText }}>
                        {avatarInitials}
                      </Avatar>
                      <Box
                        component="span"
                        sx={{
                          display: { xs: 'none', lg: 'block' },
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                          maxWidth: 140,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {displayName}
                      </Box>
                    </Button>
                    <Menu
                      id="guest-account-menu"
                      anchorEl={accountAnchor}
                      open={accountOpen}
                      onClose={() => setAccountAnchor(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                      slotProps={{
                        list: { 'aria-label': t('account.title') },
                        paper: { sx: { mt: 1, minWidth: 240 } },
                      }}
                    >
                      <Box
                        component="li"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, listStyle: 'none' }}
                      >
                        <Avatar sx={{ width: 36, height: 36, fontSize: '0.875rem', fontWeight: 700, bgcolor: 'var(--hotel-primary)', color: 'var(--hotel-on-primary)' }}>
                          {avatarInitials}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayName}
                          </Typography>
                          {user?.email ? (
                            <Typography variant="body2" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {user.email}
                            </Typography>
                          ) : null}
                        </Box>
                      </Box>
                      <Divider component="li" />
                      {accountSections.map(link => (
                        <MenuItem
                          key={link.section}
                          component={Link}
                          to={link.to}
                          onClick={() => setAccountAnchor(null)}
                          aria-current={activeSection === link.section ? 'page' : undefined}
                          sx={{ gap: 1.25, minHeight: 44 }}
                        >
                          <ListItemIcon sx={{ minWidth: 0, color: 'var(--hotel-primary)' }}>{link.icon}</ListItemIcon>
                          {t(`nav.${link.section}`)}
                        </MenuItem>
                      ))}
                      <Divider component="li" />
                      <MenuItem component="a" href={HOTEL_INDEX_LINK} onClick={() => setAccountAnchor(null)} sx={{ gap: 1.25, minHeight: 44 }}>
                        <ListItemIcon sx={{ minWidth: 0, color: 'var(--hotel-primary)' }}><OpenInNewOutlinedIcon /></ListItemIcon>
                        {t('actions.exploreHotel')}
                      </MenuItem>
                      <Divider component="li" />
                      <MenuItem onClick={handleSignOut} sx={{ gap: 1.25, minHeight: 44, color: 'var(--hotel-danger)' }}>
                        <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}><LogoutOutlinedIcon /></ListItemIcon>
                        {t('account.signOut')}
                      </MenuItem>
                    </Menu>
                  </>
                ) : (
                  <Button
                    component={Link}
                    to={SIGN_IN_LINK}
                    color="inherit"
                    sx={{
                      minHeight: 44,
                      px: 1.5,
                      color: GUEST_BRAND.text,
                      fontSize: '0.8125rem',
                      whiteSpace: 'nowrap',
                      '&:hover': { bgcolor: GUEST_BRAND.hover },
                      '&:focus-visible': { outline: `3px solid ${GUEST_BRAND.accent}`, outlineOffset: 3 },
                    }}
                  >
                    {t('actions.signIn')}
                  </Button>
                )}
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
                  display: {
                    xs: 'none',
                    md: activeSection === 'booking' && !showAccountNav ? 'none' : 'inline-flex',
                  },
                  flexShrink: 0,
                  minHeight: 44,
                  px: 2,
                  bgcolor: GUEST_BRAND.accent,
                  color: GUEST_BRAND.accentText,
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  '&:hover': { bgcolor: GUEST_BRAND.accentHover },
                  '&:focus-visible': { outline: '3px solid var(--hotel-focus-ring)', outlineOffset: 3 },
                }}
              >
                {t('actions.bookStay')}
              </Button>
            </Toolbar>
          </Container>
        </AppBar>

        <Box id="guest-portal-main" component="main" tabIndex={-1} sx={{ animation: 'guest-portal-enter 220ms ease-out both', '@media (prefers-reduced-motion: reduce)': { animation: 'none' }, '@keyframes guest-portal-enter': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
          {children}
        </Box>

        <Box component="nav" aria-label={t('shell.mobileNavAria')} sx={{ display: { xs: showAccountNav ? 'block' : 'none', md: 'none' }, position: 'fixed', inset: 'auto 0 0', zIndex: theme => theme.zIndex.appBar, px: 1, pb: 'max(8px, env(safe-area-inset-bottom))', pt: 1, bgcolor: 'color-mix(in srgb, var(--hotel-bg) var(--hotel-glass-alpha, 82%), transparent)', backdropFilter: 'blur(var(--hotel-glass-blur, 10px))', WebkitBackdropFilter: 'blur(var(--hotel-glass-blur, 10px))', borderTop: '1px solid var(--hotel-border)' }}>
          <BottomNavigation showLabels value={mobileValue} sx={{ height: 64, borderRadius: 2, bgcolor: 'var(--hotel-surface-overlay)', boxShadow: 'var(--hotel-shadow-md)', overflow: 'hidden', '& .MuiBottomNavigationAction-root': { minWidth: 0, maxWidth: 'none', color: 'var(--hotel-text-muted)', transition: 'color 200ms ease, transform 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }, '& .MuiBottomNavigationAction-root.Mui-selected': { color: 'var(--hotel-primary)' }, '& .MuiBottomNavigationAction-label': { fontSize: '0.625rem', fontWeight: 700, mt: 0.25 }, '& .MuiBottomNavigationAction-label.Mui-selected': { fontSize: '0.625rem' } }}>
            {primarySections.map(link => (
              <BottomNavigationAction key={link.section} component={Link} to={link.to} value={link.to} label={t(`nav.${link.section}`)} icon={link.icon} aria-current={activeSection === link.section ? 'page' : undefined} />
            ))}
            <BottomNavigationAction
              component={Link}
              to={BOOKING_LINK}
              value={BOOKING_LINK}
              label={t('actions.book')}
              icon={<CalendarMonthOutlinedIcon />}
              aria-current={activeSection === 'booking' ? 'page' : undefined}
            />
            <BottomNavigationAction
              value={MORE_VALUE}
              label={t('actions.more')}
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
          sx={{ display: { xs: showAccountNav ? 'block' : 'none', md: 'none' } }}
          slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, bgcolor: 'var(--hotel-surface-overlay)', pb: 'max(8px, env(safe-area-inset-bottom))' } } }}
        >
          <Box sx={{ px: 2, pt: 2, pb: 1 }}>
            <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'var(--hotel-border-strong)', mx: 'auto', mb: 1.5 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 0.5, pb: 0.5 }}>
              <Avatar sx={{ width: 40, height: 40, fontSize: '0.9375rem', fontWeight: 700, bgcolor: 'var(--hotel-primary)', color: 'var(--hotel-on-primary)' }}>
                {avatarInitials}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </Typography>
                {user?.email ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.email}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          </Box>
          <List sx={{ pb: 1 }}>
            <Typography variant="overline" component="li" sx={{ ...groupLabelSx, display: 'block', listStyle: 'none' }}>
              {t('groups.rewards')}
            </Typography>
            {rewardsSections.map(link => (
              <ListItemButton
                key={link.section}
                component={Link}
                to={link.to}
                selected={activeSection === link.section}
                aria-current={activeSection === link.section ? 'page' : undefined}
                sx={sheetRowSx}
              >
                <ListItemIcon sx={sheetIconSx}>{link.icon}</ListItemIcon>
                <ListItemText primary={t(`nav.${link.section}`)} slotProps={{
                  primary: { sx: { fontWeight: 600 } }
                }} />
              </ListItemButton>
            ))}
            <Divider component="li" sx={{ my: 1 }} />
            <Typography variant="overline" component="li" sx={{ ...groupLabelSx, display: 'block', listStyle: 'none' }}>
              {t('groups.account')}
            </Typography>
            {accountSections.map(link => (
              <ListItemButton
                key={link.section}
                component={Link}
                to={link.to}
                selected={activeSection === link.section}
                aria-current={activeSection === link.section ? 'page' : undefined}
                sx={sheetRowSx}
              >
                <ListItemIcon sx={sheetIconSx}>{link.icon}</ListItemIcon>
                <ListItemText primary={t(`nav.${link.section}`)} slotProps={{
                  primary: { sx: { fontWeight: 600 } }
                }} />
              </ListItemButton>
            ))}
            <Divider component="li" sx={{ my: 1 }} />
            <ListItemButton component="a" href={HOTEL_INDEX_LINK} sx={sheetRowSx}>
              <ListItemIcon sx={sheetIconSx}><OpenInNewOutlinedIcon /></ListItemIcon>
              <ListItemText primary={t('actions.exploreHotel')} slotProps={{
                primary: { sx: { fontWeight: 600 } }
              }} />
            </ListItemButton>
            <ListItemButton onClick={handleSignOut} sx={{ ...sheetRowSx, color: 'var(--hotel-danger)' }}>
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}><LogoutOutlinedIcon /></ListItemIcon>
              <ListItemText primary={t('account.signOut')} slotProps={{
                primary: { sx: { fontWeight: 600 } }
              }} />
            </ListItemButton>
          </List>
        </Drawer>

        {portalToken && showAccountNav ? (
          <PortalSupportWidget token={portalToken} open={supportOpen} onOpenChange={handleSupportOpenChange} />
        ) : null}
      </Box>
    </GuestPortalThemeProvider>
  );
}
