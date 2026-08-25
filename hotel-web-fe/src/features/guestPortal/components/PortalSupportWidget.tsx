import { useEffect, useRef } from 'react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import { Box, Fab, IconButton, Paper, Portal, Slide, Typography, useMediaQuery, useTheme } from '@mui/material';
import { PortalSupportTab } from './PortalSupportTab';

const FOREST = '#0f3d2e';
const WIDGET_Z_INDEX = 1200;

interface PortalSupportWidgetProps {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Floating, dockable support panel. A launcher bubble sits at the bottom-right of
 * every guest-portal page; opening it reveals the full support experience
 * (conversation list + thread + intake) inside a docked card. The panel reuses
 * {@link PortalSupportTab} unchanged so all conversation logic lives in one place.
 *
 * On phones the launcher is an icon-only bubble and the panel opens as a
 * full-screen sheet, so it never floats awkwardly over — and partially blocks —
 * the page content. From tablet up it becomes a docked bottom-right card.
 */
export function PortalSupportWidget({ token, open, onOpenChange }: PortalSupportWidgetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Escape closes the panel; matches the dismiss affordance guests expect from a chat widget.
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  return (
    // Portal to <body> so position:fixed is relative to the viewport, not the
    // shell's #guest-portal-main, which retains a transform (animation fill-mode)
    // and would otherwise become the containing block — misplacing/clipping the
    // panel in Safari.
    <Portal>
      <Fab
        variant={isPhone ? 'circular' : 'extended'}
        aria-label="Open support chat"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
        sx={{
          position: 'fixed',
          // Lifted above the mobile bottom navigation (present below md); tucked to the corner on desktop.
          right: { xs: 16, md: 24 },
          bottom: { xs: 88, md: 24 },
          zIndex: WIDGET_Z_INDEX,
          display: open ? 'none' : 'inline-flex',
          textTransform: 'none',
          fontWeight: 700,
          bgcolor: FOREST,
          color: '#fff',
          boxShadow: '0 12px 30px rgba(6,17,14,.28)',
          '&:hover': { bgcolor: '#155e46' },
        }}
      >
        <SupportAgentOutlinedIcon sx={{ mr: isPhone ? 0 : 1 }} />
        {isPhone ? null : 'Support'}
      </Fab>
      <Slide
        in={open}
        direction="up"
        mountOnEnter
        unmountOnExit
        // Focus once the enter transition has mounted the panel; at plain
        // effect time the close button does not exist yet under mountOnEnter.
        onEntered={() => closeButtonRef.current?.focus()}
      >
        <Paper
          elevation={12}
          role="dialog"
          aria-modal={isPhone ? true : false}
          aria-label="Hotel support"
          sx={{
            position: 'fixed',
            zIndex: WIDGET_Z_INDEX,
            // Phone: full-screen sheet. Tablet/desktop: docked bottom-right card.
            top: { xs: 0, sm: 'auto' },
            right: { xs: 0, sm: 24 },
            bottom: { xs: 0, sm: 84, md: 24 },
            left: { xs: 0, sm: 'auto' },
            width: { xs: 'auto', sm: 'min(94vw, 720px)' },
            height: { xs: 'auto', sm: 'min(80vh, 620px)' },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: { xs: 0, sm: 3 },
            border: { xs: 'none', sm: '1px solid rgba(6,17,14,.14)' },
            boxShadow: { xs: 'none', sm: '0 24px 60px rgba(6,17,14,.28)' },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1.25,
              // Respect the notch/status bar when the sheet is full-screen on phones.
              pt: { xs: 'max(12px, env(safe-area-inset-top))', sm: 1.25 },
              bgcolor: FOREST,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SupportAgentOutlinedIcon fontSize="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Support
              </Typography>
            </Box>
            <IconButton
              ref={closeButtonRef}
              onClick={() => onOpenChange(false)}
              aria-label="Close support"
              size="small"
              sx={{ color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,.14)' } }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 2, md: 2.5 }, bgcolor: '#fffdf9' }}>
            <PortalSupportTab token={token} />
          </Box>
        </Paper>
      </Slide>
    </Portal>
  );
}

export default PortalSupportWidget;
