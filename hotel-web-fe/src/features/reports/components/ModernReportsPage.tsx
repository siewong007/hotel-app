import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  MenuItem,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  CircularProgress,
  Alert,
  Divider,
  Chip,
  Dialog,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import {
  Add as AddIcon,
  Assessment as ReportIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  Save as SaveIcon,
  Visibility as PreviewIcon,
  Business as BusinessIcon,
  CalendarMonth as CalendarIcon,
  AccountBalance as LedgerIcon,
  Receipt as ReceiptIcon,
  TrendingUp as TrendingIcon,
  Today as TodayIcon,
  Hotel as HotelIcon,
  AttachMoney as MoneyIcon,
  Payment as PaymentIcon,
  CardGiftcard as GiftIcon,
  People as PeopleIcon,
  MeetingRoom as RoomIcon,
} from '@mui/icons-material';
import { ReportsService, type BookingChannel } from '../../../api/reports.service';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { useCurrency } from '../../../hooks/useCurrency';
import { formatLocalDate } from '../../../utils/date';
import { formatStatusLabel } from '../../../utils/formatters';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { useReportData } from '../hooks/useReportData';
import {
  GeneralJournalReport,
  CompanyLedgerStatementReport,
  BalanceSheetReport,
  ShiftReportView,
  RoomsSoldReport,
} from './reportViews/FinancialReportViews';
import {
  DailyOperationsReport,
  OccupancyReport,
  RevenueReport,
  RoomPerformanceReport,
} from './reportViews/OperationsReportViews';
import {
  OtaMonthlyStatementReport,
  PaymentStatusReport,
  ComplimentaryReport,
  GuestStatisticsReport,
} from './reportViews/GuestReportViews';
import {
  createReportContentSx,
  createReportPrintStyles,
  createReportTypography,
} from '../utils/reportTypography';
import type {
  BalanceSheetAccount,
  ChannelNetRevenueRow,
  ChannelRevenueSummary,
  CompanyLedgerTransaction,
  ComplimentaryBooking,
  DailyOperationsGuestEntry,
  DailyOperationsInHouseEntry,
  GeneralJournalEntry,
  GeneralJournalSection,
  NationalityStat,
  OtaStatement,
  OtaStatementRow,
  OverduePayment,
  PaymentStatusBreakdown,
  RevenueByPaymentStatusStat,
  RevenueBySourceStat,
  RoomPerformanceStat,
  RoomsSoldBooking,
  RoomTypePerformanceStat,
  RoomTypeRevenueStat,
  ShiftReportPayment,
  ShiftReportPaymentMethodSummary,
  TopGuestStat,
  UnderperformingRoomStat,
} from '../../../types/report.types';

type ReportType =
  // New hotel management reports
  | 'daily_operations'
  | 'occupancy'
  | 'revenue'
  | 'channel_net_revenue'
  | 'ota_monthly_statement'
  | 'payment_status'
  | 'complimentary'
  | 'guest_statistics'
  | 'room_performance'
  // Legacy accounting reports
  | 'general_journal'
  | 'company_ledger_statement'
  | 'balance_sheet'
  | 'shift_report'
  | 'rooms_sold';

interface CompanyOption {
  company_name: string;
  entry_count: number;
  total_balance: number;
}

type ChannelSortKey =
  | 'business_date'
  | 'booking_number'
  | 'guest_name'
  | 'booking_channel'
  | 'gross_room_revenue'
  | 'commission_amount'
  | 'net_hotel_revenue'
  | 'posted_status';

type SortDirection = 'asc' | 'desc';

const CHANNEL_TYPES = [
  { value: 'direct', label: 'Direct' },
  { value: 'ota', label: 'OTA' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone' },
  { value: 'website', label: 'Website' },
  { value: 'channel_manager', label: 'Channel Manager' },
  { value: 'other', label: 'Other' },
];

const COMMISSION_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed_amount', label: 'Fixed Amount' },
];

const COMMISSION_SCOPES = [
  { value: 'per_booking', label: 'Per Booking' },
  { value: 'per_night', label: 'Per Night' },
];

const REPORT_CONFIGS = [
  // New Hotel Management Reports
  {
    type: 'daily_operations' as ReportType,
    label: 'Daily Operations',
    description: "Today's arrivals, departures & in-house",
    icon: <TodayIcon />,
    color: '#2e7d32',
    category: 'operations',
  },
  {
    type: 'occupancy' as ReportType,
    label: 'Occupancy Report',
    description: 'Occupancy rate, ADR & RevPAR metrics',
    icon: <HotelIcon />,
    color: '#1565c0',
    category: 'operations',
  },
  {
    type: 'revenue' as ReportType,
    label: 'Revenue Report',
    description: 'Revenue by room type, source & payment',
    icon: <MoneyIcon />,
    color: '#00695c',
    category: 'financial',
  },
  {
    type: 'channel_net_revenue' as ReportType,
    label: 'Channel Net Revenue',
    description: 'OTA commission & hotel net revenue',
    icon: <TrendingIcon />,
    color: '#7b1fa2',
    category: 'financial',
  },
  {
    type: 'ota_monthly_statement' as ReportType,
    label: 'OTA Monthly Statement',
    description: 'Monthly remittance by platform',
    icon: <ReceiptIcon />,
    color: '#00695c',
    category: 'financial',
  },
  {
    type: 'payment_status' as ReportType,
    label: 'Payment Status',
    description: 'Outstanding payments & overdue tracking',
    icon: <PaymentIcon />,
    color: '#d84315',
    category: 'financial',
  },
  {
    type: 'complimentary' as ReportType,
    label: 'Complimentary Report',
    description: 'Track complimentary stays & discounts',
    icon: <GiftIcon />,
    color: '#6a1b9a',
    category: 'operations',
  },
  {
    type: 'guest_statistics' as ReportType,
    label: 'Guest Statistics',
    description: 'Guest demographics & patterns',
    icon: <PeopleIcon />,
    color: '#00838f',
    category: 'analytics',
  },
  {
    type: 'room_performance' as ReportType,
    label: 'Room Performance',
    description: 'Room & room type analysis',
    icon: <RoomIcon />,
    color: '#4527a0',
    category: 'analytics',
  },
  // Legacy Accounting Reports
  {
    type: 'general_journal' as ReportType,
    label: 'Guest Ledger',
    description: 'Double-entry accounting journal',
    icon: <LedgerIcon />,
    color: '#546e7a',
    category: 'accounting',
  },
  {
    type: 'company_ledger_statement' as ReportType,
    label: 'Company Ledger',
    description: 'Company account statements',
    icon: <BusinessIcon />,
    color: '#546e7a',
    category: 'accounting',
  },
  {
    type: 'balance_sheet' as ReportType,
    label: 'Balance Sheet',
    description: 'Summary of account balances',
    icon: <TrendingIcon />,
    color: '#546e7a',
    category: 'accounting',
  },
  {
    type: 'shift_report' as ReportType,
    label: 'Payment Records',
    description: 'Daily payment details by booking',
    icon: <ReceiptIcon />,
    color: '#546e7a',
    category: 'accounting',
  },
  {
    type: 'rooms_sold' as ReportType,
    label: 'Rooms Sold',
    description: 'Room occupancy details',
    icon: <CalendarIcon />,
    color: '#546e7a',
    category: 'accounting',
  },
];

const ModernReportsPage: React.FC = () => {
  const { symbol: currencySymbol } = useCurrency();
  const hotelSettings = getHotelSettings();
  const reportTypography = createReportTypography(hotelSettings);
  const reportContentSx = createReportContentSx(reportTypography);
  const reportPrintStyles = createReportPrintStyles(reportTypography);
  const printRef = useRef<HTMLDivElement>(null);

  const {
    selectedReport,
    setSelectedReport,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    selectedCompany,
    setSelectedCompany,
    companyList,
    loadingCompanies,
    loading,
    error,
    setError,
    reportData,
    handleReportTypeChange: handleReportTypeChangeHook,
    handleGenerateReport: handleGenerateReportHook,
  } = useReportData();

  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [bookingChannels, setBookingChannels] = useState<BookingChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelSaveError, setChannelSaveError] = useState('');
  const [savingChannelId, setSavingChannelId] = useState<number | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState('ota');
  const [channelFilterId, setChannelFilterId] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState('all');
  const [postedStatusFilter, setPostedStatusFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState('');
  const [channelSort, setChannelSort] = useState<{ key: ChannelSortKey; direction: SortDirection }>({
    key: 'business_date',
    direction: 'asc',
  });

  const loadBookingChannels = async () => {
    setChannelsLoading(true);
    setChannelSaveError('');
    try {
      const channels = await ReportsService.listBookingChannels();
      setBookingChannels(channels);
    } catch (err: unknown) {
      setChannelSaveError(getQueryErrorMessage(err, 'Failed to load booking channels') ?? 'Failed to load booking channels');
    } finally {
      setChannelsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedReport === 'channel_net_revenue' || selectedReport === 'ota_monthly_statement') {
      loadBookingChannels();
    }
  }, [selectedReport]);

  const handleChannelFieldChange = (id: number, field: keyof BookingChannel, value: string | boolean) => {
    setBookingChannels((channels) => channels.map((channel) => (
      channel.id === id ? { ...channel, [field]: value } : channel
    )));
  };

  const handleSaveChannel = async (channel: BookingChannel) => {
    setSavingChannelId(channel.id);
    setChannelSaveError('');
    try {
      const updated = await ReportsService.updateBookingChannel(channel.id, {
        name: channel.name,
        channel_type: channel.channel_type,
        default_commission_type: channel.default_commission_type,
        default_commission_value: Number(channel.default_commission_value || 0),
        default_commission_scope: channel.default_commission_scope,
        is_active: channel.is_active,
      });
      setBookingChannels((channels) => channels.map((item) => item.id === updated.id ? updated : item));
    } catch (err: unknown) {
      setChannelSaveError(getQueryErrorMessage(err, 'Failed to save booking channel') ?? 'Failed to save booking channel');
    } finally {
      setSavingChannelId(null);
    }
  };

  const handleAddChannel = async () => {
    if (!newChannelName.trim()) return;

    setSavingChannelId(-1);
    setChannelSaveError('');
    try {
      const created = await ReportsService.createBookingChannel({
        name: newChannelName.trim(),
        channel_type: newChannelType,
        default_commission_type: 'none',
        default_commission_value: 0,
        default_commission_scope: 'per_booking',
        is_active: true,
      });
      setBookingChannels((channels) => [...channels, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewChannelName('');
      setNewChannelType('ota');
    } catch (err: unknown) {
      setChannelSaveError(getQueryErrorMessage(err, 'Failed to add booking channel') ?? 'Failed to add booking channel');
    } finally {
      setSavingChannelId(null);
    }
  };

  const handlePrintPreview = () => {
    setPrintPreviewOpen(true);
  };

  const handlePrint = () => {
    const printContent = document.getElementById('print-preview-content');
    if (!printContent) return;

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) {
      // Fallback: if popup blocked, use window.print() with iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(`
          <html>
            <head>
              <title>Report - ${selectedReport}</title>
              <style>
                ${reportPrintStyles}
              </style>
            </head>
            <body>${printContent.innerHTML}</body>
          </html>
        `);
        iframeDoc.close();
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
      }
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Report - ${selectedReport}</title>
          <style>
            ${reportPrintStyles}
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const handleClosePrintPreview = () => {
    setPrintPreviewOpen(false);
  };

  const handleReportTypeChange = (type: ReportType) =>
    handleReportTypeChangeHook(type, startDate, endDate);

  const handleStatementMonthChange = (monthValue: string) => {
    if (!monthValue) return;
    const [year, month] = monthValue.split('-').map(Number);
    if (!year || !month) return;
    setStartDate(formatLocalDate(new Date(year, month - 1, 1)));
    setEndDate(formatLocalDate(new Date(year, month, 0)));
  };

  const handleGenerateReport = () =>
    handleGenerateReportHook(
      selectedReport,
      startDate,
      endDate,
      selectedCompany,
      selectedReport === 'channel_net_revenue' || selectedReport === 'ota_monthly_statement'
        ? {
            bookingChannelId: channelFilterId || undefined,
            platformName: platformFilter.trim() || undefined,
            bookingStatus: selectedReport === 'channel_net_revenue' && bookingStatusFilter !== 'all' ? bookingStatusFilter : undefined,
            postedStatus: postedStatusFilter !== 'all' ? postedStatusFilter : undefined,
            roomType: selectedReport === 'channel_net_revenue' ? roomTypeFilter.trim() || undefined : undefined,
          }
        : {}
    );

  const formatMoney = (value: unknown) => `${currencySymbol}${Number(value || 0).toFixed(2)}`;

  const handleChannelSort = (key: ChannelSortKey) => {
    setChannelSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortedChannelRows = () => {
    const rows = [...(reportData?.rows || [])];
    const direction = channelSort.direction === 'asc' ? 1 : -1;

    return rows.sort((a: ChannelNetRevenueRow, b: ChannelNetRevenueRow) => {
      const left = a[channelSort.key];
      const right = b[channelSort.key];
      if (typeof left === 'number' || typeof right === 'number') {
        return (Number(left || 0) - Number(right || 0)) * direction;
      }
      return String(left || '').localeCompare(String(right || '')) * direction;
    });
  };

  const handleExportChannelCsv = () => {
    if (!reportData?.rows?.length) return;

    const headers = [
      'Business Date',
      'Booking',
      'Guest',
      'Room',
      'Room Type',
      'Check In',
      'Check Out',
      'Channel',
      'Gross Room Revenue',
      'Commission Type',
      'Commission Value',
      'Commission Amount',
      'Net Hotel Revenue',
      'Service Tax',
      'Tourism Tax',
      'Status',
      'Posted Status',
    ];
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.map(escapeCsv).join(','),
      ...getSortedChannelRows().map((row: ChannelNetRevenueRow) => [
        row.business_date,
        row.booking_number,
        row.guest_name,
        row.room_number,
        row.room_type,
        row.check_in_date,
        row.check_out_date,
        row.booking_channel,
        Number(row.gross_room_revenue || 0).toFixed(2),
        row.commission_type,
        Number(row.commission_value || 0).toFixed(2),
        Number(row.commission_amount || 0).toFixed(2),
        Number(row.net_hotel_revenue || 0).toFixed(2),
        Number(row.service_tax || 0).toFixed(2),
        Number(row.tourism_tax || 0).toFixed(2),
        row.booking_status,
        row.posted_status,
      ].map(escapeCsv).join(',')),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `channel-net-revenue-${startDate}-to-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Render Guest Ledger

  // Render Company Ledger Statement

  // Render Balance Sheet

  // Render Shift Report

  // Render Rooms Sold

  // ============================================================================
  // NEW HOTEL MANAGEMENT REPORTS
  // ============================================================================

  // Daily Operations Report

  // Occupancy Report

  // Revenue Report

  const renderChannelCommissionEditor = () => (
    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle1" gutterBottom sx={{
        fontWeight: "medium"
      }}>
        Channel Commission Rates
      </Typography>
      {channelSaveError && <Alert severity="error" sx={{ mb: 2 }}>{channelSaveError}</Alert>}

      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.100' }}>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Commission</TableCell>
              <TableCell align="right">Value</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Save</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {channelsLoading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <CircularProgress size={22} />
                </TableCell>
              </TableRow>
            ) : bookingChannels.map((channel) => (
              <TableRow key={channel.id}>
                <TableCell sx={{ minWidth: 150 }}>
                  <TextField
                    size="small"
                    value={channel.name}
                    onChange={(e) => handleChannelFieldChange(channel.id, 'name', e.target.value)}
                    fullWidth
                  />
                </TableCell>
                <TableCell sx={{ minWidth: 130 }}>
                  <TextField
                    select
                    size="small"
                    value={channel.channel_type}
                    onChange={(e) => handleChannelFieldChange(channel.id, 'channel_type', e.target.value)}
                    fullWidth
                  >
                    {CHANNEL_TYPES.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell sx={{ minWidth: 145 }}>
                  <TextField
                    select
                    size="small"
                    value={channel.default_commission_type}
                    onChange={(e) => handleChannelFieldChange(channel.id, 'default_commission_type', e.target.value)}
                    fullWidth
                  >
                    {COMMISSION_TYPES.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell align="right" sx={{ minWidth: 110 }}>
                  <TextField
                    size="small"
                    type="number"
                    value={channel.default_commission_value}
                    onChange={(e) => handleChannelFieldChange(channel.id, 'default_commission_value', e.target.value)}
                    disabled={channel.default_commission_type === 'none'}
                    slotProps={{
                      htmlInput: { min: 0, step: '0.01' }
                    }}
                  />
                </TableCell>
                <TableCell sx={{ minWidth: 130 }}>
                  <TextField
                    select
                    size="small"
                    value={channel.default_commission_scope}
                    onChange={(e) => handleChannelFieldChange(channel.id, 'default_commission_scope', e.target.value)}
                    disabled={channel.default_commission_type !== 'fixed_amount'}
                    fullWidth
                  >
                    {COMMISSION_SCOPES.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell sx={{ minWidth: 110 }}>
                  <TextField
                    select
                    size="small"
                    value={channel.is_active ? 'active' : 'inactive'}
                    onChange={(e) => handleChannelFieldChange(channel.id, 'is_active', e.target.value === 'active')}
                    fullWidth
                  >
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    color="primary"
                    onClick={() => handleSaveChannel(channel)}
                    disabled={savingChannelId === channel.id}
                    aria-label={`Save channel ${channel.name ?? ''}`}
                  >
                    {savingChannelId === channel.id ? <CircularProgress size={20} /> : <SaveIcon />}
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Grid container spacing={1} sx={{
        alignItems: "center"
      }}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <TextField
            size="small"
            label="New Channel"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            select
            size="small"
            label="Type"
            value={newChannelType}
            onChange={(e) => setNewChannelType(e.target.value)}
            fullWidth
          >
            {CHANNEL_TYPES.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, md: 2 }}>
          <Button
            variant="outlined"
            startIcon={savingChannelId === -1 ? <CircularProgress size={18} /> : <AddIcon />}
            onClick={handleAddChannel}
            disabled={!newChannelName.trim() || savingChannelId === -1}
          >
            Add
          </Button>
        </Grid>
      </Grid>
    </Box>
  );

  const renderSortableHeader = (key: ChannelSortKey, label: string, align: 'left' | 'right' = 'left') => (
    <TableCell align={align}>
      <TableSortLabel
        active={channelSort.key === key}
        direction={channelSort.key === key ? channelSort.direction : 'asc'}
        onClick={() => handleChannelSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const renderCommissionLabel = (row: ChannelNetRevenueRow) => {
    if (row.commission_type === 'percentage') {
      return `${Number(row.commission_value || 0).toFixed(2)}%`;
    }
    if (row.commission_type === 'fixed_amount') {
      return `${formatMoney(row.commission_value)} ${row.commission_scope === 'per_night' ? '/ night' : '/ booking'}`;
    }
    return 'None';
  };

  const renderChannelNetRevenue = () => {
    if (!reportData) return <Typography>No data available</Typography>;

    const { summary } = reportData;
    const detailRows = getSortedChannelRows();

    return (
      <Box>
        <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" sx={{
            fontWeight: "bold"
          }}>Channel Net Revenue</Typography>
          <Typography variant="h6">{hotelSettings.hotel_name}</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {reportData.period?.start} to {reportData.period?.end}
          </Typography>
        </Box>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e8f5e9' }}>
              <Typography variant="h5" sx={{
                color: "success.main"
              }}>{formatMoney(summary?.total_gross_revenue)}</Typography>
              <Typography variant="caption">Gross Room Revenue</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#fff3e0' }}>
              <Typography variant="h5" sx={{
                color: "warning.main"
              }}>{formatMoney(summary?.total_platform_commission)}</Typography>
              <Typography variant="caption">Platform Commission</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#e3f2fd' }}>
              <Typography variant="h5" sx={{
                color: "primary.main"
              }}>{formatMoney(summary?.total_net_hotel_revenue)}</Typography>
              <Typography variant="caption">Net Hotel Revenue</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#f3e5f5' }}>
              <Typography variant="h5" sx={{
                color: "secondary.main"
              }}>
                {Number(summary?.average_commission_percentage || 0).toFixed(2)}%
              </Typography>
              <Typography variant="caption">Average Commission</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h5">{summary?.total_bookings || 0}</Typography>
              <Typography variant="caption">Bookings</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h5">{summary?.room_nights || 0}</Typography>
              <Typography variant="caption">Room Nights</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" noWrap>{summary?.top_ota_by_revenue?.channel_name || '-'}</Typography>
              <Typography variant="caption">Top OTA by Revenue</Typography>
            </Paper>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="subtitle2" noWrap>{summary?.top_ota_by_commission_cost?.channel_name || '-'}</Typography>
              <Typography variant="caption">Top OTA by Commission</Typography>
            </Paper>
          </Grid>
        </Grid>
        <Typography variant="h6" gutterBottom>By Channel</Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell>Channel</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Room Nights</TableCell>
                <TableCell align="right">Gross</TableCell>
                <TableCell align="right">Commission</TableCell>
                <TableCell align="right">Net</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportData.by_channel?.map((channel: ChannelRevenueSummary) => (
                <TableRow key={channel.channel_name}>
                  <TableCell>{channel.channel_name}</TableCell>
                  <TableCell>{channel.channel_type}</TableCell>
                  <TableCell align="right">{channel.room_nights}</TableCell>
                  <TableCell align="right">{formatMoney(channel.gross_revenue)}</TableCell>
                  <TableCell align="right">{formatMoney(channel.commission_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(channel.net_revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="h6" gutterBottom>Booking Detail</Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                {renderSortableHeader('business_date', 'Business Date')}
                {renderSortableHeader('booking_number', 'Booking')}
                {renderSortableHeader('guest_name', 'Guest')}
                <TableCell>Room</TableCell>
                <TableCell>Room Type</TableCell>
                {renderSortableHeader('booking_channel', 'Channel')}
                {renderSortableHeader('gross_room_revenue', 'Gross', 'right')}
                <TableCell align="right">Rate / Value</TableCell>
                {renderSortableHeader('commission_amount', 'Commission', 'right')}
                {renderSortableHeader('net_hotel_revenue', 'Net', 'right')}
                <TableCell align="right">Taxes</TableCell>
                {renderSortableHeader('posted_status', 'Posted')}
              </TableRow>
            </TableHead>
            <TableBody>
              {detailRows.length > 0 ? detailRows.map((row: ChannelNetRevenueRow) => (
                <TableRow key={`${row.booking_id}-${row.business_date}-${row.posted_status}`}>
                  <TableCell>{row.business_date}</TableCell>
                  <TableCell>{row.booking_number}</TableCell>
                  <TableCell>{row.guest_name}</TableCell>
                  <TableCell>{row.room_number}</TableCell>
                  <TableCell>{row.room_type}</TableCell>
                  <TableCell>{row.booking_channel}</TableCell>
                  <TableCell align="right">{formatMoney(row.gross_room_revenue)}</TableCell>
                  <TableCell align="right">{renderCommissionLabel(row)}</TableCell>
                  <TableCell align="right">{formatMoney(row.commission_amount)}</TableCell>
                  <TableCell align="right">{formatMoney(row.net_hotel_revenue)}</TableCell>
                  <TableCell align="right">
                    {formatMoney(Number(row.service_tax || 0) + Number(row.tourism_tax || 0))}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.posted_status}
                      size="small"
                      color={row.posted_status === 'posted' ? 'success' : 'warning'}
                    />
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={12} align="center">No channel revenue rows found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };


  // Payment Status Report

  // Complimentary Report

  // Guest Statistics Report

  // Room Performance Report

  const renderReport = () => {
    switch (selectedReport) {
      // New hotel management reports
      case 'daily_operations': return <DailyOperationsReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'occupancy': return <OccupancyReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'revenue': return <RevenueReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'channel_net_revenue': return renderChannelNetRevenue();
      case 'ota_monthly_statement': return <OtaMonthlyStatementReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'payment_status': return <PaymentStatusReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'complimentary': return <ComplimentaryReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'guest_statistics': return <GuestStatisticsReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'room_performance': return <RoomPerformanceReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      // Legacy accounting reports
      case 'general_journal': return <GeneralJournalReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'company_ledger_statement': return <CompanyLedgerStatementReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'balance_sheet': return <BalanceSheetReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'shift_report': return <ShiftReportView reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      case 'rooms_sold': return <RoomsSoldReport reportData={reportData} hotelSettings={hotelSettings} currencySymbol={currencySymbol} startDate={startDate} endDate={endDate} />;
      default: return null;
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReportIcon fontSize="large" />
        Reports
      </Typography>
      {/* Report Type Selection */}
      <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Select Report Type</Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {REPORT_CONFIGS.map((config) => (
          <Grid key={config.type} size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
            <Card
              sx={{
                cursor: 'pointer',
                border: selectedReport === config.type ? `3px solid ${config.color}` : '1px solid #e0e0e0',
                bgcolor: selectedReport === config.type ? `${config.color}10` : 'white',
                '&:hover': { boxShadow: 4, transform: 'translateY(-2px)' },
                transition: 'all 0.2s',
              }}
              onClick={() => handleReportTypeChange(config.type)}
            >
              <CardContent sx={{ textAlign: 'center', py: 2 }}>
                <Box sx={{ color: config.color, mb: 1 }}>{config.icon}</Box>
                <Typography variant="subtitle2" sx={{
                  fontWeight: "bold"
                }}>{config.label}</Typography>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{config.description}</Typography>
                {selectedReport === config.type && (
                  <Chip label="Selected" size="small" color="primary" sx={{ mt: 1 }} />
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      {/* Parameters */}
      {selectedReport && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>Report Parameters</Typography>
            <Grid container spacing={2} sx={{
              alignItems: "center"
            }}>
              {selectedReport === 'ota_monthly_statement' ? (
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField
                    fullWidth
                    label="Statement Month"
                    type="month"
                    value={startDate.slice(0, 7)}
                    onChange={(e) => handleStatementMonthChange(e.target.value)}
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                </Grid>
              ) : (
                <>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <TextField
                      fullWidth
                      label="Start Date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      slotProps={{
                        inputLabel: { shrink: true }
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <TextField
                      fullWidth
                      label="End Date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      slotProps={{
                        inputLabel: { shrink: true }
                      }}
                    />
                  </Grid>
                </>
              )}


              {selectedReport === 'company_ledger_statement' && (
                <Grid size={{ xs: 12, sm: 6, md: 6 }}>
                  <TextField
                    select
                    fullWidth
                    label="Select Company"
                    value={selectedCompany}
                    onChange={(e) => setSelectedCompany(e.target.value)}
                    disabled={loadingCompanies}
                    helperText={loadingCompanies ? 'Loading...' : companyList.length === 0 ? 'No companies found' : ''}
                  >
                    {companyList.map((c) => (
                      <MenuItem key={c.company_name} value={c.company_name}>
                        {c.company_name} ({c.entry_count} entries)
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
              )}

              {(selectedReport === 'channel_net_revenue' || selectedReport === 'ota_monthly_statement') && (
                <>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <TextField
                      select
                      fullWidth
                      label="Booking Channel"
                      value={channelFilterId}
                      onChange={(e) => setChannelFilterId(e.target.value)}
                      disabled={channelsLoading}
                    >
                      <MenuItem value="">All Channels</MenuItem>
                      {bookingChannels.filter((channel) => channel.is_active).map((channel) => (
                        <MenuItem key={channel.id} value={String(channel.id)}>
                          {channel.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <TextField
                      fullWidth
                      label="Platform Name"
                      value={platformFilter}
                      onChange={(e) => setPlatformFilter(e.target.value)}
                    />
                  </Grid>
                  {selectedReport === 'channel_net_revenue' && (
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <TextField
                        select
                        fullWidth
                        label="Booking Status"
                        value={bookingStatusFilter}
                        onChange={(e) => setBookingStatusFilter(e.target.value)}
                      >
                        <MenuItem value="all">All Statuses</MenuItem>
                        <MenuItem value="pending">Pending</MenuItem>
                        <MenuItem value="confirmed">Confirmed</MenuItem>
                        <MenuItem value="checked_in">Checked In</MenuItem>
                        <MenuItem value="auto_checked_in">Auto Checked In</MenuItem>
                        <MenuItem value="checked_out">Checked Out</MenuItem>
                        <MenuItem value="completed">Completed</MenuItem>
                      </TextField>
                    </Grid>
                  )}
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <TextField
                      select
                      fullWidth
                      label="Posted"
                      value={postedStatusFilter}
                      onChange={(e) => setPostedStatusFilter(e.target.value)}
                    >
                      <MenuItem value="all">Posted + Unposted</MenuItem>
                      <MenuItem value="posted">Posted</MenuItem>
                      <MenuItem value="unposted">Unposted</MenuItem>
                    </TextField>
                  </Grid>
                  {selectedReport === 'channel_net_revenue' && (
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <TextField
                        fullWidth
                        label="Room Type"
                        value={roomTypeFilter}
                        onChange={(e) => setRoomTypeFilter(e.target.value)}
                      />
                    </Grid>
                  )}
                  <Grid size={12}>
                    {renderChannelCommissionEditor()}
                  </Grid>
                </>
              )}

              <Grid size={12}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <PreviewIcon />}
                    onClick={handleGenerateReport}
                    disabled={loading}
                  >
                    {loading ? 'Generating...' : 'Generate Report'}
                  </Button>
                  {reportData && (
                    <>
                      <Button variant="outlined" size="large" startIcon={<PrintIcon />} onClick={handlePrintPreview}>
                        Print Report
                      </Button>
                      {selectedReport === 'channel_net_revenue' && (
                        <Button variant="outlined" size="large" startIcon={<DownloadIcon />} onClick={handleExportChannelCsv}>
                          Export CSV
                        </Button>
                      )}
                    </>
                  )}
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {/* Report Preview */}
      {reportData && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Report Preview</Typography>
            <Divider sx={{ mb: 2 }} />
            <Box ref={printRef} sx={[{ p: 2, bgcolor: 'white' }, reportContentSx]}>
              {renderReport()}
            </Box>
          </CardContent>
        </Card>
      )}
      {/* Print Preview Dialog */}
      <Dialog
        open={printPreviewOpen}
        onClose={handleClosePrintPreview}
        maxWidth="lg"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              height: '90vh',
              maxHeight: '90vh',
            }
          }
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">Print Preview</Typography>
          <IconButton onClick={handleClosePrintPreview} size="small" aria-label="Close print preview">
            <CloseIcon />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: 0 }}>
          <Box
            id="print-preview-content"
            sx={[
              {
                p: 3,
                bgcolor: 'white',
                minHeight: '100%',
              },
              reportContentSx,
              {
                '@media print': {
                  p: 2,
                  '& .MuiPaper-root': {
                    boxShadow: 'none',
                  },
                },
              },
            ]}
          >
            {renderReport()}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button onClick={handleClosePrintPreview}>Cancel</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModernReportsPage;
