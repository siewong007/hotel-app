import React, { useEffect, useState, useCallback } from 'react';
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
  TextField,
  CircularProgress,
  Grid,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tabs,
  Tab,
  Tooltip,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Hotel as HotelIcon,
  AttachMoney as MoneyIcon,
  EventAvailable as EventIcon,
  MeetingRoom as RoomIcon,
  Info as InfoIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  KeyboardArrowUp as ExpandLessIcon,
  AccessTime as TimeIcon,
  Person as PersonIcon,
  PictureAsPdf as PdfIcon,
  TableChart as CsvIcon,
} from '@mui/icons-material';
import { NightAuditService, NightAuditPreview, NightAuditRun, UnpostedBooking } from '../../../api';
import { formatCurrency } from '../../../utils/currency';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

const NightAuditPage: React.FC = () => {
  // State
  const [tabValue, setTabValue] = useState(0);
  const [auditDate, setAuditDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [preview, setPreview] = useState<NightAuditPreview | null>(null);
  const [auditHistory, setAuditHistory] = useState<NightAuditRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Confirmation dialog
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [auditNotes, setAuditNotes] = useState('');

  // Expanded rows in history
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRowExpansion = (auditId: number) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(auditId)) {
        newSet.delete(auditId);
      } else {
        newSet.add(auditId);
      }
      return newSet;
    });
  };

  // Export single audit to CSV with booking details
  const exportAuditToCSV = async (audit: NightAuditRun) => {
    try {
      // Fetch full audit details including bookings
      const details = await NightAuditService.getAuditDetails(audit.id);
      const bookings = details.posted_bookings;

      // Build CSV content
      const lines: string[] = [];

      // Header section
      lines.push('NIGHT AUDIT REPORT');
      lines.push(`Audit Date,${new Date(audit.audit_date + 'T00:00:00').toLocaleDateString()}`);
      lines.push(`Run At,${new Date(audit.run_at).toLocaleString()}`);
      lines.push(`Run By,${audit.run_by_username || 'System'}`);
      lines.push(`Status,${audit.status}`);
      lines.push('');

      // Summary statistics
      lines.push('SUMMARY STATISTICS');
      lines.push(`Bookings Posted,${audit.total_bookings_posted}`);
      lines.push(`Check-ins,${audit.total_checkins}`);
      lines.push(`Check-outs,${audit.total_checkouts}`);
      lines.push(`Total Revenue,${formatCurrency(audit.total_revenue)}`);
      lines.push(`Occupancy Rate,${Number(audit.occupancy_rate).toFixed(1)}%`);
      if (audit.notes) {
        lines.push(`Notes,"${audit.notes.replace(/"/g, '""')}"`);
      }
      lines.push('');

      // Booking details
      lines.push('POSTED BOOKINGS');
      lines.push('Booking #,Guest Name,Room,Room Type,Check-in,Check-out,Nights,Status,Amount,Payment Method,Payment Status,Channel');

      bookings.forEach(booking => {
        lines.push([
          booking.booking_number,
          `"${booking.guest_name.replace(/"/g, '""')}"`,
          booking.room_number,
          booking.room_type,
          new Date(booking.check_in_date + 'T00:00:00').toLocaleDateString(),
          new Date(booking.check_out_date + 'T00:00:00').toLocaleDateString(),
          booking.nights,
          booking.status,
          formatCurrency(booking.total_amount),
          booking.payment_method || 'N/A',
          booking.payment_status || 'N/A',
          booking.source || 'N/A'
        ].join(','));
      });

      lines.push('');
      lines.push(`Total Bookings,${bookings.length}`);
      lines.push(`Total Revenue,${formatCurrency(bookings.reduce((sum, b) => sum + Number(b.total_amount), 0))}`);

      const csvContent = lines.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `night_audit_${audit.audit_date}.csv`;
      link.click();
    } catch (err) {
      console.error('Failed to export audit to CSV:', err);
      setError('Failed to export audit. Please try again.');
    }
  };

  // Export single audit to PDF with booking details using jsPDF
  const exportAuditToPDF = async (audit: NightAuditRun) => {
    try {
      // Fetch full audit details including bookings
      const details = await NightAuditService.getAuditDetails(audit.id);
      const bookings = details.posted_bookings;

      // Dynamic import of jspdf and jspdf-autotable
      const jspdfModule = await import('jspdf');
      const jsPDF = jspdfModule.jsPDF || jspdfModule.default;
      const autoTableModule = await import('jspdf-autotable');
      const autoTable = autoTableModule.default;

      // Create PDF in landscape for better table fit
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Header
      doc.setFontSize(20);
      doc.setTextColor(25, 118, 210);
      doc.text('Night Audit Report', 14, 18);

      // Audit info
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      const auditDateFormatted = new Date(audit.audit_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      doc.text(`Audit Date: ${auditDateFormatted}`, 14, 26);
      doc.text(`Status: ${audit.status.toUpperCase()}`, 14, 32);
      doc.text(`Run At: ${new Date(audit.run_at).toLocaleString()}`, pageWidth / 2, 26);
      doc.text(`Run By: ${audit.run_by_username || 'System'}`, pageWidth / 2, 32);

      // Summary Statistics - simple text format
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Summary Statistics', 14, 44);

      doc.setFontSize(10);
      const stats = [
        `Bookings Posted: ${audit.total_bookings_posted}`,
        `Check-ins: ${audit.total_checkins}`,
        `Check-outs: ${audit.total_checkouts}`,
        `Total Revenue: ${formatCurrency(audit.total_revenue)}`,
        `Occupancy Rate: ${Number(audit.occupancy_rate).toFixed(1)}%`,
      ];
      doc.text(stats.join('    |    '), 14, 52);

      // Room Snapshot
      doc.setFontSize(12);
      doc.text('Room Status Snapshot', 14, 64);
      doc.setFontSize(10);
      const roomStats = [
        `Available: ${audit.rooms_available}`,
        `Occupied: ${audit.rooms_occupied}`,
        `Reserved: ${audit.rooms_reserved}`,
        `Maintenance: ${audit.rooms_maintenance}`,
        `Dirty: ${audit.rooms_dirty}`,
      ];
      doc.text(roomStats.join('    |    '), 14, 72);

      // Posted Bookings Table
      doc.setFontSize(12);
      doc.text(`Posted Bookings (${bookings.length})`, 14, 84);

      const tableData = bookings.map(booking => [
        booking.booking_number,
        booking.guest_name,
        booking.room_number,
        booking.room_type,
        new Date(booking.check_in_date + 'T00:00:00').toLocaleDateString(),
        new Date(booking.check_out_date + 'T00:00:00').toLocaleDateString(),
        booking.nights.toString(),
        booking.status.replace(/_/g, ' '),
        formatCurrency(booking.total_amount),
        booking.payment_method?.replace(/_/g, ' ') || '-',
        booking.payment_status || '-',
        booking.source || '-',
      ]);

      // Add total row
      const totalAmount = bookings.reduce((sum, b) => sum + Number(b.total_amount), 0);
      tableData.push(['', '', '', '', '', '', '', 'TOTAL:', formatCurrency(totalAmount), '', '', '']);

      autoTable(doc, {
        startY: 88,
        head: [['Booking #', 'Guest', 'Room', 'Type', 'Check-in', 'Check-out', 'Nights', 'Status', 'Amount', 'Payment', 'Pay Status', 'Channel']],
        body: tableData,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [66, 66, 66], textColor: [255, 255, 255] },
        didParseCell: (data: any) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [240, 240, 240];
          }
        },
      });

      let currentY = (doc as any).lastAutoTable.finalY + 10;

      // Notes
      if (audit.notes) {
        if (currentY > pageHeight - 40) {
          doc.addPage();
          currentY = 20;
        }
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text('Notes', 14, currentY);
        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        const splitNotes = doc.splitTextToSize(audit.notes, pageWidth - 28);
        doc.text(splitNotes, 14, currentY + 6);
      }

      // Footer on all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Audit ID: #${audit.id} | Generated: ${new Date().toLocaleString()} | Page ${i} of ${totalPages}`,
          14,
          pageHeight - 10
        );
      }

      // Save the PDF
      doc.save(`night_audit_${audit.audit_date}.pdf`);
    } catch (err: any) {
      console.error('Failed to export audit to PDF:', err);
      setError(`Failed to export audit: ${err.message || 'Unknown error'}`);
    }
  };

  // Fetch preview
  const fetchPreview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await NightAuditService.getPreview(auditDate);
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch preview');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [auditDate]);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const data = await NightAuditService.listNightAudits(1, 50);
      setAuditHistory(data);
    } catch (err) {
      console.error('Failed to fetch audit history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Run night audit
  const handleRunAudit = async () => {
    try {
      setRunning(true);
      setError(null);
      setConfirmDialogOpen(false);

      const response = await NightAuditService.runNightAudit({
        audit_date: auditDate,
        notes: auditNotes || undefined,
      });

      setSuccess(response.message);
      setAuditNotes('');

      // Refresh data
      await Promise.all([fetchPreview(), fetchHistory()]);
    } catch (err: any) {
      setError(err.message || 'Failed to run night audit');
    } finally {
      setRunning(false);
    }
  };

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'completed':
        return <Chip label="Completed" color="success" size="small" icon={<CheckIcon />} />;
      case 'failed':
        return <Chip label="Failed" color="error" size="small" icon={<WarningIcon />} />;
      case 'in_progress':
        return <Chip label="In Progress" color="warning" size="small" />;
      default:
        return <Chip label={status} size="small" />;
    }
  };

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

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Night Audit
        </Typography>
        <IconButton onClick={() => { fetchPreview(); fetchHistory(); }}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 2 }}>
        <Tab label="Run Audit" />
        <Tab label="Audit History" />
      </Tabs>

      {/* Tab 1: Run Audit */}
      <TabPanel value={tabValue} index={0}>
        {/* Date Selector */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <TextField
                  label="Audit Date"
                  type="date"
                  value={auditDate}
                  onChange={(e) => setAuditDate(e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <Button
                  variant="outlined"
                  onClick={fetchPreview}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
                >
                  Load Preview
                </Button>
              </Grid>
              <Grid item xs={12} md={4}>
                {preview && !preview.already_run && (
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => setConfirmDialogOpen(true)}
                    disabled={running || preview.total_unposted === 0}
                    startIcon={running ? <CircularProgress size={16} color="inherit" /> : <RunIcon />}
                  >
                    Run Night Audit
                  </Button>
                )}
                {preview?.already_run && (
                  <Chip
                    label="Audit Already Completed"
                    color="success"
                    icon={<CheckIcon />}
                  />
                )}
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : preview ? (
          <>
            {/* Report Preview */}
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h5" sx={{ mb: 1, fontWeight: 'bold' }}>
                Night Audit Report Preview
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {new Date(auditDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })}
              </Typography>

              {preview.already_run ? (
                // Completed Audit Report
                (() => {
                  const normalizeDate = (d: string) => d.split('T')[0];
                  const completedAudit = auditHistory.find(a => normalizeDate(a.audit_date) === normalizeDate(auditDate));
                  if (completedAudit) {
                    return (
                      <>
                        <Alert severity="success" sx={{ mb: 3 }} icon={<CheckIcon />}>
                          Audit completed at {new Date(completedAudit.run_at).toLocaleString()} by {completedAudit.run_by_username || 'System'}
                        </Alert>

                        {/* Summary Row */}
                        <Grid container spacing={2} sx={{ mb: 3 }}>
                          <Grid item xs={6} sm={2.4}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'primary.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{completedAudit.total_bookings_posted}</Typography>
                              <Typography variant="body2">Bookings Posted</Typography>
                            </Box>
                          </Grid>
                          <Grid item xs={6} sm={2.4}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'success.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{formatCurrency(completedAudit.total_revenue)}</Typography>
                              <Typography variant="body2">Total Revenue</Typography>
                            </Box>
                          </Grid>
                          <Grid item xs={6} sm={2.4}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{completedAudit.total_checkins}</Typography>
                              <Typography variant="body2">Check-ins</Typography>
                            </Box>
                          </Grid>
                          <Grid item xs={6} sm={2.4}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{completedAudit.total_checkouts}</Typography>
                              <Typography variant="body2">Check-outs</Typography>
                            </Box>
                          </Grid>
                          <Grid item xs={6} sm={2.4}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.200', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{Number(completedAudit.occupancy_rate).toFixed(0)}%</Typography>
                              <Typography variant="body2">Occupancy</Typography>
                            </Box>
                          </Grid>
                        </Grid>

                        {/* Room Status */}
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Room Status at Audit Time</Typography>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                          <Chip label={`${completedAudit.rooms_available} Available`} color="success" variant="outlined" />
                          <Chip label={`${completedAudit.rooms_occupied} Occupied`} color="error" variant="outlined" />
                          <Chip label={`${completedAudit.rooms_reserved} Reserved`} color="info" variant="outlined" />
                          <Chip label={`${completedAudit.rooms_maintenance} Maintenance`} color="warning" variant="outlined" />
                          <Chip label={`${completedAudit.rooms_dirty} Dirty`} variant="outlined" />
                        </Box>

                        {/* Export Buttons */}
                        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PdfIcon />}
                            onClick={() => exportAuditToPDF(completedAudit)}
                          >
                            Export PDF
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<CsvIcon />}
                            onClick={() => exportAuditToCSV(completedAudit)}
                          >
                            Export CSV
                          </Button>
                        </Box>
                      </>
                    );
                  }
                  return <Alert severity="success">Night audit completed. Check History tab for details.</Alert>;
                })()
              ) : (
                // Pending Audit Preview
                <>
                  {/* Summary Row */}
                  <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={6} sm={2.4}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'primary.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{preview.total_unposted}</Typography>
                        <Typography variant="body2">Bookings to Post</Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'success.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{formatCurrency(preview.estimated_revenue)}</Typography>
                        <Typography variant="body2">Estimated Revenue</Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{preview.room_snapshot.occupied}</Typography>
                        <Typography variant="body2">Occupied Rooms</Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{preview.room_snapshot.available}</Typography>
                        <Typography variant="body2">Available Rooms</Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.200', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">
                          {preview.room_snapshot.total > 0
                            ? Math.round((preview.room_snapshot.occupied / preview.room_snapshot.total) * 100)
                            : 0}%
                        </Typography>
                        <Typography variant="body2">Occupancy</Typography>
                      </Box>
                    </Grid>
                  </Grid>

                  {/* Bookings Table */}
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Bookings to be Posted ({preview.unposted_bookings.length})
                  </Typography>
                  {preview.unposted_bookings.length > 0 ? (
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ bgcolor: 'grey.100' }}>
                            <TableCell><strong>Booking #</strong></TableCell>
                            <TableCell><strong>Guest</strong></TableCell>
                            <TableCell><strong>Room</strong></TableCell>
                            <TableCell><strong>Check-in</strong></TableCell>
                            <TableCell><strong>Check-out</strong></TableCell>
                            <TableCell><strong>Status</strong></TableCell>
                            <TableCell><strong>Channel</strong></TableCell>
                            <TableCell align="right"><strong>Amount</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {preview.unposted_bookings.map((booking: UnpostedBooking) => (
                            <TableRow key={booking.booking_id} hover>
                              <TableCell>{booking.booking_number}</TableCell>
                              <TableCell>{booking.guest_name}</TableCell>
                              <TableCell>{booking.room_number}</TableCell>
                              <TableCell>{new Date(booking.check_in_date).toLocaleDateString()}</TableCell>
                              <TableCell>{new Date(booking.check_out_date).toLocaleDateString()}</TableCell>
                              <TableCell>{getBookingStatusChip(booking.status)}</TableCell>
                              <TableCell sx={{ textTransform: 'capitalize' }}>
                                {booking.source?.replace(/_/g, ' ') || '-'}
                              </TableCell>
                              <TableCell align="right">{formatCurrency(booking.total_amount)}</TableCell>
                            </TableRow>
                          ))}
                          {/* Total Row */}
                          <TableRow sx={{ bgcolor: 'grey.50' }}>
                            <TableCell colSpan={7} align="right"><strong>Total Revenue:</strong></TableCell>
                            <TableCell align="right">
                              <strong>{formatCurrency(preview.estimated_revenue)}</strong>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Alert severity="info">No bookings to post for this date.</Alert>
                  )}
                </>
              )}
            </Paper>
          </>
        ) : null}
      </TabPanel>

      {/* Tab 2: Audit History */}
      <TabPanel value={tabValue} index={1}>
        {historyLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : auditHistory.length > 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {auditHistory.map((audit) => (
              <Card key={audit.id} variant="outlined">
                {/* Audit Header - Clickable */}
                <CardContent
                  sx={{
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    py: 1.5,
                  }}
                  onClick={() => toggleRowExpansion(audit.id)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <IconButton size="small">
                      {expandedRows.has(audit.id) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                    <Box>
                      <Typography variant="h6" component="span">
                        {new Date(audit.audit_date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <TimeIcon fontSize="small" />
                          {new Date(audit.run_at).toLocaleString()}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PersonIcon fontSize="small" />
                          {audit.run_by_username || 'System'}
                        </Typography>
                        {getStatusChip(audit.status)}
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mr: 2 }}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" color="primary">{audit.total_bookings_posted}</Typography>
                      <Typography variant="caption" color="text.secondary">Bookings</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" color="success.main">{formatCurrency(audit.total_revenue)}</Typography>
                      <Typography variant="caption" color="text.secondary">Revenue</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h5" color="info.main">{Number(audit.occupancy_rate).toFixed(0)}%</Typography>
                      <Typography variant="caption" color="text.secondary">Occupancy</Typography>
                    </Box>
                  </Box>
                </CardContent>

                {/* Expanded Report Details */}
                <Collapse in={expandedRows.has(audit.id)}>
                  <Divider />
                  <CardContent sx={{ bgcolor: 'grey.50' }}>
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
                      Night Audit Report - {new Date(audit.audit_date + 'T00:00:00').toLocaleDateString()}
                    </Typography>

                    {/* Booking Statistics */}
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                      Booking Statistics
                    </Typography>
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                      <Grid item xs={6} sm={3}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="primary">{audit.total_bookings_posted}</Typography>
                            <Typography variant="body2" color="text.secondary">Bookings Posted</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="success.main">{audit.total_checkins}</Typography>
                            <Typography variant="body2" color="text.secondary">Check-ins</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="warning.main">{audit.total_checkouts}</Typography>
                            <Typography variant="body2" color="text.secondary">Check-outs</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={6} sm={3}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="info.main">{formatCurrency(audit.total_revenue)}</Typography>
                            <Typography variant="body2" color="text.secondary">Total Revenue</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>

                    {/* Room Snapshot */}
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                      Room Snapshot at Audit Time
                    </Typography>
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                      <Grid item xs={4} sm={2}>
                        <Card sx={{ bgcolor: 'success.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_available}</Typography>
                            <Typography variant="caption">Available</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={4} sm={2}>
                        <Card sx={{ bgcolor: 'error.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_occupied}</Typography>
                            <Typography variant="caption">Occupied</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={4} sm={2}>
                        <Card sx={{ bgcolor: 'info.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_reserved}</Typography>
                            <Typography variant="caption">Reserved</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={4} sm={2}>
                        <Card sx={{ bgcolor: 'warning.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_maintenance}</Typography>
                            <Typography variant="caption">Maintenance</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={4} sm={2}>
                        <Card sx={{ bgcolor: 'grey.300' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_dirty}</Typography>
                            <Typography variant="caption">Dirty</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={4} sm={2}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5" color="primary">{Number(audit.occupancy_rate).toFixed(1)}%</Typography>
                            <Typography variant="caption">Occupancy</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>

                    {/* Notes */}
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

                    {/* Audit Info & Export Buttons */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                      <Box sx={{ display: 'flex', gap: 3, color: 'text.secondary', fontSize: '0.875rem' }}>
                        <Typography variant="body2">
                          <strong>Audit ID:</strong> #{audit.id}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Created:</strong> {new Date(audit.created_at).toLocaleString()}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<PdfIcon />}
                          onClick={(e) => {
                            e.stopPropagation();
                            exportAuditToPDF(audit);
                          }}
                        >
                          Export PDF
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CsvIcon />}
                          onClick={(e) => {
                            e.stopPropagation();
                            exportAuditToCSV(audit);
                          }}
                        >
                          Export CSV
                        </Button>
                      </Box>
                    </Box>
                  </CardContent>
                </Collapse>
              </Card>
            ))}
          </Box>
        ) : (
          <Alert severity="info">No audit history available.</Alert>
        )}
      </TabPanel>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onClose={() => setConfirmDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm Night Audit</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            You are about to run the night audit for <strong>{new Date(auditDate).toLocaleDateString()}</strong>.
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This action will:
            <ul>
              <li>Mark {preview?.total_unposted || 0} bookings as posted</li>
              <li>Lock these bookings from further editing</li>
              <li>Record room status snapshot for reporting</li>
            </ul>
            This action cannot be undone.
          </Alert>
          <TextField
            label="Notes (Optional)"
            multiline
            rows={3}
            value={auditNotes}
            onChange={(e) => setAuditNotes(e.target.value)}
            fullWidth
            placeholder="Add any notes about this audit run..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleRunAudit}
            disabled={running}
            startIcon={running ? <CircularProgress size={16} color="inherit" /> : <RunIcon />}
          >
            Run Audit
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NightAuditPage;
