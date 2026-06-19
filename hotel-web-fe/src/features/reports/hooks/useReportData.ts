import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReportsService } from '../../../api';
import { getQueryErrorMessage, queryGcTime, queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { formatLocalDate } from '../../../utils/date';

type ReportType =
  | 'daily_operations'
  | 'occupancy'
  | 'revenue'
  | 'channel_net_revenue'
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

type ReportParams = {
  reportType: ReportType;
  startDate: string;
  endDate: string;
  companyName?: string;
  bookingChannelId?: number | string;
  bookingChannel?: string;
  platformName?: string;
  bookingStatus?: string;
  postedStatus?: string;
  roomType?: string;
};

const companyListParams = (startDate: string, endDate: string): ReportParams => ({
  reportType: 'company_ledger_statement',
  startDate,
  endDate,
});

const getCompanyList = async (startDate: string, endDate: string) => {
  const data = await ReportsService.generateReport(companyListParams(startDate, endDate));
  return data.type === 'company_list' && data.companies
    ? data.companies as CompanyOption[]
    : [];
};

export function useReportData() {
  const queryClient = useQueryClient();
  const today = formatLocalDate();
  const [selectedReport, setSelectedReport] = useState<ReportType | ''>('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [error, setError] = useState('');
  const [reportParams, setReportParams] = useState<ReportParams | null>(null);

  const companyListQuery = useQuery({
    queryKey: queryKeys.reports.companyList(startDate, endDate),
    queryFn: () => getCompanyList(startDate, endDate),
    enabled: selectedReport === 'company_ledger_statement',
    staleTime: queryStaleTime.long,
    gcTime: queryGcTime.long,
  });

  const reportQuery = useQuery({
    queryKey: queryKeys.reports.generated(reportParams ? { ...reportParams } : undefined),
    queryFn: () => ReportsService.generateReport(reportParams!),
    enabled: reportParams != null,
    staleTime: queryStaleTime.short,
    gcTime: queryGcTime.long,
  });

  const loadCompanyList = useCallback(async (start: string, end: string) => {
    try {
      await queryClient.ensureQueryData({
        queryKey: queryKeys.reports.companyList(start, end),
        queryFn: () => getCompanyList(start, end),
        staleTime: queryStaleTime.long,
      });
    } catch (err: any) {
      console.error('Failed to load company list:', err);
    }
  }, [queryClient]);

  const handleReportTypeChange = useCallback(async (type: ReportType, start: string, end: string) => {
    setSelectedReport(type);
    setReportParams(null);
    setSelectedCompany('');
    setError('');
    if (type === 'company_ledger_statement') {
      await loadCompanyList(start, end);
    }
  }, [loadCompanyList]);

  const handleGenerateReport = useCallback(async (
    report: ReportType | '',
    start: string,
    end: string,
    company: string,
    extraParams: Partial<ReportParams> = {}
  ) => {
    if (!report) {
      setError('Please select a report type');
      return;
    }
    if (report === 'company_ledger_statement' && !company) {
      setError('Please select a company');
      return;
    }
    setError('');
    setReportParams({
      reportType: report,
      startDate: start,
      endDate: end,
      ...(report === 'company_ledger_statement' && company ? { companyName: company } : {}),
      ...extraParams,
    });
  }, []);

  const queryError = getQueryErrorMessage(reportQuery.error, 'Failed to generate report');

  return {
    selectedReport,
    setSelectedReport,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    selectedCompany,
    setSelectedCompany,
    companyList: companyListQuery.data ?? [],
    loadingCompanies: companyListQuery.isFetching,
    loading: reportQuery.isFetching,
    error: error || queryError || '',
    setError,
    reportData: reportQuery.data ?? null,
    loadCompanyList,
    handleReportTypeChange,
    handleGenerateReport,
  };
}
