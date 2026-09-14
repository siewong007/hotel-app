import React from 'react';
import { Box, ListItemButton, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

export interface MobileCardRowProps {
  /** Primary line — guest name, room number, invoice id, … */
  title: React.ReactNode;
  /** Second line — dates, contact, secondary context. */
  subtitle?: React.ReactNode;
  /** Third line — smaller muted detail (amount, ref, counts). */
  meta?: React.ReactNode;
  /** Trailing status element (a StatusChip/Chip — text, never colour alone). */
  status?: React.ReactNode;
  /** Row tap opens the entity's existing detail surface; adds a chevron. */
  onClick?: () => void;
  /** Keeps the selected-row treatment consistent with desktop row hover. */
  selected?: boolean;
  /**
   * Optional action strip rendered under the row (e.g. Approve / Reject).
   * When present the outer container is a plain box — never nest buttons in
   * the row's own button — so give the actions a View/Open button if the row
   * still needs to lead somewhere.
   */
  footer?: React.ReactNode;
}

/**
 * The canonical mobile replacement for a wide table row: title / subtitle /
 * meta on the left, status chip and a chevron on the right. Pair with
 * `useIsPhone()` — render a list of these instead of the desktop `<Table>` on
 * phones. Actions that don't fit belong on the detail surface the row opens,
 * or in `footer` when they are the point of the list (approval queues).
 */
export const MobileCardRow: React.FC<MobileCardRowProps> = ({
  title,
  subtitle,
  meta,
  status,
  onClick,
  selected = false,
  footer,
}) => {
  const body = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', minWidth: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 750, lineHeight: 1.25 }} noWrap>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }} noWrap>
            {subtitle}
          </Typography>
        ) : null}
        {meta ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.25, display: 'block' }} noWrap>
            {meta}
          </Typography>
        ) : null}
      </Box>
      {status ? <Box sx={{ flexShrink: 0 }}>{status}</Box> : null}
      {onClick ? (
        <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
      ) : null}
    </Box>
  );

  if (footer) {
    return (
      <Box sx={{ px: 2, py: 1.5, bgcolor: selected ? 'action.selected' : undefined }}>
        {onClick ? (
          <Box
            component="div"
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }}
            sx={{ cursor: 'pointer', borderRadius: 1, mb: 1 }}
          >
            {body}
          </Box>
        ) : (
          <Box sx={{ mb: 1 }}>{body}</Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{footer}</Box>
      </Box>
    );
  }

  if (!onClick) {
    return <Box sx={{ px: 2, py: 1.5 }}>{body}</Box>;
  }
  return (
    <ListItemButton
      onClick={onClick}
      selected={selected}
      sx={{ px: 2, py: 1.5, borderRadius: 0, alignItems: 'center' }}
    >
      {body}
    </ListItemButton>
  );
};

export default MobileCardRow;
