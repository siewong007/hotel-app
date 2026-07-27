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
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { getPaginationState, normalizePage, toPaginationSearchParams } from '../../../utils/pagination';
import { useGuestsPage } from '../hooks/useGuestQueries';
import GuestProfileDialog from './GuestProfileDialog';

const PAGE_SIZE = 50;

const GuestsPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
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
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3
        }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            All Guest Users
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
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
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
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
              <TableCell><strong>Stays</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell><strong>Registered Date</strong></TableCell>
              <TableCell align="right"><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={32} />
                </TableCell>
              </TableRow>
            ) : guests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <Typography variant="body1" sx={{
                    color: "text.secondary"
                  }}>
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
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {guest.bookings_count ?? 0}
                    </Typography>
                    {guest.last_stay_date && (
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        Last {new Date(guest.last_stay_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Typography>
                    )}
                  </TableCell>
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
                  <TableCell align="right">
                    <Tooltip title="Open guest profile">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => setSelectedGuestId(guest.id)}
                        aria-label={`Open profile for ${guest.full_name || `guest ${guest.id}`}`}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {/* Pagination */}
      {guestPagination.hasMultiplePages && (
        <Stack
          direction="row"
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
            mt: 2,
            px: 1
          }}>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
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
      <GuestProfileDialog
        open={selectedGuestId != null}
        guestId={selectedGuestId}
        onClose={() => setSelectedGuestId(null)}
      />
    </Box>
  );
};

export default GuestsPage;
