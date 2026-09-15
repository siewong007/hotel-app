import React from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';

export interface TableScrollProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * Horizontal scroll host for a bare `<Table>`.
 *
 * A `<Table>` is `display: table`, so it refuses to shrink below its
 * min-content width: with enough columns it overflows whatever contains it.
 * `body { overflow-x: clip }` (see index.css) then swallows the overflow
 * without a scrollbar, so the rightmost columns are not merely awkward —
 * they are unreachable.
 *
 * Tables that already sit in a `<TableContainer>` are fine; that component
 * carries `overflow-x: auto` itself. This is for the other case — a table
 * rendered bare, usually as the desktop branch of an
 * `isPhone ? <cards> : <Table>` swap, where the phone path hides the problem
 * below 600px and the tablet range (600-900px) inherits it. Prefer this over
 * adding a `<TableContainer>` there: the theme gives that component a border,
 * radius and shadow, which double up inside the Card these tables already
 * live in.
 *
 * Scrolling a table sideways is the fallback, not the goal — where a table is
 * a primary surface, give it a `renderMobileCard` via `DataTable`, or an
 * explicit card branch, so phones get a readable list instead.
 */
export const TableScroll: React.FC<TableScrollProps> = ({ children, sx }) => (
  <Box
    sx={[
      {
        overflowX: 'auto',
        // Keep the sideways scroll from stealing the page's vertical gesture.
        overscrollBehaviorX: 'contain',
        WebkitOverflowScrolling: 'touch',
      },
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    {children}
  </Box>
);
