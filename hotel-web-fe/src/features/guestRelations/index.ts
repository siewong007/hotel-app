// Guest Relations feature barrel — the guest 360 workspace feature. The list
// page decomposes the legacy features/guests GuestConfigurationPage monolith;
// route wiring lands in Task 16.
export { default as GuestRelationsPage } from './pages/GuestRelationsPage';
export { default as GuestProfilePage } from './pages/GuestProfilePage';
export { default as GuestFormDialog } from './components/GuestFormDialog';
export { default as GuestListTable } from './components/GuestListTable';
export { default as GuestSegmentChips } from './components/GuestSegmentChips';
export { default as GuestBookingHistoryDialog } from './components/GuestBookingHistoryDialog';
export { default as GuestCreditsDialog } from './components/GuestCreditsDialog';
export { default as GuestPortalAccountDialog } from './components/GuestPortalAccountDialog';
export { default as GuestProfileHeader } from './components/GuestProfileHeader';
export { default as OpenSupportDialog } from './components/OpenSupportDialog';
export { useGuestStatTotals } from './hooks/useGuestStatTotals';
export * from './hooks/useGuestRelationsQueries';
export * from './segments';
