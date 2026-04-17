import { useState, useCallback } from 'react';
import { HotelAPIService } from '../../../api';

type ReportType =
  | 'daily_operations'
  | 'occupancy'
  | 'revenue'
  | 'payment_status'
  | 'complimentary'
  | 'guest_statistics'
  | 'room_performance'
  | 'general_journal'
  | 'company_ledger_statement'
  | 'balance_sheet'
  | 'shift_report'
  | 'rooms_sold';

export interface CompanyOption {
  company_name: string;
  entry_count: number;
  total_balance: number;
}

export function useReportData() {
  const today = new Date().toISOString().split('T')[0];
  const [selectedReport, setSelectedReport] = useState<ReportType | ''>('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [companyList, setCompanyList] = useState<CompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState<any>(null);

  const loadCompanyList = useCallback(async (start: string, end: string) => {
    try {
      setLoadingCompanies(true);
      const data = await HotelAPIService.generateReport({
        reportType: 'company_ledger_statement',
        startDate: start,
        endDate: end,
      });
      if (data.type === 'company_list' && data.companies) {
        setCompanyList(data.companies);
      }
    } catch (err: any) {
      console.error('Failed to load company list:', err);
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  const handleReportTypeChange = useCallback(async (type: ReportType, start: string, end: string) => {
    setSelectedReport(type);
    setReportData(null);
    setError('');
    if (type === 'company_ledger_statement') {
      await loadCompanyList(start, end);
    }
  }, [loadCompanyList]);

  const handleGenerateReport = useCallback(async (
    report: ReportType | '',
    start: string,
    end: string,
    company: string
  ) => {
    if (!report) {
      setError('Please select a report type');
      return;
    }
    if (report === 'company_ledger_statement' && !company) {
      setError('Please select a company');
      return;
    }
    setLoading(true);
    setError('');
    setReportData(null);
    try {
      const params: any = { reportType: report, startDate: start, endDate: end };
      if (report === 'company_ledger_statement' && company) {
        params.companyName = company;
      }
      const data = await HotelAPIService.generateReport(params);
      setReportData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
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
    loadCompanyList,
    handleReportTypeChange,
    handleGenerateReport,
  };
}
