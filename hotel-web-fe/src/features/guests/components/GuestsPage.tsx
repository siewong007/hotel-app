import React, { useEffect, useRef, useState } from 'react';
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
import { HotelAPIService } from '../../../api';
import { Guest } from '../../../types';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

const PAGE_SIZE = 50;

const GuestsPage: React.FC = () => {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalGuests, setTotalGuests] = useState(0);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 700);
  const guestsRequestId = useRef(0);
  const previousDebouncedSearchQuery = useRef(debouncedSearchQuery);
  const skipNextLoadForPageReset = useRef(false);

  useEffect(() => {
    const searchChanged = previousDebouncedSearchQuery.current !== debouncedSearchQuery;
    previousDebouncedSearchQuery.current = debouncedSearchQuery;

    if (searchChanged && currentPage !== 1) {
      skipNextLoadForPageReset.current = true;
      setCurrentPage(1);
    }
  }, [debouncedSearchQuery, currentPage]);

  useEffect(() => {
    if (skipNextLoadForPageReset.current) {
      skipNextLoadForPageReset.current = false;
      return;
    }

    loadGuests(currentPage, debouncedSearchQuery);
  }, [currentPage, debouncedSearchQuery]);

  const loadGuests = async (page: number, search?: string) => {
    const requestId = guestsRequestId.current + 1;
    guestsRequestId.current = requestId;

    try {
      setLoading(true);
      const resp = await HotelAPIService.getGuestsPage({
        page,
        page_size: PAGE_SIZE,
        ...(search?.trim() ? { search: search.trim() } : {}),
      });
      if (guestsRequestId.current !== requestId) return;

      setGuests(resp.data);
      setTotalGuests(resp.total);
      setError(null);
    } catch (err: any) {
      if (guestsRequestId.current !== requestId) return;

      console.error('Failed to load guests:', err);
      setError(err.message || 'Failed to load guests. Please check your connection and try again.');
    } finally {
      if (guestsRequestId.current === requestId) {
        setLoading(false);
      }
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
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
          onClick={() => loadGuests(currentPage, searchQuery)}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => loadGuests(currentPage, searchQuery)}>
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
      {totalGuests > PAGE_SIZE && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, px: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalGuests)} of {totalGuests} guests
          </Typography>
          <Pagination
            count={Math.ceil(totalGuests / PAGE_SIZE)}
            page={currentPage}
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
