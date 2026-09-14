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
import { formatStatusLabel } from '../../../utils/formatters';
import { dateFormatter } from '../../../i18n/format';
import { useTranslation } from '../../../i18n/useTranslation';
import { formatHotelDate } from '../../../utils/date';
import StatusChip from '../../../components/common/StatusChip';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';

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
  const { t } = useTranslation('nightAudit');
  const isPhone = useIsPhone();
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
        {t('journal.title')}
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
              bgcolor: 'var(--hotel-surface-sunken)',
              '&:hover': { bgcolor: 'var(--hotel-surface-sunken)' },
            }}
            onClick={() => toggleSection(section.entry_type)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton size="small" aria-label={expandedSections.has(section.entry_type) ? t('journal.collapseAria') : t('journal.expandAria')}>
                {expandedSections.has(section.entry_type) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
              <Typography variant="subtitle2" sx={{
                fontWeight: "bold"
              }}>
                {section.display_name}
              </Typography>
              <Chip label={t('journal.entries', { count: section.entries.length })} size="small" variant="outlined" />
            </Box>
            <Box sx={{ display: 'flex', gap: 3 }}>
              {Number(section.total_debit) > 0 && (
                <Typography variant="body2" sx={{
                  color: "error.main"
                }}>
                  <strong>{t('journal.debit')}</strong> {formatCurrency(Number(section.total_debit))}
                </Typography>
              )}
              {Number(section.total_credit) > 0 && (
                <Typography variant="body2" sx={{
                  color: "success.main"
                }}>
                  <strong>{t('journal.credit')}</strong> {formatCurrency(Number(section.total_credit))}
                </Typography>
              )}
            </Box>
          </Box>

          <Collapse in={expandedSections.has(section.entry_type)}>
            <Divider />
            {isPhone ? (
              <Box>
                {section.entries.map((entry, idx) => (
                  <Box
                    key={`${entry.booking_number}-${idx}`}
                    sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                  >
                    <MobileCardRow
                      title={entry.description || t('journal.entryFallback')}
                      subtitle={t('journal.roomLine', { booking: entry.booking_number, room: entry.room_number })}
                      meta={t('journal.drCr', {
                        debit: Number(entry.debit) > 0 ? formatCurrency(Number(entry.debit)) : '-',
                        credit: Number(entry.credit) > 0 ? formatCurrency(Number(entry.credit)) : '-',
                      })}
                    />
                  </Box>
                ))}
                <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <Typography variant="body2"><strong>{t('journal.total')}</strong></Typography>
                  <Typography variant="body2">
                    <strong>{t('journal.drCr', {
                      debit: Number(section.total_debit) > 0 ? formatCurrency(Number(section.total_debit)) : '-',
                      credit: Number(section.total_credit) > 0 ? formatCurrency(Number(section.total_credit)) : '-',
                    })}</strong>
                  </Typography>
                </Box>
              </Box>
            ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                    <TableCell><strong>{t('journal.colBooking')}</strong></TableCell>
                    <TableCell><strong>{t('journal.colRoom')}</strong></TableCell>
                    <TableCell><strong>{t('journal.colDescription')}</strong></TableCell>
                    <TableCell align="right"><strong>{t('journal.colDebit')}</strong></TableCell>
                    <TableCell align="right"><strong>{t('journal.colCredit')}</strong></TableCell>
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
                  <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                    <TableCell colSpan={3}><strong>{t('journal.total')}</strong></TableCell>
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
            )}
          </Collapse>
        </Paper>
      ))}
      {/* Grand Total */}
      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'primary.light' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{
            fontWeight: "bold"
          }}>{t('journal.grandTotal')}</Typography>
          <Box sx={{ display: 'flex', gap: 4 }}>
            <Typography variant="body1">
              <strong>{t('journal.totalDebit')}</strong> {formatCurrency(grandTotalDebit)}
            </Typography>
            <Typography variant="body1">
              <strong>{t('journal.totalCredit')}</strong> {formatCurrency(grandTotalCredit)}
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}

// Guest Ledger summary: one debit/credit row per journal account + totals (PDF page 2)
export function GuestLedgerSummary({ sections }: { sections: JournalSection[] }) {
  const { t } = useTranslation('nightAudit');
  if (!sections || sections.length === 0) {
    return null;
  }
  const totalDebit = sections.reduce((sum, s) => sum + Number(s.total_debit), 0);
  const totalCredit = sections.reduce((sum, s) => sum + Number(s.total_credit), 0);
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
        {t('ledger.title')}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell><strong>{t('ledger.colAccount')}</strong></TableCell>
              <TableCell align="right"><strong>{t('ledger.colDebits')}</strong></TableCell>
              <TableCell align="right"><strong>{t('ledger.colCredits')}</strong></TableCell>
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
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell><strong>{t('journal.total')}</strong></TableCell>
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
  const { t } = useTranslation('nightAudit');
  if (!bookings || bookings.length === 0) {
    return null;
  }
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
        {t('roomSold.title')}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell><strong>{t('roomSold.colRoom')}</strong></TableCell>
              <TableCell><strong>{t('roomSold.colType')}</strong></TableCell>
              <TableCell><strong>{t('roomSold.colGuest')}</strong></TableCell>
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
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell><strong>{t('roomSold.totalRow')}</strong></TableCell>
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

function RoomStatusChips({ rooms, label }: { rooms: RoomCounts; label: string }) {
  const { t } = useTranslation('nightAudit');
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mr: 1 }}>
        {label}
      </Typography>
      <Chip label={t('roomStatus.available', { count: rooms.available })} color="success" variant="outlined" size="small" />
      <Chip label={t('roomStatus.occupied', { count: rooms.occupied })} color="error" variant="outlined" size="small" />
      <Chip label={t('roomStatus.reserved', { count: rooms.reserved })} color="info" variant="outlined" size="small" />
      <Chip label={t('roomStatus.maintenance', { count: rooms.maintenance })} color="warning" variant="outlined" size="small" />
      <Chip label={t('roomStatus.dirty', { count: rooms.dirty })} variant="outlined" size="small" />
    </Box>
  );
}

function BreakdownTable({ title, items }: { title: string; items: RevenueBreakdownItem[] }) {
  const { t } = useTranslation('nightAudit');
  if (!items || items.length === 0) {
    return null;
  }
  const totalAmount = items.reduce((sum, i) => sum + Number(i.amount), 0);
  const totalCount = items.reduce((sum, i) => sum + i.count, 0);
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
            <TableCell><strong>{title}</strong></TableCell>
            <TableCell align="center"><strong>{t('breakdown.colBookings')}</strong></TableCell>
            <TableCell align="right"><strong>{t('breakdown.colAmount')}</strong></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.category} hover>
              <TableCell sx={{ textTransform: 'capitalize' }}>
                {formatStatusLabel(item.category)}
              </TableCell>
              <TableCell align="center">{item.count}</TableCell>
              <TableCell align="right">{formatCurrency(Number(item.amount))}</TableCell>
            </TableRow>
          ))}
          <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
            <TableCell><strong>{t('breakdown.total')}</strong></TableCell>
            <TableCell align="center"><strong>{totalCount}</strong></TableCell>
            <TableCell align="right"><strong>{formatCurrency(totalAmount)}</strong></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const getBookingStatusChip = (status: string) => (
  <StatusChip status={status} />
);

const formatAuditDate = (d: string) =>
  dateFormatter({ dateStyle: 'full' }).format(new Date(d + 'T00:00:00'));

// ---- Pending preview (audit not yet generated) ----

interface PendingPreviewViewProps {
  preview: NightAuditPreview;
  auditDate: string;
  running: boolean;
  onRun: () => void;
}

export function PendingPreviewView({ preview, auditDate, running, onRun }: PendingPreviewViewProps) {
  const { t, tOr } = useTranslation('nightAudit');
  const isPhone = useIsPhone();
  const occupancyPct = preview.room_snapshot.total > 0
    ? Math.round((preview.room_snapshot.occupied / preview.room_snapshot.total) * 100)
    : 0;
  const hasBreakdowns =
    preview.payment_method_breakdown.length > 0 || preview.booking_channel_breakdown.length > 0;

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
            {t('preview.title')}
          </Typography>
          <Chip label={t('status.notRunYet')} color="info" size="small" variant="outlined" />
        </Box>
        {/* Primary action lives in the header too — with a full preview below,
            the footer button rendered far under the fold. */}
        <Button
          variant="contained"
          color="primary"
          onClick={onRun}
          disabled={running || preview.total_unposted === 0}
          startIcon={running ? <CircularProgress size={16} color="inherit" /> : <RunIcon />}
        >
          {running ? t('actions.running') : t('actions.runNightAudit')}
        </Button>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {formatAuditDate(auditDate)}
      </Typography>

      {/* Key metrics */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<EventIcon />} color="primary.main" value={preview.total_unposted} label={t('preview.bookingsToPost')} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<MoneyIcon />} color="success.main" value={formatCurrency(Number(preview.estimated_revenue))} label={t('preview.estimatedRevenue')} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<HotelIcon />} color="info.main" value={`${preview.room_snapshot.occupied}/${preview.room_snapshot.total}`} label={t('preview.roomsOccupied')} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<TimeIcon />} color="warning.main" value={`${occupancyPct}%`} label={t('preview.occupancy')} />
        </Grid>
      </Grid>

      <RoomStatusChips rooms={preview.room_snapshot} label={t('roomStatus.auditDate')} />

      {/* Projected revenue breakdowns */}
      {hasBreakdowns && (
        <>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
            {t('preview.projected')}
          </Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <BreakdownTable title={t('preview.byPayment')} items={preview.payment_method_breakdown} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <BreakdownTable title={t('preview.byChannel')} items={preview.booking_channel_breakdown} />
            </Grid>
          </Grid>
        </>
      )}

      {/* Bookings to post */}
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
        {t('preview.toBePosted', { count: preview.unposted_bookings.length })}
      </Typography>
      {preview.unposted_bookings.length > 0 ? (
        isPhone ? (
          <Paper variant="outlined" sx={{ mb: 3 }}>
            {preview.unposted_bookings.map((booking: UnpostedBooking) => (
              <Box
                key={booking.booking_id}
                sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <MobileCardRow
                  title={booking.guest_name}
                  subtitle={t('journal.roomLine', { booking: booking.booking_number, room: booking.room_number })}
                  meta={`${formatHotelDate(booking.check_in_date)} → ${formatHotelDate(booking.check_out_date)} · ${formatCurrency(Number(booking.total_amount))}${booking.source ? ` · ${tOr(`bookings:channels.${booking.source}`, formatStatusLabel(booking.source))}` : ''}`}
                  status={getBookingStatusChip(booking.status)}
                />
              </Box>
            ))}
          </Paper>
        ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                <TableCell><strong>{t('preview.colBooking')}</strong></TableCell>
                <TableCell><strong>{t('preview.colGuest')}</strong></TableCell>
                <TableCell><strong>{t('preview.colRoom')}</strong></TableCell>
                <TableCell><strong>{t('preview.colCheckIn')}</strong></TableCell>
                <TableCell><strong>{t('preview.colCheckOut')}</strong></TableCell>
                <TableCell align="right"><strong>{t('preview.colAmount')}</strong></TableCell>
                <TableCell><strong>{t('preview.colStatus')}</strong></TableCell>
                <TableCell><strong>{t('preview.colChannel')}</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.unposted_bookings.map((booking: UnpostedBooking) => (
                <TableRow key={booking.booking_id} hover>
                  <TableCell>{booking.booking_number}</TableCell>
                  <TableCell>{booking.guest_name}</TableCell>
                  <TableCell>{booking.room_number}</TableCell>
                  <TableCell>{formatHotelDate(booking.check_in_date)}</TableCell>
                  <TableCell>{formatHotelDate(booking.check_out_date)}</TableCell>
                  <TableCell align="right">{formatCurrency(Number(booking.total_amount))}</TableCell>
                  <TableCell>{getBookingStatusChip(booking.status)}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>
                    {booking.source ? tOr(`bookings:channels.${booking.source}`, formatStatusLabel(booking.source)) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>{t('preview.noBookings')}</Alert>
      )}

      {/* What will post tonight */}
      {preview.journal_sections.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
            {t('preview.willPost')}
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
          {running ? t('actions.running') : t('actions.runNightAudit')}
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
  const { t } = useTranslation('nightAudit');
  const runAtFormatter = dateFormatter({ dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          {t('report.title')}
        </Typography>
        <Chip label={t('status.posted')} color="success" size="small" icon={<CheckIcon />} />
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {formatAuditDate(audit.audit_date)}
        {' · '}{t('report.completedLine', {
          time: runAtFormatter.format(new Date(audit.run_at)),
          name: audit.run_by_username || t('history.system'),
        })}
        {Number(audit.total_revenue) > 0 && ` · ${t('report.revenue', { amount: formatCurrency(Number(audit.total_revenue)) })}`}
      </Typography>

      {/* Actual results */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<EventIcon />} color="primary.main" value={audit.total_bookings_posted} label={t('report.bookingsPosted')} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<PersonIcon />} color="info.main" value={audit.total_checkins} label={t('report.checkins')} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<TimeIcon />} color="warning.main" value={audit.total_checkouts} label={t('report.checkouts')} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard icon={<HotelIcon />} color="success.main" value={`${Number(audit.occupancy_rate).toFixed(0)}%`} label={t('report.occupancy')} />
        </Grid>
      </Grid>

      <RoomStatusChips rooms={{
        available: audit.rooms_available,
        occupied: audit.rooms_occupied,
        reserved: audit.rooms_reserved,
        maintenance: audit.rooms_maintenance,
        dirty: audit.rooms_dirty,
      }} label={t('roomStatus.whenAudited')} />

      {audit.notes && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5, color: 'text.secondary' }}>
            {t('report.notes')}
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
          <Typography variant="body2" sx={{ ml: 1 }}>{t('actions.loadingJournal')}</Typography>
        </Box>
      ) : details ? (
        <>
          <JournalSectionsDisplay sections={details.journal_sections} />
          <GuestLedgerSummary sections={details.journal_sections} />
          <RoomSoldDetail bookings={details.posted_bookings} />
        </>
      ) : (
        <Button variant="text" size="small" onClick={onLoadDetails}>
          {t('actions.loadJournal')}
        </Button>
      )}

      <Divider sx={{ my: 3 }} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<PdfIcon />} onClick={onExportPDF}>
          {t('actions.exportPdf')}
        </Button>
        <Button size="small" variant="outlined" startIcon={<CsvIcon />} onClick={onExportCSV}>
          {t('actions.exportCsv')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          startIcon={<RefreshIcon />}
          onClick={onRerun}
          disabled={running}
        >
          {running ? t('actions.rerunning') : t('actions.rerun')}
        </Button>
      </Box>
    </Paper>
  );
}
