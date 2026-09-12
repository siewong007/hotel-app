import React, { useState } from 'react';
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
  Card,
  CardContent,
  Chip,
  Button,
  CircularProgress,
  Grid,
  Alert,
  Divider,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckIcon,
  Hotel as HotelIcon,
  AttachMoney as MoneyIcon,
  EventAvailable as EventIcon,
  AccessTime as TimeIcon,
  Person as PersonIcon,
  PictureAsPdf as PdfIcon,
  TableChart as CsvIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  KeyboardArrowUp as ExpandLessIcon,
} from '@mui/icons-material';
import {
  AuditDetailsResponse,
  JournalSection,
  NightAuditPreview,
  NightAuditRun,
  PostedBookingDetail,
  RevenueBreakdownItem,
  UnpostedBooking,
} from '../../../api';
import { formatCurrency } from '../../../utils/currency';
import { getHotelSettings } from '../../../utils/hotelSettings';

// Online bookings store source='online' and bury the channel name in booking_remarks
// (formatted as "<Channel> - Ref: <ref>" or "<Channel> Booking" by UnifiedBookingModal).
// Match by checking whether any configured channel name appears in either field.
export const channelAbbreviation = (b: PostedBookingDetail): string | undefined => {
  const configuredChannels = getHotelSettings().booking_channels.filter(c => c.abbreviation);
  const haystacks = [b.source ?? '', b.booking_remarks ?? ''].map(s => s.toLowerCase());
  for (const ch of configuredChannels) {
    const needle = ch.name.toLowerCase();
    if (haystacks.some(h => h.includes(needle))) return ch.abbreviation;
  }
  return undefined;
};

// Journal Sections Display Component
interface JournalSectionsDisplayProps {
  sections: JournalSection[];
}

export function JournalSectionsDisplay({ sections }: JournalSectionsDisplayProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (entryType: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(entryType)) {
        newSet.delete(entryType);
      } else {
        newSet.add(entryType);
      }
      return newSet;
    });
  };

  if (!sections || sections.length === 0) {
    return null;
  }

  // Calculate grand totals
  const grandTotalDebit = sections.reduce((sum, s) => sum + Number(s.total_debit), 0);
  const grandTotalCredit = sections.reduce((sum, s) => sum + Number(s.total_credit), 0);

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
        Journal Entries
      </Typography>
      {sections.map((section) => (
        <Paper key={section.entry_type} variant="outlined" sx={{ mb: 2 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1.5,
              cursor: 'pointer',
              bgcolor: 'grey.50',
              '&:hover': { bgcolor: 'grey.100' },
            }}
            onClick={() => toggleSection(section.entry_type)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton size="small">
                {expandedSections.has(section.entry_type) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
              <Typography variant="subtitle2" sx={{
                fontWeight: "bold"
              }}>
                {section.display_name}
              </Typography>
              <Chip label={`${section.entries.length} entries`} size="small" variant="outlined" />
            </Box>
            <Box sx={{ display: 'flex', gap: 3 }}>
              {Number(section.total_debit) > 0 && (
                <Typography variant="body2" sx={{
                  color: "error.main"
                }}>
                  <strong>Debit:</strong> {formatCurrency(Number(section.total_debit))}
                </Typography>
              )}
              {Number(section.total_credit) > 0 && (
                <Typography variant="body2" sx={{
                  color: "success.main"
                }}>
                  <strong>Credit:</strong> {formatCurrency(Number(section.total_credit))}
                </Typography>
              )}
            </Box>
          </Box>

          <Collapse in={expandedSections.has(section.entry_type)}>
            <Divider />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell><strong>Booking #</strong></TableCell>
                    <TableCell><strong>Room</strong></TableCell>
                    <TableCell><strong>Description</strong></TableCell>
                    <TableCell align="right"><strong>Debit</strong></TableCell>
                    <TableCell align="right"><strong>Credit</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {section.entries.map((entry, idx) => (
                    <TableRow key={`${entry.booking_number}-${idx}`} hover>
                      <TableCell>{entry.booking_number}</TableCell>
                      <TableCell>{entry.room_number}</TableCell>
                      <TableCell>{entry.description || '-'}</TableCell>
                      <TableCell align="right">
                        {Number(entry.debit) > 0 ? formatCurrency(Number(entry.debit)) : '-'}
                      </TableCell>
                      <TableCell align="right">
                        {Number(entry.credit) > 0 ? formatCurrency(Number(entry.credit)) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell colSpan={3}><strong>Total</strong></TableCell>
                    <TableCell align="right">
                      <strong>{Number(section.total_debit) > 0 ? formatCurrency(Number(section.total_debit)) : '-'}</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>{Number(section.total_credit) > 0 ? formatCurrency(Number(section.total_credit)) : '-'}</strong>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </Paper>
      ))}
      {/* Grand Total */}
      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'primary.light' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{
            fontWeight: "bold"
          }}>Grand Total</Typography>
          <Box sx={{ display: 'flex', gap: 4 }}>
            <Typography variant="body1">
              <strong>Total Debit:</strong> {formatCurrency(grandTotalDebit)}
            </Typography>
            <Typography variant="body1">
              <strong>Total Credit:</strong> {formatCurrency(grandTotalCredit)}
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}

// Guest Ledger summary: one debit/credit row per journal account + totals (PDF page 2)
export function GuestLedgerSummary({ sections }: { sections: JournalSection[] }) {
  if (!sections || sections.length === 0) {
    return null;
  }
  const totalDebit = sections.reduce((sum, s) => sum + Number(s.total_debit), 0);
  const totalCredit = sections.reduce((sum, s) => sum + Number(s.total_credit), 0);
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
        Guest Ledger
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell><strong>Account</strong></TableCell>
              <TableCell align="right"><strong>Debits</strong></TableCell>
              <TableCell align="right"><strong>Credits</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sections.map((s) => (
              <TableRow key={s.entry_type} hover>
                <TableCell>{s.display_name}</TableCell>
                <TableCell align="right">
                  {Number(s.total_debit) > 0 ? formatCurrency(Number(s.total_debit)) : '-'}
                </TableCell>
                <TableCell align="right">
                  {Number(s.total_credit) > 0 ? formatCurrency(Number(s.total_credit)) : '-'}
                </TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell><strong>Total</strong></TableCell>
              <TableCell align="right"><strong>{formatCurrency(totalDebit)}</strong></TableCell>
              <TableCell align="right"><strong>{formatCurrency(totalCredit)}</strong></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// Room Sold Detail by Date: room, type and guest per posted booking (PDF page 2)
export function RoomSoldDetail({ bookings }: { bookings: PostedBookingDetail[] }) {
  if (!bookings || bookings.length === 0) {
    return null;
  }
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
        Room Sold Detail by Date
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell><strong>Room</strong></TableCell>
              <TableCell><strong>Type</strong></TableCell>
              <TableCell><strong>Guest Name</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bookings.map((b) => {
              const abbr = channelAbbreviation(b);
              return (
                <TableRow key={b.booking_id} hover>
                  <TableCell>{b.room_number}</TableCell>
                  <TableCell>{b.room_type_code || b.room_type || ''}</TableCell>
                  <TableCell>{abbr ? `${b.guest_name} (${abbr})` : b.guest_name}</TableCell>
                </TableRow>
              );
            })}
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell><strong>Total Room Sold</strong></TableCell>
              <TableCell><strong>{bookings.length}</strong></TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ---- Shared report building blocks ----

interface StatCardProps {
  icon: React.ReactNode;
  color: string;
  value: React.ReactNode;
  label: string;
}

function StatCard({ icon, color, value, label }: StatCardProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
        <Box sx={{ color, mb: 0.5 }}>{icon}</Box>
        <Typography variant="h4" sx={{ fontWeight: 'bold' }}>{value}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      </CardContent>
    </Card>
  );
}

interface RoomCounts {
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  dirty: number;
}

function RoomStatusChips({ rooms }: { rooms: RoomCounts }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mr: 1 }}>
        Room Status
      </Typography>
      <Chip label={`${rooms.available} Available`} color="success" variant="outlined" size="small" />
      <Chip label={`${rooms.occupied} Occupied`} color="error" variant="outlined" size="small" />
      <Chip label={`${rooms.reserved} Reserved`} color="info" variant="outlined" size="small" />
      <Chip label={`${rooms.maintenance} Maintenance`} color="warning" variant="outlined" size="small" />
      <Chip label={`${rooms.dirty} Dirty`} variant="outlined" size="small" />
    </Box>
  );
}

function BreakdownTable({ title, items }: { title: string; items: RevenueBreakdownItem[] }) {
  if (!items || items.length === 0) {
    return null;
  }
  const totalAmount = items.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalCount = items.reduce((sum, i) => sum + i.count, 0);
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell><strong>{title}</strong></TableCell>
            <TableCell align="center"><strong>Bookings</strong></TableCell>
            <TableCell align="right"><strong>Amount</strong></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.category} hover>
              <TableCell sx={{ textTransform: 'capitalize' }}>
                {item.category.replace(/_/g, ' ')}
              </TableCell>
              <TableCell align="center">{item.count}</TableCell>
              <TableCell align="right">{formatCurrency(Number(item.amount))}</TableCell>
            </TableRow>
          ))}
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell><strong>Total</strong></TableCell>
            <TableCell align="center"><strong>{totalCount}</strong></TableCell>
            <TableCell align="right"><strong>{formatCurrency(totalAmount)}</strong></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const getBookingStatusChip = (status: string) => {
  const statusColors: Record<string, 'success' | 'warning' | 'info' | 'default'> = {
    checked_in: 'success',
    checked_out: 'info',
    reserved: 'warning',
    confirmed: 'info',
  };
  return (
    <Chip
      label={status.replace(/_/g, ' ')}
      color={statusColors[status] || 'default'}
      size="small"
      sx={{ textTransform: 'capitalize' }}
    />
  );
};

const formatAuditDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

// ---- Pending preview (audit not yet generated) ----

interface PendingPreviewViewProps {
  preview: NightAuditPreview;
  auditDate: string;
  running: boolean;
  onRun: () => void;
}

export function PendingPreviewView({ preview, auditDate, running, onRun }: PendingPreviewViewProps) {
  const occupancyPct = preview.room_snapshot.total > 0
    ? Math.round((preview.room_snapshot.occupied / preview.room_snapshot.total) * 100)
    : 0;
  const hasBreakdowns =
    preview.payment_method_breakdown.length > 0 || preview.booking_channel_breakdown.length > 0;

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          Night Audit Preview
        </Typography>
        <Chip label="Not run yet" color="info" size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {formatAuditDate(auditDate)}
      </Typography>

      {/* Key metrics */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<EventIcon />} color="primary.main" value={preview.total_unposted} label="Bookings to Post" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<MoneyIcon />} color="success.main" value={formatCurrency(Number(preview.estimated_revenue))} label="Estimated Revenue" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<HotelIcon />} color="info.main" value={`${preview.room_snapshot.occupied}/${preview.room_snapshot.total}`} label="Rooms Occupied" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<TimeIcon />} color="warning.main" value={`${occupancyPct}%`} label="Occupancy" />
        </Grid>
      </Grid>

      <RoomStatusChips rooms={preview.room_snapshot} />

      {/* Projected revenue breakdowns */}
      {hasBreakdowns && (
        <>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
            Projected Revenue
          </Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <BreakdownTable title="By Payment Method" items={preview.payment_method_breakdown} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <BreakdownTable title="By Channel" items={preview.booking_channel_breakdown} />
            </Grid>
          </Grid>
        </>
      )}

      {/* Bookings to post */}
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
        Bookings to be Posted ({preview.unposted_bookings.length})
      </Typography>
      {preview.unposted_bookings.length > 0 ? (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell><strong>Booking #</strong></TableCell>
                <TableCell><strong>Guest</strong></TableCell>
                <TableCell><strong>Room</strong></TableCell>
                <TableCell><strong>Check-in</strong></TableCell>
                <TableCell><strong>Check-out</strong></TableCell>
                <TableCell align="right"><strong>Amount</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>Channel</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.unposted_bookings.map((booking: UnpostedBooking) => (
                <TableRow key={booking.booking_id} hover>
                  <TableCell>{booking.booking_number}</TableCell>
                  <TableCell>{booking.guest_name}</TableCell>
                  <TableCell>{booking.room_number}</TableCell>
                  <TableCell>{new Date(booking.check_in_date + 'T00:00:00').toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(booking.check_out_date + 'T00:00:00').toLocaleDateString()}</TableCell>
                  <TableCell align="right">{formatCurrency(Number(booking.total_amount))}</TableCell>
                  <TableCell>{getBookingStatusChip(booking.status)}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>
                    {booking.source?.replace(/_/g, ' ') || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>No bookings to post for this date.</Alert>
      )}

      {/* What will post tonight */}
      {preview.journal_sections.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
            What will be posted tonight
          </Typography>
          <JournalSectionsDisplay sections={preview.journal_sections} />
          <GuestLedgerSummary sections={preview.journal_sections} />
        </>
      )}

      <Divider sx={{ my: 3 }} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          color="primary"
          size="large"
          onClick={onRun}
          disabled={running || preview.total_unposted === 0}
          startIcon={running ? <CircularProgress size={16} color="inherit" /> : <RunIcon />}
        >
          {running ? 'Running...' : 'Run Night Audit'}
        </Button>
      </Box>
    </Paper>
  );
}

// ---- Completed report (audit previously generated) ----

interface CompletedReportViewProps {
  audit: NightAuditRun;
  details: AuditDetailsResponse | undefined;
  detailsLoading: boolean;
  running: boolean;
  onLoadDetails: () => void;
  onExportPDF: () => void;
  onExportCSV: () => void;
  onRerun: () => void;
}

export function CompletedReportView({
  audit,
  details,
  detailsLoading,
  running,
  onLoadDetails,
  onExportPDF,
  onExportCSV,
  onRerun,
}: CompletedReportViewProps) {
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          Night Audit Report
        </Typography>
        <Chip label="Posted" color="success" size="small" icon={<CheckIcon />} />
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {formatAuditDate(audit.audit_date)}
        {' · '}Completed at {new Date(audit.run_at).toLocaleString()} by {audit.run_by_username || 'System'}
        {Number(audit.total_revenue) > 0 && ` · Revenue ${formatCurrency(Number(audit.total_revenue))}`}
      </Typography>

      {/* Actual results */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<EventIcon />} color="primary.main" value={audit.total_bookings_posted} label="Bookings Posted" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<PersonIcon />} color="info.main" value={audit.total_checkins} label="Check-ins" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<TimeIcon />} color="warning.main" value={audit.total_checkouts} label="Check-outs" />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<HotelIcon />} color="success.main" value={`${Number(audit.occupancy_rate).toFixed(0)}%`} label="Occupancy" />
        </Grid>
      </Grid>

      <RoomStatusChips rooms={{
        available: audit.rooms_available,
        occupied: audit.rooms_occupied,
        reserved: audit.rooms_reserved,
        maintenance: audit.rooms_maintenance,
        dirty: audit.rooms_dirty,
      }} />

      {audit.notes && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5, color: 'text.secondary' }}>
            Notes
          </Typography>
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.paper' }}>
            <Typography variant="body2">{audit.notes}</Typography>
          </Paper>
        </Box>
      )}

      {/* Posted journal + ledger sections */}
      {detailsLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
          <Typography variant="body2" sx={{ ml: 1 }}>Loading journal entries...</Typography>
        </Box>
      ) : details ? (
        <>
          <JournalSectionsDisplay sections={details.journal_sections} />
          <GuestLedgerSummary sections={details.journal_sections} />
          <RoomSoldDetail bookings={details.posted_bookings} />
        </>
      ) : (
        <Button variant="text" size="small" onClick={onLoadDetails}>
          Load Journal Entries
        </Button>
      )}

      <Divider sx={{ my: 3 }} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<PdfIcon />} onClick={onExportPDF}>
          Export PDF
        </Button>
        <Button size="small" variant="outlined" startIcon={<CsvIcon />} onClick={onExportCSV}>
          Export CSV
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          startIcon={<RefreshIcon />}
          onClick={onRerun}
          disabled={running}
        >
          {running ? 'Rerunning...' : 'Rerun Audit'}
        </Button>
      </Box>
    </Paper>
  );
}
