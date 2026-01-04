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
  People as PeopleIcon,
  AttachMoney as MoneyIcon,
  EventAvailable as EventIcon,
  MeetingRoom as RoomIcon,
  Info as InfoIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  KeyboardArrowUp as ExpandLessIcon,
  CalendarToday as CalendarIcon,
  AccessTime as TimeIcon,
  Person as PersonIcon,
  PictureAsPdf as PdfIcon,
  TableChart as CsvIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { NightAuditService, NightAuditPreview, NightAuditRun, UnpostedBooking, PostedBookingDetail } from '../../../api';
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
      lines.push('Booking #,Guest Name,Room,Room Type,Check-in,Check-out,Nights,Status,Amount,Payment Status,Source');

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

  // Export single audit to PDF with booking details
  const exportAuditToPDF = async (audit: NightAuditRun) => {
    try {
      // Fetch full audit details including bookings
      const details = await NightAuditService.getAuditDetails(audit.id);
      const bookings = details.posted_bookings;

      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      // Generate booking rows HTML
      const bookingRows = bookings.map(booking => `
        <tr>
          <td>${booking.booking_number}</td>
          <td>${booking.guest_name}</td>
          <td>${booking.room_number}</td>
          <td>${booking.room_type}</td>
          <td>${new Date(booking.check_in_date + 'T00:00:00').toLocaleDateString()}</td>
          <td>${new Date(booking.check_out_date + 'T00:00:00').toLocaleDateString()}</td>
          <td style="text-align: center;">${booking.nights}</td>
          <td><span class="status-badge status-${booking.status}">${booking.status.replace('_', ' ')}</span></td>
          <td style="text-align: right;">${formatCurrency(booking.total_amount)}</td>
          <td>${booking.payment_status || '-'}</td>
          <td>${booking.source || '-'}</td>
        </tr>
      `).join('');

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Night Audit Report - ${audit.audit_date}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; font-size: 12px; }
            h1 { color: #1976d2; border-bottom: 2px solid #1976d2; padding-bottom: 10px; margin-bottom: 20px; }
            h2 { color: #333; margin-top: 25px; border-bottom: 1px solid #ddd; padding-bottom: 5px; font-size: 16px; }
            .header-info { display: flex; justify-content: space-between; margin-bottom: 15px; color: #666; }
            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; }
            .stat-card { border: 1px solid #ddd; border-radius: 6px; padding: 12px; text-align: center; }
            .stat-value { font-size: 22px; font-weight: bold; color: #1976d2; }
            .stat-label { font-size: 11px; color: #666; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
            th { background: #f5f5f5; padding: 8px 6px; text-align: left; border-bottom: 2px solid #ddd; font-weight: 600; }
            td { padding: 6px; border-bottom: 1px solid #eee; }
            tr:hover { background: #fafafa; }
            .status-badge { padding: 2px 6px; border-radius: 3px; font-size: 10px; text-transform: uppercase; }
            .status-checked_in { background: #c8e6c9; color: #2e7d32; }
            .status-checked_out { background: #ffecb3; color: #f57c00; }
            .status-reserved { background: #b3e5fc; color: #0277bd; }
            .status-confirmed { background: #e1bee7; color: #7b1fa2; }
            .summary-row { font-weight: bold; background: #f5f5f5; }
            .notes { background: #f5f5f5; padding: 12px; border-radius: 4px; margin-top: 15px; }
            .footer { margin-top: 25px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; }
            @media print {
              body { padding: 10px; }
              .page-break { page-break-before: always; }
            }
          </style>
        </head>
        <body>
          <h1>Night Audit Report</h1>
          <div class="header-info">
            <div>
              <strong>Audit Date:</strong> ${new Date(audit.audit_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            <div>
              <strong>Status:</strong> ${audit.status.toUpperCase()}
            </div>
          </div>
          <div class="header-info">
            <div><strong>Run At:</strong> ${new Date(audit.run_at).toLocaleString()}</div>
            <div><strong>Run By:</strong> ${audit.run_by_username || 'System'}</div>
          </div>

          <h2>Summary Statistics</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">${audit.total_bookings_posted}</div>
              <div class="stat-label">Bookings Posted</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color: #4caf50;">${audit.total_checkins}</div>
              <div class="stat-label">Check-ins</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color: #ff9800;">${audit.total_checkouts}</div>
              <div class="stat-label">Check-outs</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color: #2196f3;">${formatCurrency(audit.total_revenue)}</div>
              <div class="stat-label">Total Revenue</div>
            </div>
          </div>

          <h2>Posted Bookings (${bookings.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Booking #</th>
                <th>Guest Name</th>
                <th>Room</th>
                <th>Room Type</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Nights</th>
                <th>Status</th>
                <th style="text-align: right;">Amount</th>
                <th>Payment</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              ${bookingRows}
              <tr class="summary-row">
                <td colspan="8" style="text-align: right;"><strong>Total:</strong></td>
                <td style="text-align: right;"><strong>${formatCurrency(bookings.reduce((sum, b) => sum + Number(b.total_amount), 0))}</strong></td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>

          ${audit.notes ? `
          <h2>Notes</h2>
          <div class="notes">${audit.notes}</div>
          ` : ''}

          <div class="footer">
            <div>Audit ID: #${audit.id} | Generated: ${new Date().toLocaleString()}</div>
          </div>
        </body>
        </html>
      `;

      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    } catch (err) {
      console.error('Failed to export audit to PDF:', err);
      setError('Failed to export audit. Please try again.');
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
            {/* Room Snapshot */}
            <Typography variant="h6" sx={{ mb: 2 }}>Room Snapshot</Typography>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={6} sm={4} md={2}>
                <Card>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <RoomIcon color="primary" />
                    <Typography variant="h5">{preview.room_snapshot.total}</Typography>
                    <Typography variant="body2" color="text.secondary">Total Rooms</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <Card sx={{ bgcolor: 'success.light' }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5">{preview.room_snapshot.available}</Typography>
                    <Typography variant="body2">Available</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <Card sx={{ bgcolor: 'error.light' }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5">{preview.room_snapshot.occupied}</Typography>
                    <Typography variant="body2">Occupied</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <Card sx={{ bgcolor: 'info.light' }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5">{preview.room_snapshot.reserved}</Typography>
                    <Typography variant="body2">Reserved</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <Card sx={{ bgcolor: 'warning.light' }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5">{preview.room_snapshot.maintenance}</Typography>
                    <Typography variant="body2">Maintenance</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <Card sx={{ bgcolor: 'grey.300' }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5">{preview.room_snapshot.dirty}</Typography>
                    <Typography variant="body2">Dirty</Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Summary Stats */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <EventIcon color="primary" fontSize="large" />
                      <Box>
                        <Typography variant="h4">{preview.total_unposted}</Typography>
                        <Typography color="text.secondary">Bookings to Post</Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <MoneyIcon color="success" fontSize="large" />
                      <Box>
                        <Typography variant="h4">{formatCurrency(preview.estimated_revenue)}</Typography>
                        <Typography color="text.secondary">Estimated Revenue</Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <HotelIcon color="info" fontSize="large" />
                      <Box>
                        <Typography variant="h4">
                          {preview.room_snapshot.total > 0
                            ? Math.round((preview.room_snapshot.occupied / preview.room_snapshot.total) * 100)
                            : 0}%
                        </Typography>
                        <Typography color="text.secondary">Occupancy Rate</Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Unposted Bookings Table or Completed Audit Summary */}
            {preview.already_run ? (
              <>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckIcon color="success" />
                  Audit Completed for {new Date(auditDate + 'T00:00:00').toLocaleDateString()}
                </Typography>
                {historyLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                    <CircularProgress size={24} />
                    <Typography sx={{ ml: 2 }}>Loading audit results...</Typography>
                  </Box>
                ) : (() => {
                  // Normalize date format for comparison (handle both "2026-01-03" and "2026-01-03T00:00:00Z")
                  const normalizeDate = (d: string) => d.split('T')[0];
                  const completedAudit = auditHistory.find(a => normalizeDate(a.audit_date) === normalizeDate(auditDate));
                  if (completedAudit) {
                    return (
                      <Card sx={{ bgcolor: 'success.light', mb: 2 }}>
                        <CardContent>
                          <Grid container spacing={3}>
                            <Grid item xs={6} sm={3}>
                              <Typography variant="body2" color="text.secondary">Bookings Posted</Typography>
                              <Typography variant="h5">{completedAudit.total_bookings_posted}</Typography>
                            </Grid>
                            <Grid item xs={6} sm={3}>
                              <Typography variant="body2" color="text.secondary">Total Revenue</Typography>
                              <Typography variant="h5">{formatCurrency(completedAudit.total_revenue)}</Typography>
                            </Grid>
                            <Grid item xs={6} sm={3}>
                              <Typography variant="body2" color="text.secondary">Check-ins</Typography>
                              <Typography variant="h5">{completedAudit.total_checkins}</Typography>
                            </Grid>
                            <Grid item xs={6} sm={3}>
                              <Typography variant="body2" color="text.secondary">Check-outs</Typography>
                              <Typography variant="h5">{completedAudit.total_checkouts}</Typography>
                            </Grid>
                            <Grid item xs={12}>
                              <Typography variant="body2" color="text.secondary">
                                Run at {new Date(completedAudit.run_at).toLocaleString()} by {completedAudit.run_by_username || 'System'}
                              </Typography>
                            </Grid>
                          </Grid>
                        </CardContent>
                      </Card>
                    );
                  }
                  return <Alert severity="success">Night audit has been completed for this date. Check the History tab for details.</Alert>;
                })()}
              </>
            ) : (
              <>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Bookings to be Posted
                  <Tooltip title="These bookings will be marked as posted and locked from further editing">
                    <IconButton size="small">
                      <InfoIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Typography>
                {preview.unposted_bookings.length > 0 ? (
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Booking #</TableCell>
                          <TableCell>Guest</TableCell>
                          <TableCell>Room</TableCell>
                          <TableCell>Check-in</TableCell>
                          <TableCell>Check-out</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {preview.unposted_bookings.map((booking: UnpostedBooking) => (
                          <TableRow key={booking.booking_id}>
                            <TableCell>{booking.booking_number}</TableCell>
                            <TableCell>{booking.guest_name}</TableCell>
                            <TableCell>{booking.room_number}</TableCell>
                        <TableCell>{new Date(booking.check_in_date).toLocaleDateString()}</TableCell>
                        <TableCell>{new Date(booking.check_out_date).toLocaleDateString()}</TableCell>
                        <TableCell>{getBookingStatusChip(booking.status)}</TableCell>
                        <TableCell align="right">{formatCurrency(booking.total_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">No bookings to post for this date.</Alert>
            )}
              </>
            )}
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
