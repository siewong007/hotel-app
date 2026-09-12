import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { BookingsService, GuestsService, RoomsService } from '../../../api';
import { BookingWithDetails } from '../../../types';
import { TabPanel } from '../../../components';
import SummaryCards from './complimentary/SummaryCards';
import ComplimentaryBookingsTable from './complimentary/ComplimentaryBookingsTable';
import GuestCreditsPanel from './complimentary/GuestCreditsPanel';
import {
  EditComplimentaryDialog,
  RemoveComplimentaryDialog,
} from './complimentary/BookingComplimentaryDialogs';
import {
  AddCreditDialog,
  EditCreditDialog,
  DeleteCreditDialog,
} from './complimentary/CreditDialogs';
import type {
  GuestCredit,
  ComplimentarySummary,
  GuestOption,
  RoomTypeOption,
} from './complimentary/types';

export default function ComplimentaryManagementPage() {
  const queryClient = useQueryClient();

  const complimentaryQuery = useQuery({
    queryKey: queryKeys.complimentary.list(),
    queryFn: async () => {
      const [bookingsData, creditsData, summaryData, guestsData, roomTypesData] = await Promise.all([
        BookingsService.getComplimentaryBookings(),
        BookingsService.getGuestsWithCredits(),
        BookingsService.getComplimentarySummary(),
        GuestsService.getAllGuests(),
        RoomsService.getRoomTypes(),
      ]);
      return {
        bookings: (bookingsData || []) as BookingWithDetails[],
        guestCredits: (creditsData?.credits || []) as GuestCredit[],
        summary: summaryData as ComplimentarySummary | null,
        guests: (guestsData || []) as GuestOption[],
        roomTypes: (roomTypesData || []) as RoomTypeOption[],
      };
    },
    staleTime: queryStaleTime.short,
  });

  const bookings = useMemo(
    () => complimentaryQuery.data?.bookings ?? [],
    [complimentaryQuery.data]
  );
  const guestCredits = complimentaryQuery.data?.guestCredits ?? [];
  const summary = complimentaryQuery.data?.summary ?? null;
  const loading = complimentaryQuery.isLoading;
  const queryError = complimentaryQuery.error as Error | null;
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const error = queryError && queryError.message !== dismissedError ? queryError.message : null;
  const setError = (value: string | null) => {
    if (value === null && queryError) setDismissedError(queryError.message);
  };
  const loadData = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.complimentary.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.guests.all });
  };

  // UI state
  const [tabValue, setTabValue] = useState(0);

  // Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);

  // Credit CRUD dialog state
  const [addCreditDialogOpen, setAddCreditDialogOpen] = useState(false);
  const [editCreditDialogOpen, setEditCreditDialogOpen] = useState(false);
  const [deleteCreditDialogOpen, setDeleteCreditDialogOpen] = useState(false);
  const [selectedCredit, setSelectedCredit] = useState<GuestCredit | null>(null);
  const guests = complimentaryQuery.data?.guests ?? [];
  const roomTypes = complimentaryQuery.data?.roomTypes ?? [];

  const handleEditClick = (booking: BookingWithDetails) => {
    setSelectedBooking(booking);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (booking: BookingWithDetails) => {
    setSelectedBooking(booking);
    setDeleteDialogOpen(true);
  };

  const handleEditCreditClick = (credit: GuestCredit) => {
    setSelectedCredit(credit);
    setEditCreditDialogOpen(true);
  };

  const handleDeleteCreditClick = (credit: GuestCredit) => {
    setSelectedCredit(credit);
    setDeleteCreditDialogOpen(true);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center' }}>
          <GiftIcon sx={{ mr: 1, fontSize: 32 }} />
          Complimentary Management
        </Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
        </Button>
      </Box>
      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {/* Summary Cards */}
      {summary && <SummaryCards summary={summary} />}
      {/* Tabs */}
      <Paper sx={{ mb: 2 }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label={`Complimentary Bookings (${bookings?.length || 0})`} />
          <Tab
            label={`Guest Credits (${guestCredits?.length || 0})`}
          />
        </Tabs>
      </Paper>
      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0} contentSx={{ pt: 2 }}>
        <ComplimentaryBookingsTable
          bookings={bookings}
          loading={loading}
          onEdit={handleEditClick}
          onRemove={handleDeleteClick}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={1} contentSx={{ pt: 2 }}>
        <GuestCreditsPanel
          credits={guestCredits}
          loading={loading}
          onAdd={() => setAddCreditDialogOpen(true)}
          onEdit={handleEditCreditClick}
          onDelete={handleDeleteCreditClick}
        />
      </TabPanel>
      {/* Booking complimentary dialogs */}
      <EditComplimentaryDialog
        open={editDialogOpen}
        booking={selectedBooking}
        onClose={() => setEditDialogOpen(false)}
        onCompleted={loadData}
      />
      <RemoveComplimentaryDialog
        open={deleteDialogOpen}
        booking={selectedBooking}
        onClose={() => setDeleteDialogOpen(false)}
        onCompleted={loadData}
      />
      {/* Credit CRUD dialogs */}
      <AddCreditDialog
        open={addCreditDialogOpen}
        guests={guests}
        roomTypes={roomTypes}
        onClose={() => setAddCreditDialogOpen(false)}
        onCompleted={loadData}
      />
      <EditCreditDialog
        open={editCreditDialogOpen}
        credit={selectedCredit}
        onClose={() => setEditCreditDialogOpen(false)}
        onCompleted={loadData}
      />
      <DeleteCreditDialog
        open={deleteCreditDialogOpen}
        credit={selectedCredit}
        onClose={() => setDeleteCreditDialogOpen(false)}
        onCompleted={loadData}
      />
    </Box>
  );
}
