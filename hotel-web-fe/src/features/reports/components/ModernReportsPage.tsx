import React, { useState, useRef } from 'react';
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
  CircularProgress,
  Alert,
  Divider,
  Chip,
} from '@mui/material';
import {
  Assessment as ReportIcon,
  Print as PrintIcon,
  Visibility as PreviewIcon,
  Business as BusinessIcon,
  CalendarMonth as CalendarIcon,
  AccountBalance as LedgerIcon,
  Receipt as ReceiptIcon,
  TrendingUp as TrendingIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';

type ReportType =
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

const REPORT_CONFIGS = [
  {
    type: 'general_journal' as ReportType,
    label: 'General Journal',
    description: 'Daily double-entry accounting journal',
    icon: <LedgerIcon />,
    color: '#1976d2',
  },
  {
    type: 'company_ledger_statement' as ReportType,
    label: 'Company Ledger Statement',
    description: 'Account statement for companies',
    icon: <BusinessIcon />,
    color: '#388e3c',
  },
  {
    type: 'balance_sheet' as ReportType,
    label: 'Balance Sheet',
    description: 'Summary of account balances',
    icon: <TrendingIcon />,
    color: '#f57c00',
  },
  {
    type: 'shift_report' as ReportType,
    label: 'Shift Report',
    description: 'Revenue report by shift',
    icon: <ReceiptIcon />,
    color: '#7b1fa2',
  },
  {
    type: 'rooms_sold' as ReportType,
    label: 'Rooms Sold Report',
    description: 'Room occupancy details',
    icon: <CalendarIcon />,
    color: '#c62828',
  },
];

const ModernReportsPage: React.FC = () => {
  const { symbol: currencySymbol } = useCurrency();
  const printRef = useRef<HTMLDivElement>(null);

  const [selectedReport, setSelectedReport] = useState<ReportType | ''>('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [shift, setShift] = useState<string>('all');
  const [drawer, setDrawer] = useState<string>('all');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [companyList, setCompanyList] = useState<CompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState<any>(null);

  const handlePrint = () => {
    if (printRef.current) {
      const printContent = printRef.current.innerHTML;
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Report - ${selectedReport}</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                table { border-collapse: collapse; width: 100%; margin: 10px 0; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f5f5f5; }
                h1, h2, h3, h4, h5, h6 { margin: 10px 0; }
                .header { text-align: center; margin-bottom: 20px; }
              </style>
            </head>
            <body>${printContent}</body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  };

  const loadCompanyList = async () => {
    try {
      setLoadingCompanies(true);
      const data = await HotelAPIService.generateReport({
        reportType: 'company_ledger_statement',
        startDate,
        endDate,
      });
      if (data.type === 'company_list' && data.companies) {
        setCompanyList(data.companies);
      }
    } catch (err: any) {
      console.error('Failed to load company list:', err);
    } finally {
      setLoadingCompanies(false);
    }
  };

  const handleReportTypeChange = async (type: ReportType) => {
    setSelectedReport(type);
    setReportData(null);
    setError('');
    if (type === 'company_ledger_statement') {
      await loadCompanyList();
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedReport) {
      setError('Please select a report type');
      return;
    }

    if (selectedReport === 'company_ledger_statement' && !selectedCompany) {
      setError('Please select a company');
      return;
    }

    setLoading(true);
    setError('');
    setReportData(null);

    try {
      const params: any = {
        reportType: selectedReport,
        startDate,
        endDate,
      };

      if (selectedReport === 'shift_report') {
        params.shift = shift;
        params.drawer = drawer;
      }

      if (selectedReport === 'company_ledger_statement' && selectedCompany) {
        params.companyName = selectedCompany;
      }

      const data = await HotelAPIService.generateReport(params);
      setReportData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  // Render General Journal
  const renderGeneralJournal = () => {
    if (!reportData?.sections) return <Typography>No data available</Typography>;

    return (
      <Box>
        <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" fontWeight="bold">General Journal</Typography>
          <Typography variant="h6">Salim Inn</Typography>
          <Typography variant="body2" color="text.secondary">
            {new Date(startDate).toLocaleDateString()} to {new Date(endDate).toLocaleDateString()}
          </Typography>
        </Box>

        {reportData.sections.map((section: any, idx: number) => (
          <Box key={idx} sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ bgcolor: 'grey.200', p: 1 }}>{section.name}</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Date</strong></TableCell>
                    <TableCell><strong>Account</strong></TableCell>
                    <TableCell align="right"><strong>Debit</strong></TableCell>
                    <TableCell align="right"><strong>Credit</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {section.entries?.map((entry: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{entry.date}</TableCell>
                      <TableCell>{entry.account}</TableCell>
                      <TableCell align="right">
                        {Number(entry.debit) > 0 ? `${currencySymbol}${Number(entry.debit).toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell align="right">
                        {Number(entry.credit || entry.contra_amount) > 0
                          ? `${currencySymbol}${Number(entry.credit || entry.contra_amount).toFixed(2)}`
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell colSpan={2}><strong>Total</strong></TableCell>
                    <TableCell align="right"><strong>{currencySymbol}{Number(section.total_debit || 0).toFixed(2)}</strong></TableCell>
                    <TableCell align="right"><strong>{currencySymbol}{Number(section.total_credit || 0).toFixed(2)}</strong></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))}

        <Divider sx={{ my: 2 }} />
        <Typography variant="h6" align="right">
          Balance: {currencySymbol}{Number(reportData.balance || 0).toFixed(2)}
        </Typography>
      </Box>
    );
  };

  // Render Company Ledger Statement
  const renderCompanyLedgerStatement = () => {
    if (!reportData || reportData.type !== 'company_statement') {
      return <Typography>No data available</Typography>;
    }

    const { company, statement_date, balance_due, last_payment, aging, transactions, totals } = reportData;

    return (
      <Box>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <Typography variant="h4" fontWeight="bold">Salim Inn</Typography>
            <Typography variant="body2">No 21-22 Lorong Salim 17, Jalan Salim</Typography>
            <Typography variant="body2">Sibu, 96000, Sarawak</Typography>
          </Grid>
          <Grid item xs={6} textAlign="right">
            <Typography variant="h4" fontWeight="bold">Account Statement</Typography>
            <Typography variant="body2">Date: {statement_date}</Typography>
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="text.secondary">Bill To:</Typography>
              <Typography variant="h6" fontWeight="bold">{company?.name}</Typography>
              {company?.contact_person && <Typography>Attn: {company.contact_person}</Typography>}
              {company?.address?.line1 && <Typography variant="body2">{company.address.line1}</Typography>}
            </Paper>
          </Grid>
          <Grid item xs={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography><strong>Balance Due:</strong> {currencySymbol}{Number(balance_due || 0).toFixed(2)}</Typography>
              <Typography><strong>Last Payment:</strong> {last_payment?.date || 'N/A'}</Typography>
            </Paper>
          </Grid>
        </Grid>

        <Typography variant="h6" gutterBottom>Aging Summary</Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                <TableCell sx={{ color: 'white' }} align="center">Current</TableCell>
                <TableCell sx={{ color: 'white' }} align="center">31-60 Days</TableCell>
                <TableCell sx={{ color: 'white' }} align="center">61-90 Days</TableCell>
                <TableCell sx={{ color: 'white' }} align="center">91-120 Days</TableCell>
                <TableCell sx={{ color: 'white' }} align="center">Over 120 Days</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell align="center">{currencySymbol}{Number(aging?.open_balance || 0).toFixed(2)}</TableCell>
                <TableCell align="center">{currencySymbol}{Number(aging?.days_31_60 || 0).toFixed(2)}</TableCell>
                <TableCell align="center">{currencySymbol}{Number(aging?.days_61_90 || 0).toFixed(2)}</TableCell>
                <TableCell align="center">{currencySymbol}{Number(aging?.days_91_120 || 0).toFixed(2)}</TableCell>
                <TableCell align="center">{currencySymbol}{Number(aging?.over_120_days || 0).toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="h6" gutterBottom>Transactions</Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Paid</TableCell>
                <TableCell align="right">Balance</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions?.map((txn: any, idx: number) => (
                <TableRow key={idx}>
                  <TableCell>{txn.invoice_date || '-'}</TableCell>
                  <TableCell>{txn.voucher}</TableCell>
                  <TableCell>{txn.invoice || '-'}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.original_amount || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.payments_received || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.open_amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.200' }}>
                <TableCell colSpan={3}><strong>Total</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(totals?.original_amount || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(totals?.payments_received || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(totals?.open_amount || 0).toFixed(2)}</strong></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };

  // Render Balance Sheet
  const renderBalanceSheet = () => {
    if (!reportData?.accounts) return <Typography>No data available</Typography>;

    return (
      <Box>
        <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" fontWeight="bold">Balance Sheet</Typography>
          <Typography variant="h6">Salim Inn</Typography>
          <Typography variant="body2">As of {new Date(endDate).toLocaleDateString()}</Typography>
        </Box>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell><strong>Account</strong></TableCell>
                <TableCell align="right"><strong>Debit</strong></TableCell>
                <TableCell align="right"><strong>Credit</strong></TableCell>
                <TableCell align="right"><strong>Balance</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportData.accounts.map((acc: any, idx: number) => (
                <TableRow key={idx}>
                  <TableCell>{acc.account_name || acc.name}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(acc.debit || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(acc.credit || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(acc.balance || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };

  // Render Shift Report
  const renderShiftReport = () => {
    if (!reportData) return <Typography>No data available</Typography>;

    return (
      <Box>
        <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" fontWeight="bold">Shift Report</Typography>
          <Typography variant="h6">Salim Inn</Typography>
          <Typography variant="body2">
            {new Date(startDate).toLocaleDateString()} - {new Date(endDate).toLocaleDateString()}
            {shift !== 'all' && ` | Shift ${shift}`}
          </Typography>
        </Box>

        {reportData.revenue && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ bgcolor: 'primary.main', color: 'white', p: 1 }}>Revenue</Typography>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  {Object.entries(reportData.revenue).map(([key, value]: [string, any]) => (
                    <TableRow key={key}>
                      <TableCell>{key.replace(/_/g, ' ')}</TableCell>
                      <TableCell align="right">{currencySymbol}{Number(value || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {reportData.settlement && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ bgcolor: 'success.main', color: 'white', p: 1 }}>Settlement</Typography>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  {Object.entries(reportData.settlement).map(([key, value]: [string, any]) => (
                    <TableRow key={key}>
                      <TableCell>{key.replace(/_/g, ' ')}</TableCell>
                      <TableCell align="right">{currencySymbol}{Number(value || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Box>
    );
  };

  // Render Rooms Sold
  const renderRoomsSold = () => {
    if (!reportData?.bookings) return <Typography>No data available</Typography>;

    return (
      <Box>
        <Box className="header" sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" fontWeight="bold">Rooms Sold Report</Typography>
          <Typography variant="h6">Salim Inn</Typography>
          <Typography variant="body2">
            {new Date(startDate).toLocaleDateString()} to {new Date(endDate).toLocaleDateString()}
          </Typography>
        </Box>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell>Date</TableCell>
                <TableCell>Room</TableCell>
                <TableCell>Guest</TableCell>
                <TableCell>Check In</TableCell>
                <TableCell>Check Out</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportData.bookings.map((b: any, idx: number) => (
                <TableRow key={idx}>
                  <TableCell>{b.date}</TableCell>
                  <TableCell>{b.room_number}</TableCell>
                  <TableCell>{b.guest_name || '-'}</TableCell>
                  <TableCell>{b.check_in}</TableCell>
                  <TableCell>{b.check_out}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(b.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="h6" sx={{ mt: 2 }} align="right">
          Total Rooms: {reportData.total_rooms || reportData.bookings.length}
        </Typography>
      </Box>
    );
  };

  const renderReport = () => {
    switch (selectedReport) {
      case 'general_journal': return renderGeneralJournal();
      case 'company_ledger_statement': return renderCompanyLedgerStatement();
      case 'balance_sheet': return renderBalanceSheet();
      case 'shift_report': return renderShiftReport();
      case 'rooms_sold': return renderRoomsSold();
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
          <Grid item xs={12} sm={6} md={4} lg={2.4} key={config.type}>
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
                <Typography variant="subtitle2" fontWeight="bold">{config.label}</Typography>
                <Typography variant="caption" color="text.secondary">{config.description}</Typography>
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
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="Start Date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="End Date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>

              {selectedReport === 'shift_report' && (
                <>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField select fullWidth label="Shift" value={shift} onChange={(e) => setShift(e.target.value)}>
                      <MenuItem value="all">All Shifts</MenuItem>
                      <MenuItem value="1">Shift 1 (Morning)</MenuItem>
                      <MenuItem value="2">Shift 2 (Evening)</MenuItem>
                      <MenuItem value="3">Shift 3 (Night)</MenuItem>
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField select fullWidth label="Drawer" value={drawer} onChange={(e) => setDrawer(e.target.value)}>
                      <MenuItem value="all">All Drawers</MenuItem>
                      <MenuItem value="1">Drawer 1</MenuItem>
                      <MenuItem value="2">Drawer 2</MenuItem>
                    </TextField>
                  </Grid>
                </>
              )}

              {selectedReport === 'company_ledger_statement' && (
                <Grid item xs={12} sm={6} md={6}>
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

              <Grid item xs={12}>
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
                    <Button variant="outlined" size="large" startIcon={<PrintIcon />} onClick={handlePrint}>
                      Print Report
                    </Button>
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
            <Box ref={printRef} sx={{ p: 2, bgcolor: 'white' }}>
              {renderReport()}
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default ModernReportsPage;
