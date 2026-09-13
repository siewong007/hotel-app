import React, { useState } from 'react';
import { errorMessage } from '../../../utils';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
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
  Tabs,
  Tab,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  KeyboardArrowUp as ExpandLessIcon,
  AccessTime as TimeIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { NightAuditRun, JournalSection, AuditDetailsResponse } from '../../../api';
import { channelAbbreviation, PendingPreviewView, CompletedReportView } from './NightAuditReportViews';
import { TabPanel, getTabA11yProps } from '../../../components/common/TabPanel';
import { formatLocalDate } from '../../../utils/date';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import {
  useNightAuditDetailsFetcher,
  useNightAuditPreview,
  useNightAuditRuns,
  useRunNightAudit,
} from '../hooks/useNightAuditQueries';


const NightAuditPage: React.FC = () => {
  const confirm = useConfirm();
  // State
  const [tabValue, setTabValue] = useState(0);
  const [auditDate, setAuditDate] = useState(() => formatLocalDate());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Filter state for audit history
  const [historyYear, setHistoryYear] = useState(() => new Date().getFullYear());
  const [historyMonth, setHistoryMonth] = useState(() => new Date().getMonth() + 1);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(25);

  const previewQuery = useNightAuditPreview(auditDate);
  const historyQuery = useNightAuditRuns({
    page: historyPage + 1,
    pageSize: historyPageSize,
    year: historyYear,
    month: historyMonth,
  });
  const runAuditMutation = useRunNightAudit();
  const fetchAuditDetails = useNightAuditDetailsFetcher();
  const preview = previewQuery.data ?? null;
  const auditHistory = historyQuery.data?.data ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;
  const loading = previewQuery.isPending || previewQuery.isFetching;
  const historyLoading = historyQuery.isPending;
  const running = runAuditMutation.isPending;
  const queryError = previewQuery.error || historyQuery.error;
  const effectiveError = error || (queryError instanceof Error ? queryError.message : null);

  // Confirmation dialog
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [auditNotes, setAuditNotes] = useState('');

  // Expanded rows in history
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Audit details for journal sections (fetched when needed)
  const [auditDetails, setAuditDetails] = useState<Record<number, AuditDetailsResponse>>({});
  const [detailsLoading, setDetailsLoading] = useState<Set<number>>(new Set());

  const toggleRowExpansion = async (auditId: number) => {
    const isExpanding = !expandedRows.has(auditId);

    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(auditId)) {
        newSet.delete(auditId);
      } else {
        newSet.add(auditId);
      }
      return newSet;
    });

    // Fetch audit details if expanding and not already loaded
    if (isExpanding && !auditDetails[auditId] && !detailsLoading.has(auditId)) {
      setDetailsLoading(prev => new Set(prev).add(auditId));
      try {
        const details = await fetchAuditDetails(auditId);
        setAuditDetails(prev => ({ ...prev, [auditId]: details }));
      } catch (err) {
        console.error('Failed to fetch audit details:', err);
      } finally {
        setDetailsLoading(prev => {
          const newSet = new Set(prev);
          newSet.delete(auditId);
          return newSet;
        });
      }
    }
  };

  // Export single audit to CSV with booking details
  const exportAuditToCSV = async (audit: NightAuditRun) => {
    try {
      // Fetch full audit details including bookings
      const details = await fetchAuditDetails(audit.id);
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
      lines.push(`Occupancy Rate,${Number(audit.occupancy_rate).toFixed(1)}%`);
      if (audit.notes) {
        lines.push(`Notes,"${audit.notes.replace(/"/g, '""')}"`);
      }
      lines.push('');

      // Booking details
      lines.push('POSTED BOOKINGS');
      lines.push('Booking #,Guest Name,Room,Room Type,Check-in,Check-out,Nights,Status,Payment Method,Payment Status,Channel');

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
          booking.payment_method || 'N/A',
          booking.payment_status || 'N/A',
          booking.source || 'N/A'
        ].join(','));
      });

      lines.push('');
      lines.push(`Total Bookings,${bookings.length}`);

      // Journal Sections
      if (details.journal_sections && details.journal_sections.length > 0) {
        lines.push('');
        lines.push('JOURNAL ENTRIES');

        details.journal_sections.forEach(section => {
          lines.push('');
          lines.push(`${section.display_name.toUpperCase()}`);
          lines.push('Booking #,Room,Description,Debit,Credit');

          section.entries.forEach(entry => {
            lines.push([
              entry.booking_number,
              entry.room_number,
              `"${(entry.description || '').replace(/"/g, '""')}"`,
              Number(entry.debit) > 0 ? Number(entry.debit).toFixed(2) : '',
              Number(entry.credit) > 0 ? Number(entry.credit).toFixed(2) : ''
            ].join(','));
          });

          lines.push(`Total,,, ${Number(section.total_debit) > 0 ? Number(section.total_debit).toFixed(2) : ''}, ${Number(section.total_credit) > 0 ? Number(section.total_credit).toFixed(2) : ''}`);
        });

        // Grand totals
        const grandDebit = details.journal_sections.reduce((sum, s) => sum + Number(s.total_debit), 0);
        const grandCredit = details.journal_sections.reduce((sum, s) => sum + Number(s.total_credit), 0);
        lines.push('');
        lines.push(`GRAND TOTAL,,, ${grandDebit.toFixed(2)}, ${grandCredit.toFixed(2)}`);

        // Guest Ledger summary (mirrors PDF page 2)
        lines.push('');
        lines.push('GUEST LEDGER');
        lines.push('Account,Debits,Credits');
        details.journal_sections.forEach(section => {
          lines.push([
            section.display_name,
            Number(section.total_debit) > 0 ? Number(section.total_debit).toFixed(2) : '',
            Number(section.total_credit) > 0 ? Number(section.total_credit).toFixed(2) : ''
          ].join(','));
        });
        lines.push(`Total,${grandDebit.toFixed(2)},${grandCredit.toFixed(2)}`);
      }

      // Room Sold Detail by Date (mirrors PDF page 2)
      if (bookings.length > 0) {
        lines.push('');
        lines.push('ROOM SOLD DETAIL BY DATE');
        lines.push('Room,Type,Guest Name');
        bookings.forEach(b => {
          const abbr = channelAbbreviation(b);
          const guestName = abbr ? `${b.guest_name} (${abbr})` : b.guest_name;
          lines.push([
            b.room_number,
            b.room_type_code || b.room_type || '',
            `"${guestName.replace(/"/g, '""')}"`
          ].join(','));
        });
        lines.push(`Total Room Sold,${bookings.length},`);
      }

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

  // Export single audit to PDF matching the night audit report format
  const exportAuditToPDF = async (audit: NightAuditRun) => {
    try {
      const details = await fetchAuditDetails(audit.id);
      const bookings = details.posted_bookings;
      const sections = details.journal_sections || [];

      const jspdfModule = await import('jspdf');
      // Keep the interop fallback but preserve the ambient jsPDF type on both branches,
      // so lastAutoTable stays known.
      const jsPDF =
        jspdfModule.jsPDF || (jspdfModule as { default?: typeof jspdfModule.jsPDF }).default;
      const autoTableModule = await import('jspdf-autotable');
      const autoTable = autoTableModule.default;

      // Portrait orientation to match the printed format
      const doc = new jsPDF({ orientation: 'portrait' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 14;

      // Format audit date as DD.MM.YYYY
      const dateParts = audit.audit_date.split('-');
      const auditDateFormatted = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;

      // Title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Night Audit', pageWidth / 2, 20, { align: 'center' });

      doc.setFontSize(11);
      doc.text(`Audit Date : ${auditDateFormatted}`, pageWidth / 2, 28, { align: 'center' });
      doc.setFont('helvetica', 'normal');

      let currentY = 36;

      // Helper: render a journal section as a bordered table
      const renderSection = (section: JournalSection) => {
        const isRoomCharge = section.entry_type === 'room_charge';
        const isServiceTax = section.entry_type === 'service_tax';

        // Room Charges: special table with Description, Credit, Service Tax, Room, Check-in, Check-out
        if (isRoomCharge) {
          // Find service tax section to merge
          const taxSection = sections.find(s => s.entry_type === 'service_tax');

          // Helper to format date as DD.MM.YYYY
          const fmtDate = (d: string) => { const p = d.split('-'); return `${p[2]}.${p[1]}.${p[0]}`; };

          // Build merged data: match room_charge entries with service_tax entries by room
          const rows: string[][] = [];
          for (const entry of section.entries) {
            const taxEntry = taxSection?.entries.find(e => e.room_number === entry.room_number);
            const booking = bookings.find(b => b.room_number === entry.room_number);
            rows.push([
              'Room Charge',
              entry.room_number,
              booking ? fmtDate(booking.check_in_date) : '',
              booking ? fmtDate(booking.check_out_date) : '',
              Number(entry.credit).toFixed(2),
              taxEntry ? Number(taxEntry.credit).toFixed(2) : '',
            ]);
          }
          // Totals row
          const totalCredit = Number(section.total_credit).toFixed(2);
          const totalTax = taxSection ? Number(taxSection.total_credit).toFixed(2) : '';
          rows.push([
            '',
            '',
            '',
            '',
            `Totals : ${totalCredit}`,
            `Totals : ${totalTax}`,
          ]);

          if (currentY + rows.length * 7 + 15 > pageHeight - 20) {
            doc.addPage();
            currentY = 20;
          }

          autoTable(doc, {
            startY: currentY,
            head: [['Description', 'Room', 'Check-in', 'Check-out', 'Credit', 'Service Tax']],
            body: rows,
            styles: { fontSize: 8, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.3 },
            headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'italic', lineColor: [0, 0, 0], lineWidth: 0.3 },
            columnStyles: {
              0: { fontStyle: 'italic', cellWidth: 35 },
              1: { fontStyle: 'bold', halign: 'center', cellWidth: 20 },
              2: { halign: 'center', cellWidth: 28 },
              3: { halign: 'center', cellWidth: 28 },
              4: { halign: 'right', cellWidth: 30 },
              5: { halign: 'right', cellWidth: 30 },
            },
            theme: 'grid',
          });
          currentY = doc.lastAutoTable.finalY + 6;
          return;
        }

        // Skip service_tax - already merged into room_charge
        if (isServiceTax) return;

        const isCreditSideSection = [
          'extra_bed_charge',
          'extra_bed_tax',
          'tourism_tax',
          'deposit_refund',
        ].includes(section.entry_type);

        // All other sections: Description, Amount, Room/Notes
        const displayName = section.display_name;
        const rows: string[][] = [];
        for (const entry of section.entries) {
          const amount = isCreditSideSection ? Number(entry.credit) : Number(entry.debit);
          rows.push([
            displayName,
            amount > 0 ? amount.toFixed(2) : '',
            entry.room_number,
          ]);
        }
        const total = isCreditSideSection ? Number(section.total_credit) : Number(section.total_debit);
        rows.push(['', `Totals : ${total.toFixed(2)}`, '']);

        if (currentY + rows.length * 7 + 15 > pageHeight - 20) {
          doc.addPage();
          currentY = 20;
        }

        autoTable(doc, {
          startY: currentY,
          head: [['', '', '']],
          body: rows,
          showHead: false,
          styles: { fontSize: 8, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.3 },
          columnStyles: {
            0: { fontStyle: 'italic', cellWidth: 50 },
            1: { halign: 'right', fontStyle: 'bold', cellWidth: 50 },
            2: { halign: 'right', fontStyle: 'bold', cellWidth: 30 },
          },
          theme: 'grid',
        });
        currentY = doc.lastAutoTable.finalY + 6;
      };

      // Render each journal section
      for (const section of sections) {
        renderSection(section);
      }

      // === Page 2: General Journal + Room Sold Detail ===
      doc.addPage();
      currentY = 20;

      // Guest Ledger title
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('Guest Ledger', margin, currentY);
      doc.setFont('helvetica', 'normal');
      currentY += 8;

      // Build General Journal summary rows from the report's debit/credit totals.
      const journalRows: string[][] = [];
      let journalTotalDebit = 0;
      let journalTotalCredit = 0;
      for (const section of sections) {
        const debitVal = Number(section.total_debit);
        const creditVal = Number(section.total_credit);
        journalTotalDebit += debitVal;
        journalTotalCredit += creditVal;
        journalRows.push([
          section.display_name,
          debitVal > 0 ? debitVal.toFixed(2) : '',
          creditVal > 0 ? creditVal.toFixed(2) : '',
        ]);
      }

      autoTable(doc, {
        startY: currentY,
        head: [['Account', 'Debits', 'Credits']],
        body: journalRows,
        foot: [['Total', journalTotalDebit.toFixed(2), journalTotalCredit.toFixed(2)]],
        styles: { fontSize: 9, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.3 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.3 },
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right', lineColor: [0, 0, 0], lineWidth: 0.3 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 60 },
          1: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
          2: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
        },
        theme: 'grid',
      });
      currentY = doc.lastAutoTable.finalY + 16;

      // Room Sold Detail by Date
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('Room Sold Detail by Date', margin, currentY);
      doc.setFont('helvetica', 'normal');
      currentY += 8;

      const roomSoldRows: string[][] = bookings.map(b => {
        const abbr = channelAbbreviation(b);
        return [
          b.room_number,
          b.room_type_code || b.room_type || '',
          abbr ? `${b.guest_name} (${abbr})` : b.guest_name,
        ];
      });
      roomSoldRows.push([
        'Total Room Sold',
        bookings.length.toString(),
        '',
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [['Room', 'Type', 'Guest Name']],
        body: roomSoldRows,
        styles: { fontSize: 9, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.3 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.3 },
        columnStyles: {
          0: { fontStyle: 'bold', halign: 'center', cellWidth: 35 },
          1: { halign: 'center', cellWidth: 35 },
          2: { fontStyle: 'italic' },
        },
        theme: 'grid',
      });

      // Footer on all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Generated: ${new Date().toLocaleString()} | Page ${i} of ${totalPages}`,
          margin,
          pageHeight - 10
        );
      }

      doc.save(`night_audit_${audit.audit_date}.pdf`);
    } catch (err) {
      console.error('Failed to export audit to PDF:', err);
      setError(`Failed to export audit: ${errorMessage(err, 'Unknown error')}`);
    }
  };

  const fetchPreview = async () => {
    setError(null);
    await previewQuery.refetch();
  };

  const fetchHistory = async () => {
    await historyQuery.refetch();
  };

  // Run night audit
  const handleRunAudit = async (force: boolean = false) => {
    try {
      setError(null);
      setConfirmDialogOpen(false);

      const response = await runAuditMutation.mutateAsync({
        audit_date: auditDate,
        notes: auditNotes || undefined,
        force,
      });

      setSuccess(force ? 'Night audit rerun successfully' : response.message);
      setAuditNotes('');

      // Refresh data
      await Promise.all([fetchPreview(), fetchHistory()]);

      // Auto-load journal details for the newly run audit so journal sections are immediately visible
      const newAuditId = response.audit_run.id;
      try {
        const details = await fetchAuditDetails(newAuditId);
        setAuditDetails(prev => ({ ...prev, [newAuditId]: details }));
      } catch (detailErr) {
        console.error('Failed to auto-load audit details:', detailErr);
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to run night audit'));
    }
  };

  // Rerun night audit (for already completed audits)
  const handleRerunAudit = async () => {
    const accepted = await confirm({
      title: 'Rerun night audit',
      message: 'This resets the previous audit data for this date and runs the audit again.',
      confirmText: 'Rerun audit',
      severity: 'warning',
    });
    if (!accepted) return;
    await handleRunAudit(true);
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

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{
          fontWeight: "bold"
        }}>
          Night Audit
        </Typography>
        <IconButton onClick={() => { fetchPreview(); fetchHistory(); }} aria-label="Refresh night audit">
          <RefreshIcon />
        </IconButton>
      </Box>
      {/* Alerts */}
      {effectiveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {effectiveError}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      {/* Tabs */}
      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 2 }} aria-label="Night audit tabs">
        <Tab label="Run Audit" {...getTabA11yProps(0, 'night-audit')} />
        <Tab label="Audit History" {...getTabA11yProps(1, 'night-audit')} />
      </Tabs>
      {/* Tab 1: Run Audit */}
      <TabPanel value={tabValue} index={0} idPrefix="night-audit" contentSx={{ pt: 2 }}>
        {/* Date Selector */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={2} sx={{
              alignItems: "center"
            }}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  label="Audit Date"
                  type="date"
                  value={auditDate}
                  onChange={(e) => setAuditDate(e.target.value)}
                  fullWidth
                  slotProps={{
                    inputLabel: { shrink: true }
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Button
                  variant="outlined"
                  onClick={fetchPreview}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
                >
                  Load Preview
                </Button>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
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
          preview.already_run ? (
            (() => {
              const normalizeDate = (d: string) => d.split('T')[0];
              const completedAudit = auditHistory.find(a => normalizeDate(a.audit_date) === normalizeDate(auditDate));
              return completedAudit ? (
                <CompletedReportView
                  audit={completedAudit}
                  details={auditDetails[completedAudit.id]}
                  detailsLoading={detailsLoading.has(completedAudit.id)}
                  running={running}
                  onLoadDetails={async () => {
                    setDetailsLoading(prev => new Set(prev).add(completedAudit.id));
                    try {
                      const details = await fetchAuditDetails(completedAudit.id);
                      setAuditDetails(prev => ({ ...prev, [completedAudit.id]: details }));
                    } catch (err) {
                      console.error('Failed to fetch audit details:', err);
                    } finally {
                      setDetailsLoading(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(completedAudit.id);
                        return newSet;
                      });
                    }
                  }}
                  onExportPDF={() => exportAuditToPDF(completedAudit)}
                  onExportCSV={() => exportAuditToCSV(completedAudit)}
                  onRerun={handleRerunAudit}
                />
              ) : (
                <Alert severity="success">Night audit completed. Check History tab for details.</Alert>
              );
            })()
          ) : (
            <PendingPreviewView
              preview={preview}
              auditDate={auditDate}
              running={running}
              onRun={() => setConfirmDialogOpen(true)}
            />
          )
        ) : null}
      </TabPanel>
      {/* Tab 2: Audit History */}
      <TabPanel value={tabValue} index={1} idPrefix="night-audit" contentSx={{ pt: 2 }}>
        {/* Year/Month Filter Controls */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
          <TextField
            select
            label="Year"
            value={historyYear}
            onChange={(e) => {
              setHistoryYear(Number(e.target.value));
              setHistoryPage(0);
            }}
            size="small"
            sx={{ minWidth: 120 }}
            slotProps={{
              select: { native: true }
            }}
          >
            {Array.from({ length: 6 }, (_, i) => {
              const year = new Date().getFullYear() - i;
              return (
                <option key={year} value={year}>
                  {year}
                </option>
              );
            })}
          </TextField>

          <TextField
            select
            label="Month"
            value={historyMonth}
            onChange={(e) => {
              setHistoryMonth(Number(e.target.value));
              setHistoryPage(0);
            }}
            size="small"
            sx={{ minWidth: 140 }}
            slotProps={{
              select: { native: true }
            }}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(0, i).toLocaleString('en-US', { month: 'long' })}
              </option>
            ))}
          </TextField>

          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              ml: 'auto'
            }}>
            {historyTotal} audit{historyTotal === 1 ? '' : 's'} found
          </Typography>
        </Box>

        {historyLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : auditHistory.length > 0 ? (
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
                  <TableCell sx={{ width: 48 }} />
                  <TableCell sx={{ fontWeight: 600 }}>Audit Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Run At</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Run By</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Bookings</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Occupancy</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {auditHistory.map((audit) => {
                  const isExpanded = expandedRows.has(audit.id);
                  return (
                    <React.Fragment key={audit.id}>
                      <TableRow
                        hover
                        onClick={() => toggleRowExpansion(audit.id)}
                        sx={{ cursor: 'pointer', '& > .MuiTableCell-root': { borderBottom: isExpanded ? 'none' : undefined } }}
                      >
                        <TableCell>
                          <IconButton size="small" aria-label={isExpanded ? 'Collapse audit details' : 'Expand audit details'}>
                            {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {new Date(audit.audit_date + 'T00:00:00').toLocaleDateString('en-US', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5
                            }}>
                            <TimeIcon fontSize="small" />
                            {new Date(audit.run_at).toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5
                            }}>
                            <PersonIcon fontSize="small" />
                            {audit.run_by_username || 'System'}
                          </Typography>
                        </TableCell>
                        <TableCell>{getStatusChip(audit.status)}</TableCell>
                        <TableCell align="right">{audit.total_bookings_posted}</TableCell>
                        <TableCell align="right">{Number(audit.occupancy_rate).toFixed(0)}%</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                          <Collapse in={isExpanded}>
                            <Box sx={{ bgcolor: 'var(--hotel-surface-sunken)', p: 2 }}>
                              <CompletedReportView
                                audit={audit}
                                details={auditDetails[audit.id]}
                                detailsLoading={detailsLoading.has(audit.id)}
                                running={running}
                                onLoadDetails={async () => {
                                  setDetailsLoading(prev => new Set(prev).add(audit.id));
                                  try {
                                    const details = await fetchAuditDetails(audit.id);
                                    setAuditDetails(prev => ({ ...prev, [audit.id]: details }));
                                  } catch (err) {
                                    console.error('Failed to fetch audit details:', err);
                                  } finally {
                                    setDetailsLoading(prev => {
                                      const newSet = new Set(prev);
                                      newSet.delete(audit.id);
                                      return newSet;
                                    });
                                  }
                                }}
                                onExportPDF={() => exportAuditToPDF(audit)}
                                onExportCSV={() => exportAuditToCSV(audit)}
                                onRerun={handleRerunAudit}
                              />
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={historyTotal}
              page={historyPage}
              onPageChange={(_, newPage) => setHistoryPage(newPage)}
              rowsPerPage={historyPageSize}
              rowsPerPageOptions={[10, 25, 50, 100]}
              onRowsPerPageChange={(e) => {
                setHistoryPageSize(parseInt(e.target.value, 10));
                setHistoryPage(0);
              }}
              labelRowsPerPage="Audits per page"
            />
          </TableContainer>
        ) : (
          <Alert severity="info">No audit history available.</Alert>
        )}
      </TabPanel>
      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onClose={() => setConfirmDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm Night Audit</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            You are about to run the night audit for <strong>{new Date(auditDate + 'T00:00:00').toLocaleDateString()}</strong>.
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
            onClick={() => handleRunAudit(false)}
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
