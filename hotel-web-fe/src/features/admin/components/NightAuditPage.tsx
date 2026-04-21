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
import { NightAuditService, NightAuditPreview, NightAuditRun, UnpostedBooking, JournalSection, AuditDetailsResponse } from '../../../api';
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

// Journal Sections Display Component
interface JournalSectionsDisplayProps {
  sections: JournalSection[];
}

function JournalSectionsDisplay({ sections }: JournalSectionsDisplayProps) {
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
              <Typography variant="subtitle2" fontWeight="bold">
                {section.display_name}
              </Typography>
              <Chip label={`${section.entries.length} entries`} size="small" variant="outlined" />
            </Box>
            <Box sx={{ display: 'flex', gap: 3 }}>
              {Number(section.total_debit) > 0 && (
                <Typography variant="body2" color="error.main">
                  <strong>Debit:</strong> {formatCurrency(Number(section.total_debit))}
                </Typography>
              )}
              {Number(section.total_credit) > 0 && (
                <Typography variant="body2" color="success.main">
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
          <Typography variant="subtitle1" fontWeight="bold">Grand Total</Typography>
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
        const details = await NightAuditService.getAuditDetails(auditId);
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
      const details = await NightAuditService.getAuditDetails(audit.id);
      const bookings = details.posted_bookings;
      const sections = details.journal_sections || [];

      const jspdfModule = await import('jspdf');
      const jsPDF = jspdfModule.jsPDF || jspdfModule.default;
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
        const isDepositRefund = section.entry_type === 'deposit_refund';

        // Room Charges: special table with Description, Debit, Service Tax, Room, Check-in, Check-out
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
              Number(entry.debit).toFixed(2),
              taxEntry ? Number(taxEntry.debit).toFixed(2) : '',
            ]);
          }
          // Totals row
          const totalDebit = Number(section.total_debit).toFixed(2);
          const totalTax = taxSection ? Number(taxSection.total_debit).toFixed(2) : '';
          rows.push([
            '',
            '',
            '',
            '',
            `Totals : ${totalDebit}`,
            `Totals : ${totalTax}`,
          ]);

          if (currentY + rows.length * 7 + 15 > pageHeight - 20) {
            doc.addPage();
            currentY = 20;
          }

          autoTable(doc, {
            startY: currentY,
            head: [['Description', 'Room', 'Check-in', 'Check-out', 'Debit', 'Service Tax']],
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
          currentY = (doc as any).lastAutoTable.finalY + 6;
          return;
        }

        // Skip service_tax - already merged into room_charge
        if (isServiceTax) return;

        const isCityLedger = section.entry_type === 'city_ledger';

        // City Ledger: special table with Description, Debit, Credit, Net amount
        if (isCityLedger) {
          const fmtDate = (d: string) => { const p = d.split('-'); return `${p[2]}.${p[1]}.${p[0]}`; };
          const today = fmtDate(audit.audit_date);

          const rows: string[][] = [];
          for (const entry of section.entries) {
            const debit = Number(entry.debit);
            const credit = Number(entry.credit);
            rows.push([
              today,
              entry.description || 'Guest Ledger Transfer',
              debit > 0 ? debit.toFixed(2) : '',
              credit > 0 ? credit.toFixed(2) : '',
            ]);
          }
          const totalDebit = Number(section.total_debit);
          const totalCredit = Number(section.total_credit);
          const netAmount = totalDebit - totalCredit;
          rows.push([
            '',
            'Totals:',
            totalDebit > 0 ? totalDebit.toFixed(2) : '',
            `${totalCredit > 0 ? totalCredit.toFixed(2) : ''}    Net amount:    ${netAmount.toFixed(2)}`,
          ]);

          if (currentY + rows.length * 7 + 20 > pageHeight - 20) {
            doc.addPage();
            currentY = 20;
          }

          // Section header
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text('City Ledger', margin, currentY);
          doc.setFont('helvetica', 'normal');
          currentY += 5;

          autoTable(doc, {
            startY: currentY,
            head: [['', '', '', '']],
            body: rows,
            showHead: false,
            styles: { fontSize: 8, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.3 },
            columnStyles: {
              0: { cellWidth: 28 },
              1: { fontStyle: 'italic', cellWidth: 50 },
              2: { halign: 'right', fontStyle: 'bold', cellWidth: 25 },
              3: { halign: 'right', fontStyle: 'bold', cellWidth: 55 },
            },
            theme: 'grid',
          });
          currentY = (doc as any).lastAutoTable.finalY + 6;
          return;
        }

        // All other sections: Description, Amount, Room/Notes
        const displayName = section.display_name;
        const rows: string[][] = [];
        for (const entry of section.entries) {
          const amount = isDepositRefund ? Number(entry.credit) : Number(entry.debit);
          rows.push([
            displayName,
            amount > 0 ? amount.toFixed(2) : '',
            entry.room_number,
          ]);
        }
        const total = isDepositRefund ? Number(section.total_credit) : Number(section.total_debit);
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
        currentY = (doc as any).lastAutoTable.finalY + 6;
      };

      // Render each journal section
      for (const section of sections) {
        renderSection(section);
      }

      // === Page 2: General Journal + Room Sold Detail ===
      doc.addPage();
      currentY = 20;

      // General Journal title
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('General Journal', margin, currentY);
      doc.setFont('helvetica', 'normal');
      currentY += 8;

      // Build General Journal summary rows
      const journalRows: string[][] = [];
      for (const section of sections) {
        const debitTotal = Number(section.total_debit);
        const creditTotal = Number(section.total_credit);
        journalRows.push([
          section.display_name,
          debitTotal > 0 ? debitTotal.toFixed(2) : '',
          creditTotal > 0 ? creditTotal.toFixed(2) : '',
        ]);
      }

      autoTable(doc, {
        startY: currentY,
        head: [['Account', 'Debits', 'Credits']],
        body: journalRows,
        styles: { fontSize: 9, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.3 },
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: 0.3 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 60 },
          1: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
          2: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
        },
        theme: 'grid',
      });
      currentY = (doc as any).lastAutoTable.finalY + 16;

      // Room Sold Detail by Date
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('Room Sold Detail by Date', margin, currentY);
      doc.setFont('helvetica', 'normal');
      currentY += 8;

      const roomSoldRows: string[][] = bookings.map(b => [
        b.room_number,
        b.room_type_code || b.room_type || '',
        b.guest_name,
      ]);
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
  const handleRunAudit = async (force: boolean = false) => {
    try {
      setRunning(true);
      setError(null);
      setConfirmDialogOpen(false);

      const response = await NightAuditService.runNightAudit({
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
        const details = await NightAuditService.getAuditDetails(newAuditId);
        setAuditDetails(prev => ({ ...prev, [newAuditId]: details }));
      } catch (detailErr) {
        console.error('Failed to auto-load audit details:', detailErr);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to run night audit');
    } finally {
      setRunning(false);
    }
  };

  // Rerun night audit (for already completed audits)
  const handleRerunAudit = async () => {
    if (!window.confirm('Are you sure you want to rerun the night audit? This will reset the previous audit data for this date.')) {
      return;
    }
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
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  label="Audit Date"
                  type="date"
                  value={auditDate}
                  onChange={(e) => setAuditDate(e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
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
                          <Grid size={{ xs: 6, sm: 3 }}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'primary.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{completedAudit.total_bookings_posted}</Typography>
                              <Typography variant="body2">Bookings Posted</Typography>
                            </Box>
                          </Grid>
                          <Grid size={{ xs: 6, sm: 3 }}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{completedAudit.total_checkins}</Typography>
                              <Typography variant="body2">Check-ins</Typography>
                            </Box>
                          </Grid>
                          <Grid size={{ xs: 6, sm: 3 }}>
                            <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                              <Typography variant="h4" fontWeight="bold">{completedAudit.total_checkouts}</Typography>
                              <Typography variant="body2">Check-outs</Typography>
                            </Box>
                          </Grid>
                          <Grid size={{ xs: 6, sm: 3 }}>
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

                        {/* Journal Sections for completed audit */}
                        {detailsLoading.has(completedAudit.id) ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={24} />
                            <Typography variant="body2" sx={{ ml: 1 }}>Loading journal entries...</Typography>
                          </Box>
                        ) : auditDetails[completedAudit.id]?.journal_sections && auditDetails[completedAudit.id].journal_sections.length > 0 ? (
                          <JournalSectionsDisplay sections={auditDetails[completedAudit.id].journal_sections} />
                        ) : !auditDetails[completedAudit.id] ? (
                          <Button
                            variant="text"
                            size="small"
                            onClick={async () => {
                              setDetailsLoading(prev => new Set(prev).add(completedAudit.id));
                              try {
                                const details = await NightAuditService.getAuditDetails(completedAudit.id);
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
                          >
                            Load Journal Entries
                          </Button>
                        ) : null}

                        {/* Export and Rerun Buttons */}
                        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
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
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<RefreshIcon />}
                            onClick={handleRerunAudit}
                            disabled={running}
                          >
                            {running ? 'Rerunning...' : 'Rerun Audit'}
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
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'primary.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{preview.total_unposted}</Typography>
                        <Typography variant="body2">Bookings to Post</Typography>
                      </Box>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{preview.room_snapshot.occupied}</Typography>
                        <Typography variant="body2">Occupied Rooms</Typography>
                      </Box>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                        <Typography variant="h4" fontWeight="bold">{preview.room_snapshot.available}</Typography>
                        <Typography variant="body2">Available Rooms</Typography>
                      </Box>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
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
                    <>
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
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>

                      {/* Journal Sections */}
                      {preview.journal_sections && preview.journal_sections.length > 0 && (
                        <JournalSectionsDisplay sections={preview.journal_sections} />
                      )}
                    </>
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
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="primary">{audit.total_bookings_posted}</Typography>
                            <Typography variant="body2" color="text.secondary">Bookings Posted</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="success.main">{audit.total_checkins}</Typography>
                            <Typography variant="body2" color="text.secondary">Check-ins</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <Card variant="outlined">
                          <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                            <Typography variant="h4" color="warning.main">{audit.total_checkouts}</Typography>
                            <Typography variant="body2" color="text.secondary">Check-outs</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>

                    {/* Room Snapshot */}
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                      Room Snapshot at Audit Time
                    </Typography>
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                      <Grid size={{ xs: 4, sm: 2 }}>
                        <Card sx={{ bgcolor: 'success.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_available}</Typography>
                            <Typography variant="caption">Available</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 4, sm: 2 }}>
                        <Card sx={{ bgcolor: 'error.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_occupied}</Typography>
                            <Typography variant="caption">Occupied</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 4, sm: 2 }}>
                        <Card sx={{ bgcolor: 'info.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_reserved}</Typography>
                            <Typography variant="caption">Reserved</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 4, sm: 2 }}>
                        <Card sx={{ bgcolor: 'warning.light' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_maintenance}</Typography>
                            <Typography variant="caption">Maintenance</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 4, sm: 2 }}>
                        <Card sx={{ bgcolor: 'grey.300' }}>
                          <CardContent sx={{ textAlign: 'center', py: 1 }}>
                            <Typography variant="h5">{audit.rooms_dirty}</Typography>
                            <Typography variant="caption">Dirty</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 4, sm: 2 }}>
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

                    {/* Journal Sections */}
                    {detailsLoading.has(audit.id) ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={24} />
                        <Typography variant="body2" sx={{ ml: 1 }}>Loading journal entries...</Typography>
                      </Box>
                    ) : auditDetails[audit.id]?.journal_sections && auditDetails[audit.id].journal_sections.length > 0 ? (
                      <JournalSectionsDisplay sections={auditDetails[audit.id].journal_sections} />
                    ) : null}

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
