import React from 'react';
import { Box, Paper, Portal, Typography } from '@mui/material';
import { useIsPhone } from '../../hooks/useIsPhone';
import { ActionsMenu } from './ActionsMenu';
import type { ActionMenuItem } from './ActionsMenu';

export interface StickyActionBarProps {
  /** The one prominent action (usually a contained Button). */
  primary: React.ReactNode;
  /** Optional leading summary/context (e.g. price total) — truncates. */
  summary?: React.ReactNode;
  /** Optional extra inline action(s) (outline/soft buttons). */
  secondary?: React.ReactNode;
  /** Optional ActionsMenuProps for overflow. */
  overflowActions?: ActionMenuItem[];
}

// Bottom-nav height in px — the same value as MOBILE_NAV_HEIGHT in
// components/layout/MobileNavBar.tsx. Hardcoded on purpose: layout imports
// common, so common must not import back into layout.
const MOBILE_NAV_HEIGHT_PX = 60;

/**
 * The action row for edit/checkout-style pages. On phones it pins itself
 * `position: fixed` directly above the bottom nav (clearing the iOS home
 * indicator via `--sab`); on `sm` and up it renders as a plain inline
 * bordered strip. Layout is `[summary …][secondary][primary][overflow]` —
 * the summary takes the slack and truncates, actions stay right-packed; a
 * spacer keeps them right when no summary is given. `overflowActions` feeds
 * the shared `ActionsMenu` (Menu on desktop, BottomSheet on phone).
 *
 * The phone bar is portalled to `document.body`: the app shell's `<main>` uses
 * `contain: layout` and route wrappers animate with `transform`, and either
 * one turns a descendant's `position: fixed` into "fixed to that box" — the
 * bar then sat below the page content instead of above the bottom nav.
 */
export const StickyActionBar: React.FC<StickyActionBarProps> = ({
  primary,
  summary,
  secondary,
  overflowActions,
}) => {
  const isPhone = useIsPhone();

  return (
    <Portal disablePortal={!isPhone}>
      <Paper
        elevation={0}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 2,
          py: 1.25,
          bgcolor: 'background.paper',
          ...(isPhone
            ? {
                position: 'fixed',
                bottom: `calc(${MOBILE_NAV_HEIGHT_PX}px + var(--sab))`,
                left: 0,
                right: 0,
                zIndex: (theme) => theme.zIndex.appBar - 1,
                borderTop: '1px solid',
                borderColor: 'divider',
              }
            : {
                position: 'static',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }),
        }}
      >
        {summary ? (
          <Typography
            variant="body2"
            component="div"
            noWrap
            sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}
          >
            {summary}
          </Typography>
        ) : (
          <Box sx={{ flex: 1 }} />
        )}
        {secondary}
        {primary}
        {overflowActions && overflowActions.length > 0 ? (
          <ActionsMenu actions={overflowActions} />
        ) : null}
      </Paper>
    </Portal>
  );
};

export default StickyActionBar;
