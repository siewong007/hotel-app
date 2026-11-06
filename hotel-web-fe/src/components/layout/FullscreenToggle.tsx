import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { shouldUseDesktopRuntime } from '../../desktop/runtimeApi';
import { useDocumentFullscreen } from '../../hooks/useDocumentFullscreen';
import { useTranslation } from '../../i18n';

/**
 * Staff-shell only: icon button that toggles document fullscreen via the
 * Fullscreen API. Hidden in the Tauri desktop build (the window chrome already
 * covers that) and when the browser has no Fullscreen API (iOS Safari). Guest
 * pages never mount this — it only lives in `AppTopbar`.
 */
export const FullscreenToggle: React.FC = () => {
  const { t: tNav } = useTranslation('nav');
  const { supported, active, toggle } = useDocumentFullscreen();
  // Desktop/Tauri already has its own window maximize; don't surface a dead
  // browser Fullscreen control there.
  const [isDesktop] = React.useState(() => shouldUseDesktopRuntime());

  if (isDesktop || !supported) return null;

  const label = active ? tNav('aria.exitFullscreen') : tNav('aria.enterFullscreen');
  const Icon = active ? FullscreenExitIcon : FullscreenIcon;

  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        onClick={() => {
          void toggle();
        }}
        sx={{ flexShrink: 0, color: 'text.secondary' }}
      >
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
};

export default FullscreenToggle;
