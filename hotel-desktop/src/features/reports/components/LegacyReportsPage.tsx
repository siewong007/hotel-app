import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  TextField,
  MenuItem,
  Paper,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  Print as PrintIcon,
  Download as DownloadIcon,
  Assessment as ReportIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';

type ReportType = 'balance_sheet' | 'journal_by_type' | 'shift_report' | 'rooms_sold' | 'general_journal' | 'company_ledger_statement';

interface ReportParams {
  reportType: ReportType;
  startDate: string;
  endDate: string;
  shift?: 'all' | '1' | '2' | '3';
  drawer?: 'all' | string;
  companyName?: string;
}

interface CompanyOption {
  company_name: string;
  entry_count: number;
  total_balance: number;
}

const LegacyReportsPage: React.FC = () => {
  const { symbol: currencySymbol } = useCurrency();
  const [reportType, setReportType] = useState<ReportType>('shift_report');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [shift, setShift] = useState<string>('all');
  const [drawer, setDrawer] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState<any>(null);
  const [companyList, setCompanyList] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const reportTypes = [
    { value: 'balance_sheet', label: 'Balance Sheet' },
    { value: 'journal_by_type', label: 'List Journal By Type' },
    { value: 'shift_report', label: 'Shift Report' },
    { value: 'rooms_sold', label: 'Rooms Sold Detail by Date' },
    { value: 'general_journal', label: 'General Journal' },
    { value: 'company_ledger_statement', label: 'Company Ledger Statement' },
  ];

  // Load company list when company_ledger_statement is selected
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

  // Load companies when report type changes to company_ledger_statement
  React.useEffect(() => {
    if (reportType === 'company_ledger_statement') {
      loadCompanyList();
    }
  }, [reportType]);

  const handleGenerateReport = async () => {
    setLoading(true);
    setError('');
    setReportData(null);

    try {
      const params: ReportParams = {
        reportType,
        startDate,
        endDate,
        shift: shift as any,
        drawer,
      };

      // Add company name for company ledger statement
      if (reportType === 'company_ledger_statement' && selectedCompany) {
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

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    try {
      const blob = await HotelAPIService.downloadReportPDF({
        reportType,
        startDate,
        endDate,
        shift: shift as any,
        drawer,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}_${startDate}_${endDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Failed to download PDF');
    }
  };

  const renderBalanceSheet = () => {
    if (!reportData) return null;

    return (
      <Paper sx={{ p: 3, mt: 3 }} className="print-content">
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            Balance Sheet
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">
            Salim Inn
          </Typography>
          <Typography variant="caption" color="text.secondary">
            As of {endDate}
          </Typography>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Account</strong></TableCell>
                <TableCell align="right"><strong>Debit</strong></TableCell>
                <TableCell align="right"><strong>Credit</strong></TableCell>
                <TableCell align="right"><strong>Balance</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportData.accounts?.map((account: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{account.name}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(account.debit || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(account.credit || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(account.balance || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell><strong>Total</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.totalDebit || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.totalCredit || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.totalBalance || 0).toFixed(2)}</strong></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    );
  };

  const renderJournalByType = () => {
    if (!reportData) return null;

    return (
      <Paper sx={{ p: 3, mt: 3 }} className="print-content">
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom textAlign="center">
            List Journal By Type
          </Typography>
          <Typography variant="subtitle2" color="text.secondary" textAlign="center">
            Salim Inn
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" textAlign="center">
            {startDate} to {endDate}
          </Typography>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Folio</TableCell>
                <TableCell>Act</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Debit</TableCell>
                <TableCell align="right">Credit</TableCell>
                <TableCell>Room</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportData.transactions?.map((txn: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{new Date(txn.date).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(txn.date).toLocaleTimeString()}</TableCell>
                  <TableCell>{txn.folio}</TableCell>
                  <TableCell>{txn.account_code}</TableCell>
                  <TableCell>{txn.description}</TableCell>
                  <TableCell align="right">{Number(txn.debit) > 0 ? `${currencySymbol}${Number(txn.debit).toFixed(2)}` : ''}</TableCell>
                  <TableCell align="right">{Number(txn.credit) > 0 ? `${currencySymbol}${Number(txn.credit).toFixed(2)}` : ''}</TableCell>
                  <TableCell>{txn.room}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell colSpan={5}><strong>** Totals:</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.totalDebit || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.totalCredit || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    );
  };

  const renderShiftReport = () => {
    if (!reportData) return null;

    return (
      <Paper sx={{ p: 3, mt: 3 }} className="print-content">
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            Shift Report
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">
            Salim Inn
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Shift: {shift === 'all' ? 'All' : `Shift ${shift}`}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Drawer: {drawer === 'all' ? 'All' : drawer}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Date: {startDate} to {endDate}
          </Typography>
        </Box>

        {/* F/O Revenue */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom sx={{ bgcolor: 'grey.200', p: 1 }}>
            F/O Revenue:
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell colSpan={2}></TableCell>
                <TableCell align="right"><strong>Actual</strong></TableCell>
                <TableCell align="right"><strong>Difference</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={2}>100 - Room Charge</TableCell>
                <TableCell align="right">{reportData.revenue?.room_count || 0}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(reportData.revenue?.room_total || 0).toFixed(2)}</TableCell>
              </TableRow>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell colSpan={2}><strong>* Total Room:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.revenue?.room_count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.revenue?.room_total || 0).toFixed(2)}</strong></TableCell>
              </TableRow>
              <TableRow sx={{ bgcolor: 'grey.200' }}>
                <TableCell colSpan={2}><strong>** Total F/O Revenue:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.revenue?.room_count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.revenue?.room_total || 0).toFixed(2)}</strong></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        {/* F/O Settlement */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom sx={{ bgcolor: 'grey.200', p: 1 }}>
            F/O Settlement:
          </Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell><strong>Cash</strong></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
              {reportData.settlement?.cash?.map((item: any, index: number) => (
                <TableRow key={`cash-${index}`}>
                  <TableCell sx={{ pl: 4 }}>{item.code} - {item.description}</TableCell>
                  <TableCell align="right">{item.count}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(item.amount || 0).toFixed(2)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell sx={{ pl: 4 }}><strong>* Total Cash:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.settlement?.cash_count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.settlement?.cash_total || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell><strong>Credit Card</strong></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
              {reportData.settlement?.credit_card?.map((item: any, index: number) => (
                <TableRow key={`cc-${index}`}>
                  <TableCell sx={{ pl: 4 }}>{item.code} - {item.description}</TableCell>
                  <TableCell align="right">{item.count}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(item.amount || 0).toFixed(2)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell sx={{ pl: 4 }}><strong>* Total Credit Card:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.settlement?.cc_count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.settlement?.cc_total || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow>
                <TableCell><strong>Debit Card</strong></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
              {reportData.settlement?.debit_card?.map((item: any, index: number) => (
                <TableRow key={`dc-${index}`}>
                  <TableCell sx={{ pl: 4 }}>{item.code} - {item.description}</TableCell>
                  <TableCell align="right">{item.count}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(item.amount || 0).toFixed(2)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell sx={{ pl: 4 }}><strong>* Total Debit Card:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.settlement?.dc_count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.settlement?.dc_total || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>

              <TableRow sx={{ bgcolor: 'grey.200' }}>
                <TableCell><strong>** Total F/O Settlement:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.settlement?.total_count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.settlement?.total_amount || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        {/* Taxes */}
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ bgcolor: 'grey.200', p: 1 }}>
            Taxes:
          </Typography>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell><strong>SST</strong></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ pl: 4 }}>105 - Service Tax</TableCell>
                <TableCell align="right">{reportData.taxes?.count || 0}</TableCell>
                <TableCell align="right">{currencySymbol}{Number(reportData.taxes?.total || 0).toFixed(2)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell sx={{ pl: 4 }}><strong>* Total SST:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.taxes?.count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.taxes?.total || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>
              <TableRow sx={{ bgcolor: 'grey.200' }}>
                <TableCell><strong>** Total Taxes:</strong></TableCell>
                <TableCell align="right"><strong>{reportData.taxes?.count || 0}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(reportData.taxes?.total || 0).toFixed(2)}</strong></TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      </Paper>
    );
  };

  const renderRoomsSoldReport = () => {
    if (!reportData) return null;

    return (
      <Paper sx={{ p: 3, mt: 3 }} className="print-content">
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            Rooms Sold Detail by Date
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">
            Salim Inn
          </Typography>
          <Typography variant="caption" color="text.secondary">
            For: {startDate} - {endDate} Normal Stays, No Shows, Same Day Stays
          </Typography>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Room</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Folio</TableCell>
                <TableCell>Guest Name</TableCell>
                <TableCell>Post Type</TableCell>
                <TableCell>In-Out Date</TableCell>
                <TableCell>A/C</TableCell>
                <TableCell>Rate</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportData.bookings?.map((booking: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{new Date(booking.check_in_date).toLocaleDateString()}</TableCell>
                  <TableCell>{booking.room_number}</TableCell>
                  <TableCell>{booking.room_type}</TableCell>
                  <TableCell>{booking.folio}</TableCell>
                  <TableCell>{booking.guest_name}</TableCell>
                  <TableCell>{booking.post_type}</TableCell>
                  <TableCell>
                    {new Date(booking.check_in_date).toLocaleDateString().split('/').slice(0,2).join('/')}-
                    {new Date(booking.check_out_date).toLocaleDateString().split('/').slice(0,2).join('/')}
                  </TableCell>
                  <TableCell>{booking.adult_count}/{booking.child_count}</TableCell>
                  <TableCell>{booking.rate_plan}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell colSpan={9}>
                  <strong>** Total Rooms Sold: {reportData.total_rooms || 0}</strong>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    );
  };

  const renderGeneralJournal = () => {
    if (!reportData) return null;

    return (
      <Paper sx={{ p: 3, mt: 3 }} className="print-content">
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            General Journal
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">
            Salim Inn
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {new Date(startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} to {new Date(endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          </Typography>
        </Box>

        {/* Column Headers */}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Ledger</strong></TableCell>
                <TableCell><strong>Date</strong></TableCell>
                <TableCell><strong>Account</strong></TableCell>
                <TableCell align="right"><strong>Debits</strong></TableCell>
                <TableCell align="right" colSpan={2}><strong>Credits</strong></TableCell>
              </TableRow>
            </TableHead>
          </Table>
        </TableContainer>

        {/* Render each section */}
        {reportData.sections?.map((section: any, sectionIndex: number) => (
          <Box key={sectionIndex} sx={{ mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2, mb: 1 }}>
              {section.name}
            </Typography>

            <TableContainer>
              <Table size="small">
                <TableBody>
                  {section.entries?.length > 0 ? (
                    section.entries.map((entry: any, entryIndex: number) => (
                      <TableRow key={entryIndex}>
                        <TableCell sx={{ width: '15%' }}></TableCell>
                        <TableCell sx={{ width: '12%' }}>{entry.date}</TableCell>
                        <TableCell sx={{ width: '18%' }}>{entry.account}</TableCell>
                        <TableCell align="right" sx={{ width: '15%' }}>
                          {Number(entry.debit) > 0 ? `${currencySymbol}${Number(entry.debit).toFixed(2)}` : '0.00'}
                        </TableCell>
                        <TableCell align="right" sx={{ width: '20%' }}>
                          {Number(entry.contra_amount) > 0 ? `-${currencySymbol}${Number(entry.contra_amount).toFixed(2)}` : '0.00'} {entry.contra_account}
                        </TableCell>
                        <TableCell align="right" sx={{ width: '20%' }}></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ pl: 4 }}>
                        <Typography variant="body2" color="text.secondary">** Totals:</Typography>
                      </TableCell>
                    </TableRow>
                  )}

                  {/* Section totals */}
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell colSpan={3}><strong>** Totals:</strong></TableCell>
                    <TableCell align="right">
                      <strong>{currencySymbol}{Number(section.total_debit || 0).toFixed(2)}</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>{Number(section.net_amount || 0).toFixed(2)} Net amount:</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>{currencySymbol}{Math.abs(Number(section.net_amount || 0)).toFixed(2)}</strong>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))}

        {/* Overall Balance */}
        <Box sx={{ mt: 3, pt: 2, borderTop: '2px solid #ccc' }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell colSpan={4}></TableCell>
                <TableCell align="right"><strong>Balance:</strong></TableCell>
                <TableCell align="right">
                  <strong>{currencySymbol}{Number(reportData.balance || 0).toFixed(2)}</strong>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      </Paper>
    );
  };

  const renderCompanyLedgerStatement = () => {
    if (!reportData || reportData.type !== 'company_statement') return null;

    const { company, statement_date, balance_due, last_payment, existing_credit, aging, transactions, totals } = reportData;

    return (
      <Paper sx={{ p: 3, mt: 3 }} className="print-content">
        {/* Header */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <Typography variant="h6" fontWeight="bold">Salim Inn</Typography>
            <Typography variant="body2">No 21-22 Lorong Salim 17, Jalan Salim</Typography>
            <Typography variant="body2">Sibu, 96000, Sarawak, East Malaysia</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>TTx ID: 132-2017-10000017</Typography>
          </Grid>
          <Grid item xs={6} textAlign="right">
            <Typography variant="h5" fontWeight="bold">Account Statement</Typography>
            <Typography variant="body2">Page 1</Typography>
          </Grid>
        </Grid>

        {/* Account Summary Box */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <Typography variant="body2" sx={{ mt: 2 }}>
              <strong>Attn: {company.contact_person || 'N/A'}</strong>
            </Typography>
            <Typography variant="body1" fontWeight="bold">{company.name}</Typography>
            {company.address?.line1 && <Typography variant="body2">{company.address.line1}</Typography>}
            {(company.address?.city || company.address?.state) && (
              <Typography variant="body2">
                {[company.address.city, company.address.state, company.address.postal_code].filter(Boolean).join(', ')}
              </Typography>
            )}
            {company.address?.country && <Typography variant="body2">{company.address.country}</Typography>}
          </Grid>
          <Grid item xs={6}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ border: 0, py: 0.5 }}>Account Number</TableCell>
                    <TableCell sx={{ border: 0, py: 0.5 }} align="right">{company.registration_number || '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ border: 0, py: 0.5 }}>Statement Date</TableCell>
                    <TableCell sx={{ border: 0, py: 0.5 }} align="right">{statement_date}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ border: 0, py: 0.5 }}>Balance Due</TableCell>
                    <TableCell sx={{ border: 0, py: 0.5 }} align="right">{currencySymbol}{Number(balance_due).toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ border: 0, py: 0.5 }}>Last Payment</TableCell>
                    <TableCell sx={{ border: 0, py: 0.5 }} align="right">{last_payment?.date || '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ border: 0, py: 0.5 }}>Existing Credit</TableCell>
                    <TableCell sx={{ border: 0, py: 0.5 }} align="right">{currencySymbol}{Number(existing_credit || 0).toFixed(2)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Please make all cheques payable to 'SALIM INN'
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              Net 30 days.
            </Typography>
          </Grid>
        </Grid>

        {/* Aging Summary */}
        <TableContainer sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.300' }}>
                <TableCell align="center"><strong>Open Balance</strong></TableCell>
                <TableCell align="center"><strong>31-60 days</strong></TableCell>
                <TableCell align="center"><strong>61-90 days</strong></TableCell>
                <TableCell align="center"><strong>91-120 days</strong></TableCell>
                <TableCell align="center"><strong>Over 120 days</strong></TableCell>
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

        {/* Transaction Details */}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.200' }}>
                <TableCell><strong>Invoice Date</strong></TableCell>
                <TableCell><strong>Voucher</strong></TableCell>
                <TableCell><strong>Invoice</strong></TableCell>
                <TableCell><strong>Reference</strong></TableCell>
                <TableCell align="right"><strong>Original Amount</strong></TableCell>
                <TableCell align="right"><strong>Payments Received</strong></TableCell>
                <TableCell align="right"><strong>Finance Charges</strong></TableCell>
                <TableCell align="right"><strong>Open Amount</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions?.map((txn: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{txn.invoice_date || '-'}</TableCell>
                  <TableCell sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {txn.voucher}
                  </TableCell>
                  <TableCell>{txn.invoice || '-'}</TableCell>
                  <TableCell>{txn.reference}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.original_amount).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.payments_received).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.finance_charges || 0).toFixed(2)}</TableCell>
                  <TableCell align="right">{currencySymbol}{Number(txn.open_amount).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {/* Totals Row */}
              <TableRow sx={{ bgcolor: 'grey.100' }}>
                <TableCell colSpan={4}><strong>Total</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(totals?.original_amount || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(totals?.payments_received || 0).toFixed(2)}</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}0.00</strong></TableCell>
                <TableCell align="right"><strong>{currencySymbol}{Number(totals?.open_amount || 0).toFixed(2)}</strong></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    );
  };

  const renderReport = () => {
    switch (reportType) {
      case 'balance_sheet':
        return renderBalanceSheet();
      case 'journal_by_type':
        return renderJournalByType();
      case 'shift_report':
        return renderShiftReport();
      case 'rooms_sold':
        return renderRoomsSoldReport();
      case 'general_journal':
        return renderGeneralJournal();
      case 'company_ledger_statement':
        return renderCompanyLedgerStatement();
      default:
        return null;
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        <ReportIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        Legacy-Style Reports
      </Typography>

      <Card sx={{ mb: 3 }} className="no-print">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Generate Report
          </Typography>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                select
                fullWidth
                label="Report Type"
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
              >
                {reportTypes.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {reportType === 'shift_report' && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    select
                    fullWidth
                    label="Shift"
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                  >
                    <MenuItem value="all">All Shifts</MenuItem>
                    <MenuItem value="1">Shift 1 (Morning)</MenuItem>
                    <MenuItem value="2">Shift 2 (Evening)</MenuItem>
                    <MenuItem value="3">Shift 3 (Night)</MenuItem>
                  </TextField>
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    select
                    fullWidth
                    label="Drawer"
                    value={drawer}
                    onChange={(e) => setDrawer(e.target.value)}
                  >
                    <MenuItem value="all">All Drawers</MenuItem>
                    <MenuItem value="1">Drawer 1</MenuItem>
                    <MenuItem value="2">Drawer 2</MenuItem>
                  </TextField>
                </Grid>
              </>
            )}

            {reportType === 'company_ledger_statement' && (
              <Grid item xs={12} md={6}>
                <TextField
                  select
                  fullWidth
                  label="Select Company"
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  disabled={loadingCompanies}
                  helperText={loadingCompanies ? 'Loading companies...' : companyList.length === 0 ? 'No companies with ledger entries' : ''}
                >
                  {companyList.map((company) => (
                    <MenuItem key={company.company_name} value={company.company_name}>
                      {company.company_name} ({company.entry_count} entries - {currencySymbol}{Number(company.total_balance).toFixed(2)} balance)
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}

            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                  variant="contained"
                  startIcon={<ReportIcon />}
                  onClick={handleGenerateReport}
                  disabled={loading}
                >
                  {loading ? 'Generating...' : 'Generate Report'}
                </Button>

                {reportData && (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<PrintIcon />}
                      onClick={handlePrint}
                    >
                      Print
                    </Button>

                    <Button
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      onClick={handleDownloadPDF}
                    >
                      Download PDF
                    </Button>
                  </>
                )}
              </Box>
            </Grid>
          </Grid>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {renderReport()}

      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          .print-content {
            box-shadow: none !important;
            margin: 0 !important;
            padding: 20px !important;
          }
        }
      `}</style>
    </Box>
  );
};

export default LegacyReportsPage;
