import React from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { NavSection } from '../../../navigation/navGroups';
import { isNavItemActive } from '../../../navigation/isNavItemActive';
import { useRouteLabels } from '../../../navigation/routeLabels';
import { SidebarNavItem } from './SidebarNavItem';

interface SidebarSectionProps {
  section: NavSection;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}

/**
 * One nav group. Labeled groups get an 11px uppercase caption that toggles a
 * `Collapse` around the items (default expanded; `aria-expanded` on the
 * caption). Label-less groups — overview/insights/utility per
 * `LABEL_LESS_GROUPS` — and the collapsed rail render bare rows with no
 * collapse chrome. A group containing the active page always stays open so
 * the current destination can't be hidden under a folded heading.
 */
export const SidebarSection: React.FC<SidebarSectionProps> = ({
  section,
  pathname,
  collapsed,
  onNavigate,
}) => {
  const { groupLabel } = useRouteLabels();
  const [open, setOpen] = React.useState(true);
  const hasActiveChild = section.items.some((item) => isNavItemActive(pathname, item));
  const effectiveOpen = open || hasActiveChild;

  const items = section.items.map((item) => (
    <SidebarNavItem
      key={item.id}
      item={item}
      pathname={pathname}
      collapsed={collapsed}
      onNavigate={onNavigate}
    />
  ));

  if (!section.labeled || collapsed) {
    return <Box sx={{ py: 0.5 }}>{items}</Box>;
  }

  return (
    <Box sx={{ py: 0.5 }}>
      <Box
        component="button"
        type="button"
        aria-expanded={effectiveOpen}
        onClick={() => setOpen((o) => !o)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: 0.5,
          px: 2,
          pt: 1,
          pb: 0.5,
          border: 'none',
          bgcolor: 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <Typography
          sx={{
            flex: 1,
            fontSize: '0.6875rem',
            fontWeight: 700,
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          {groupLabel(section.group)}
        </Typography>
        <KeyboardArrowDownIcon
          sx={{
            fontSize: 16,
            color: 'text.secondary',
            transition: 'transform 0.2s',
            transform: effectiveOpen ? 'none' : 'rotate(-90deg)',
          }}
        />
      </Box>
      <Collapse in={effectiveOpen} timeout="auto">
        {items}
      </Collapse>
    </Box>
  );
};
