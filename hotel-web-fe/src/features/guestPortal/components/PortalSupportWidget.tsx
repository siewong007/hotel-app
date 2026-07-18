import { useEffect, useRef } from 'react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import { Box, Fab, IconButton, Paper, Slide, Typography } from '@mui/material';
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
 */
export function PortalSupportWidget({ token, open, onOpenChange }: PortalSupportWidgetProps) {
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

  // Move focus into the panel when it opens so keyboard users land inside the dialog.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  return (
    <>
      <Fab
        variant="extended"
        aria-label="Open support chat"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
        sx={{
          position: 'fixed',
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
        <SupportAgentOutlinedIcon sx={{ mr: 1 }} />
        Support
      </Fab>

      <Slide in={open} direction="up" mountOnEnter unmountOnExit>
        <Paper
          elevation={12}
          role="dialog"
          aria-modal={false}
          aria-label="Hotel support"
          sx={{
            position: 'fixed',
            zIndex: WIDGET_Z_INDEX,
            right: { xs: 8, md: 24 },
            left: { xs: 8, md: 'auto' },
            bottom: { xs: 84, md: 24 },
            width: { xs: 'auto', md: 'min(94vw, 720px)' },
            height: { xs: 'calc(100dvh - 172px)', md: 'min(86vh, 660px)' },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 3,
            border: '1px solid rgba(6,17,14,.14)',
            boxShadow: '0 24px 60px rgba(6,17,14,.28)',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1.25,
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
    </>
  );
}

export default PortalSupportWidget;
