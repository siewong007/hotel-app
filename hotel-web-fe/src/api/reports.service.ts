import { api } from './client';
import { withRetry } from '../utils/retry';

export class ReportsService {
  static async generateReport(params: {
    reportType: string;
    startDate: string;
    endDate: string;
    shift?: string;
    drawer?: string;
  }): Promise<any> {
    const searchParams = new URLSearchParams({
      report_type: params.reportType,
      start_date: params.startDate,
      end_date: params.endDate,
    });

    if (params.shift) searchParams.append('shift', params.shift);
    if (params.drawer) searchParams.append('drawer', params.drawer);

    return await withRetry(
      () => api.get('reports/generate', { searchParams }).json(),
      { maxAttempts: 3, initialDelay: 1500 }
    );
  }

  static async downloadReportPDF(params: {
    reportType: string;
    startDate: string;
    endDate: string;
    shift?: string;
    drawer?: string;
  }): Promise<Blob> {
    const searchParams = new URLSearchParams({
      report_type: params.reportType,
      start_date: params.startDate,
      end_date: params.endDate,
    });

    if (params.shift) searchParams.append('shift', params.shift);
    if (params.drawer) searchParams.append('drawer', params.drawer);

    return await api.get('reports/pdf', { searchParams }).blob();
  }
}
