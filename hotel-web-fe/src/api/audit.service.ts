import { api } from './client';
import { withRetry } from '../utils/retry';
import {
  AuditLogResponse,
  AuditLogQuery,
  AuditUser,
} from '../types/audit.types';

export class AuditService {
  /**
   * Get paginated audit logs with optional filters
   */
  static async getAuditLogs(params?: AuditLogQuery): Promise<AuditLogResponse> {
    const searchParams = new URLSearchParams();

    if (params) {
      if (params.user_id) searchParams.set('user_id', params.user_id.toString());
      if (params.action) searchParams.set('action', params.action);
      if (params.resource_type) searchParams.set('resource_type', params.resource_type);
      if (params.start_date) searchParams.set('start_date', params.start_date);
      if (params.end_date) searchParams.set('end_date', params.end_date);
      if (params.search) searchParams.set('search', params.search);
      if (params.page) searchParams.set('page', params.page.toString());
      if (params.page_size) searchParams.set('page_size', params.page_size.toString());
      if (params.sort_by) searchParams.set('sort_by', params.sort_by);
      if (params.sort_order) searchParams.set('sort_order', params.sort_order);
    }

    const queryString = searchParams.toString();
    const url = queryString ? `audit-logs?${queryString}` : 'audit-logs';

    return await withRetry(
      () => api.get(url).json<AuditLogResponse>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Get distinct action types for filter dropdown
   */
  static async getAuditActions(): Promise<string[]> {
    return await withRetry(
      () => api.get('audit-logs/actions').json<string[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Get distinct resource types for filter dropdown
   */
  static async getAuditResourceTypes(): Promise<string[]> {
    return await withRetry(
      () => api.get('audit-logs/resource-types').json<string[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Get users who have audit log entries
   */
  static async getAuditUsers(): Promise<AuditUser[]> {
    return await withRetry(
      () => api.get('audit-logs/users').json<AuditUser[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  /**
   * Export audit logs as CSV
   */
  static async exportCSV(params?: AuditLogQuery): Promise<Blob> {
    const searchParams = new URLSearchParams();

    if (params) {
      if (params.user_id) searchParams.set('user_id', params.user_id.toString());
      if (params.action) searchParams.set('action', params.action);
      if (params.resource_type) searchParams.set('resource_type', params.resource_type);
      if (params.start_date) searchParams.set('start_date', params.start_date);
      if (params.end_date) searchParams.set('end_date', params.end_date);
      if (params.search) searchParams.set('search', params.search);
    }

    const queryString = searchParams.toString();
    const url = queryString ? `audit-logs/export/csv?${queryString}` : 'audit-logs/export/csv';

    return await api.get(url).blob();
  }

  /**
   * Download CSV file
   */
  static async downloadCSV(params?: AuditLogQuery): Promise<void> {
    const blob = await this.exportCSV(params);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  /**
   * Generate PDF from current filter (client-side using jspdf)
   */
  static async downloadPDF(params?: AuditLogQuery): Promise<void> {
    // Get all logs (up to 10000) for PDF export
    const response = await this.getAuditLogs({
      ...params,
      page: 1,
      page_size: 10000,
    });

    // Dynamic import of jspdf and jspdf-autotable
    const { jsPDF } = await import('jspdf');
    await import('jspdf-autotable');

    const doc = new jsPDF();

    // Title
    doc.setFontSize(16);
    doc.text('Audit Log Report', 14, 20);

    // Generated date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    // Table data
    const tableData = response.data.map((log) => [
      new Date(log.created_at).toLocaleString(),
      log.username || 'System',
      log.action.replace(/_/g, ' '),
      log.resource_type.replace(/_/g, ' '),
      log.resource_id?.toString() || '-',
      log.ip_address || '-',
    ]);

    // Add table
    (doc as any).autoTable({
      startY: 35,
      head: [['Timestamp', 'User', 'Action', 'Resource', 'ID', 'IP']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 66, 66] },
    });

    doc.save(`audit_logs_${new Date().toISOString().split('T')[0]}.pdf`);
  }
}
