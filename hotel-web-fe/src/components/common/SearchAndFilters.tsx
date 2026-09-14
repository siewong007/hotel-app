import React, { useState } from 'react';
import { Badge, Box, IconButton, Stack } from '@mui/material';
import { Tune as TuneIcon } from '@mui/icons-material';
import { useIsPhone } from '../../hooks/useIsPhone';
import { useTranslation } from '../../i18n';
import { FilterSheet } from './FilterSheet';

export interface SearchAndFiltersProps {
  /** The controlled search field (rendered full-width both layouts). */
  search: React.ReactNode;
  /** Secondary filter controls — rendered inline in the desktop grid and
      inside the FilterSheet on phone. Supply controlled inputs; the sheet
      changes presentation only. */
  children: React.ReactNode;
  /** Count shown on the filter button badge. */
  activeFilterCount?: number;
  onReset?: () => void;
  sheetTitle?: React.ReactNode;
  /** Optional chip/view-selector row rendered under the controls both ways
      (scrollable on phone — same pattern as BookingFiltersBar chipsRow). */
  chipsRow?: React.ReactNode;
}

/**
 * The shared search + filters bar: on phone a search field beside a badged
 * filter button that opens the secondary controls inside a `FilterSheet`; on
 * desktop the same controls inline in the filter grid (search takes the wider
 * first column, up to four secondaries share the rest, extras wrap to a second
 * implicit row). Pages pass controlled inputs — the bar only changes where
 * they render. Generalizes the BookingFiltersBar pattern.
 */
export const SearchAndFilters: React.FC<SearchAndFiltersProps> = ({
  search,
  children,
  activeFilterCount = 0,
  onReset,
  sheetTitle,
  chipsRow,
}) => {
  const isPhone = useIsPhone();
  const { t } = useTranslation('common');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const chips = chipsRow ? (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={isPhone ? {
        mt: 1.25,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        mx: -1.5,
        px: 1.5,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        '& .MuiChip-root': { flexShrink: 0 },
      } : {
        flexWrap: 'wrap',
        mt: 1.5,
      }}
    >
      {chipsRow}
    </Stack>
  ) : null;

  if (isPhone) {
    return (
      <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{search}</Box>
          <Badge badgeContent={activeFilterCount} color="primary">
            <IconButton
              aria-label={t('actions.openFilters')}
              onClick={() => setFiltersOpen(true)}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <TuneIcon />
            </IconButton>
          </Badge>
        </Stack>
        {chips}
        <FilterSheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onReset={onReset}
          title={sheetTitle}
        >
          {/* SwipeableDrawer keeps a closed sheet mounted, so gate the
              controls themselves: they stay out of the DOM until opened. */}
          {filtersOpen ? children : null}
        </FilterSheet>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.4fr) repeat(4, minmax(0, 1fr))' }, gap: 1.25 }}>
        {search}
        {children}
      </Box>
      {chips}
    </Box>
  );
};

export default SearchAndFilters;
