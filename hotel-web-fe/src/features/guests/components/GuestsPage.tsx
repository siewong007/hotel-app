import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  TextField,
  InputAdornment,
  Pagination,
  Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { getPaginationState, normalizePage, toPaginationSearchParams } from '../../../utils/pagination';
import { useGuestsPage } from '../hooks/useGuestQueries';

const PAGE_SIZE = 50;

const GuestsPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 700);
  const guestQueryParams = useMemo(() => ({
    ...toPaginationSearchParams({ page: normalizePage(currentPage), pageSize: PAGE_SIZE }),
    ...(debouncedSearchQuery.trim() ? { search: debouncedSearchQuery.trim() } : {}),
  }), [currentPage, debouncedSearchQuery]);
  const guestsQuery = useGuestsPage(guestQueryParams);
  const guests = guestsQuery.data?.data ?? [];
  const totalGuests = guestsQuery.data?.total ?? 0;
  const loading = guestsQuery.isPending;
  const error = guestsQuery.error instanceof Error
    ? guestsQuery.error.message || 'Failed to load guests. Please check your connection and try again.'
    : null;
  const guestPagination = useMemo(
    () => getPaginationState({ page: currentPage, pageSize: PAGE_SIZE, totalItems: totalGuests }),
    [currentPage, totalGuests]
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            All Guest Users
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Registered users with guest access. New guests register through the registration page.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => guestsQuery.refetch()}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => guestsQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Stats + Search row */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Card elevation={0} sx={{ border: '1px solid #edf2f0', borderRadius: 2 }}>
          <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="body2" color="text.secondary">
              Total registered guests: <strong>{totalGuests}</strong>
              {searchQuery && ` · ${totalGuests} matching`}
            </Typography>
          </CardContent>
        </Card>

        <TextField
          size="small"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          sx={{ width: 320 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Guests Table */}
      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #edf2f0', borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell><strong>User ID</strong></TableCell>
              <TableCell><strong>Name</strong></TableCell>
              <TableCell><strong>Email</strong></TableCell>
              <TableCell><strong>Phone</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell><strong>Registered Date</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={32} />
                </TableCell>
              </TableRow>
            ) : guests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <Typography variant="body1" color="text.secondary">
                    {searchQuery ? `No guests found matching "${searchQuery}"` : 'No guest users registered yet'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              guests.map((guest) => (
                <TableRow key={guest.id} hover>
                  <TableCell>{guest.id}</TableCell>
                  <TableCell>{guest.full_name || 'N/A'}</TableCell>
                  <TableCell>{guest.email}</TableCell>
                  <TableCell>{guest.phone || 'N/A'}</TableCell>
                  <TableCell>
                    <Box
                      component="span"
                      sx={{
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 1,
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        bgcolor: guest.is_active ? 'success.light' : 'error.light',
                        color: guest.is_active ? 'success.dark' : 'error.dark',
                      }}
                    >
                      {guest.is_active ? 'Active' : 'Inactive'}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {new Date(guest.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {guestPagination.hasMultiplePages && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, px: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {guestPagination.startItem}–{guestPagination.endItem} of {guestPagination.totalItems} guests
          </Typography>
          <Pagination
            count={guestPagination.totalPages}
            page={guestPagination.currentPage}
            onChange={(_, page) => setCurrentPage(page)}
            color="primary"
            size="small"
            showFirstButton
            showLastButton
          />
        </Stack>
      )}
    </Box>
  );
};

export default GuestsPage;
