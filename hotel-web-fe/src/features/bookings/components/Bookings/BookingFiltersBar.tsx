import React, { useState } from 'react';
import {
  Autocomplete,
  Badge,
  Box,
  Chip,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import {
  Clear as ClearIcon,
  Search as SearchIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import { formatShortDate, formatShortMonth, type BookingView } from '../../utils/bookingPageUtils';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { FilterSheet } from '../../../../components/common/FilterSheet';

interface BookingFiltersBarProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  paymentMethodFilter: string;
  onPaymentMethodFilterChange: (value: string) => void;
  onlineChannelFilter: string;
  onOnlineChannelFilterChange: (value: string) => void;
  searchDate: string;
  onSearchDateChange: (value: string) => void;
  onClearSearchDate: () => void;
  monthSearch: string;
  onMonthSearchChange: (value: string) => void;
  onClearMonthSearch: () => void;
  bookingView: BookingView;
  onSelectView: (view: BookingView) => void;
  viewCounts: { all: number; arriving: number; inHouse: number; upcoming: number; due: number; normalDue: number; companyDue: number };
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  paymentMethods: string[];
  onlineChannels: string[];
  monthOptions: { value: string; label: string }[];
}

const BookingFiltersBar: React.FC<BookingFiltersBarProps> = ({
  searchQuery,
  onSearchQueryChange,
  paymentMethodFilter,
  onPaymentMethodFilterChange,
  onlineChannelFilter,
  onOnlineChannelFilterChange,
  searchDate,
  onSearchDateChange,
  onClearSearchDate,
  monthSearch,
  onMonthSearchChange,
  onClearMonthSearch,
  bookingView,
  onSelectView,
  viewCounts,
  hasActiveFilters,
  onClearFilters,
  paymentMethods,
  onlineChannels,
  monthOptions,
}) => {
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const searchField = (
    <TextField
      fullWidth
      size="medium"
      placeholder="Search booking, guest, invoice, or room number..."
      value={searchQuery}
      onChange={(e) => onSearchQueryChange(e.target.value)}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }
      }}
    />
  );

  const secondaryFilters = (
    <>
      <Autocomplete<string, false, false, true>
        freeSolo
        fullWidth
        size="medium"
        options={paymentMethods}
        value={paymentMethodFilter || null}
        onChange={(_, value) => onPaymentMethodFilterChange(value ?? '')}
        renderInput={(params) => (
          <TextField {...params} label="Payment method" placeholder="Any" />
        )}
      />
      <Autocomplete<string, false, false, true>
        freeSolo
        fullWidth
        size="medium"
        options={onlineChannels}
        value={onlineChannelFilter || null}
        onChange={(_, value) => onOnlineChannelFilterChange(value ?? '')}
        renderInput={(params) => (
          <TextField {...params} label="Online channel" placeholder="Any" />
        )}
      />
      <TextField
        fullWidth
        size="medium"
        label="Search date"
        type="date"
        value={searchDate}
        onChange={(e) => onSearchDateChange(e.target.value)}
        slotProps={{
          inputLabel: { shrink: true }
        }}
      />
      <FormControl fullWidth size="medium">
        <Select
          aria-label="Search month"
          value={monthSearch}
          displayEmpty
          onChange={(e) => onMonthSearchChange(e.target.value as string)}
        >
          <MenuItem value="">Any month</MenuItem>
          {monthOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </>
  );

  const sheetFilterCount =
    (paymentMethodFilter ? 1 : 0) +
    (onlineChannelFilter ? 1 : 0) +
    (searchDate ? 1 : 0) +
    (monthSearch ? 1 : 0);

  const chipsRow = (
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
        flexWrap: "wrap",
        mt: 1.5
      }}>
      {[
        { key: 'all', label: 'All', count: viewCounts.all },
        { key: 'arriving', label: 'Arriving', count: viewCounts.arriving },
        { key: 'in_house', label: 'In House', count: viewCounts.inHouse },
        { key: 'upcoming', label: 'Upcoming', count: viewCounts.upcoming },
        { key: 'balance', label: 'Overdue Balance', count: viewCounts.due },
        { key: 'normal_balance', label: 'Normal', count: viewCounts.normalDue },
        { key: 'company_balance', label: 'Company', count: viewCounts.companyDue },
      ].map((filter) => (
        <Chip
          key={filter.key}
          label={`${filter.label}  ${filter.count}`}
          onClick={() => onSelectView(filter.key as BookingView)}
          sx={{
            height: 34,
            px: 0.5,
            fontWeight: 900,
            bgcolor: bookingView === filter.key ? 'text.primary' : 'background.paper',
            color: bookingView === filter.key ? 'background.paper' : 'text.primary',
          }}
        />
      ))}
      {hasActiveFilters && (
        <Chip
          icon={<ClearIcon />}
          label="Clear"
          variant="outlined"
          onClick={onClearFilters}
          sx={{ height: 34, fontWeight: 800 }}
        />
      )}
      {searchDate && (
        <Chip
          label={`Date ${formatShortDate(searchDate)}`}
          onDelete={onClearSearchDate}
          sx={{ height: 34, fontWeight: 800 }}
        />
      )}
      {monthSearch && (
        <Chip
          label={`Month ${formatShortMonth(monthSearch)}`}
          onDelete={onClearMonthSearch}
          sx={{ height: 34, fontWeight: 800 }}
        />
      )}
    </Stack>
  );

  if (isPhone) {
    return (
      <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{searchField}</Box>
          <Badge badgeContent={sheetFilterCount} color="primary">
            <IconButton
              aria-label="Open filters"
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
        {chipsRow}
        <FilterSheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onReset={onClearFilters}
        >
          {secondaryFilters}
        </FilterSheet>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.4fr) repeat(4, minmax(0, 1fr))' }, gap: 1.25 }}>
        {searchField}
        {secondaryFilters}
      </Box>
      {chipsRow}
    </Box>
  );
};

export default BookingFiltersBar;
