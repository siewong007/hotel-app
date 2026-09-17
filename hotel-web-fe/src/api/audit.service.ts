import { api } from './client';
import { withRetry } from '../utils/retry';
import { formatHotelDateTime, formatLocalDate } from '../utils/date';
import { formatStatusLabel } from '../utils/formatters';
import { translateFor } from '../i18n';
import {
  AuditLogResponse,
  AuditLogQuery,
  AuditUser,
  AuditCategoryCounts,
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
      if (params.resource_id) searchParams.set('resource_id', params.resource_id.toString());
      if (params.category && params.category !== 'all') searchParams.set('category', params.category);
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
   * Get event counts per activity stream (honours date-range + search filters)
   */
  static async getCategoryCounts(params?: AuditLogQuery): Promise<AuditCategoryCounts> {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.start_date) searchParams.set('start_date', params.start_date);
      if (params.end_date) searchParams.set('end_date', params.end_date);
      if (params.search) searchParams.set('search', params.search);
    }
    const queryString = searchParams.toString();
    const url = queryString
      ? `audit-logs/category-counts?${queryString}`
      : 'audit-logs/category-counts';

    return await withRetry(
      () => api.get(url).json<AuditCategoryCounts>(),
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
      if (params.resource_id) searchParams.set('resource_id', params.resource_id.toString());
      if (params.category && params.category !== 'all') searchParams.set('category', params.category);
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
    a.download = `audit_logs_${formatLocalDate()}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  /**
   * Rows for PDF/print — same cap and permission as CSV (`audit:export`).
   */
  static async exportRows(params?: AuditLogQuery): Promise<{
    exported_by: string;
    exported_at: string;
    truncated: boolean;
    row_count: number;
    data: AuditLogResponse['data'];
  }> {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.user_id) searchParams.set('user_id', params.user_id.toString());
      if (params.action) searchParams.set('action', params.action);
      if (params.resource_type) searchParams.set('resource_type', params.resource_type);
      if (params.resource_id) searchParams.set('resource_id', params.resource_id.toString());
      if (params.category && params.category !== 'all') searchParams.set('category', params.category);
      if (params.start_date) searchParams.set('start_date', params.start_date);
      if (params.end_date) searchParams.set('end_date', params.end_date);
      if (params.search) searchParams.set('search', params.search);
    }
    const queryString = searchParams.toString();
    const url = queryString ? `audit-logs/export/json?${queryString}` : 'audit-logs/export/json';
    return await api.get(url).json();
  }

  /**
   * Generate PDF from current filter (client-side using jspdf)
   */
  static async downloadPDF(params?: AuditLogQuery): Promise<void> {
    const exported = await this.exportRows(params);
    const response = { data: exported.data };

    // Dynamic import of jspdf and jspdf-autotable.
    // jspdf-autotable v5 no longer augments the jsPDF prototype — it must be
    // called functionally as autoTable(doc, options).
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF();
    // NOTE: document strings stay English on purpose — jsPDF's built-in
    // helvetica covers Latin-1 only, so zh/ms copy would render as mojibake
    // until a CJK-capable font is embedded via addFont. Dates are pinned to
    // 'en' for the same reason (zh-CN month/meridiem names are non-Latin-1).
    const exportT = (key: string, vars?: Record<string, string | number>) =>
      translateFor('en', `admin:audit.pdf.${key}`, vars);

    // Title
    doc.setFontSize(16);
    doc.text(exportT('reportTitle'), 14, 20);

    // Generated date
    doc.setFontSize(10);
    doc.text(exportT('generatedAt', { time: formatHotelDateTime(exported.exported_at, '-', 'en') }), 14, 28);
    doc.text(exportT('exportedBy', { user: exported.exported_by }), 14, 33);
    if (exported.truncated) {
      doc.text(exportT('truncated', { count: exported.row_count }), 14, 38);
    }

    // Table data
    const tableData = response.data.map((log) => [
      formatHotelDateTime(log.created_at, '-', 'en'),
      log.username || exportT('systemUser'),
      formatStatusLabel(log.action, ''),
      log.category || '-',
      formatStatusLabel(log.resource_type, ''),
      log.resource_id?.toString() || '-',
      log.has_changes === false || log.change_kind === 'action_only'
        ? exportT('actionOnly')
        : exportT('fieldChanges'),
      log.ip_address || '-',
    ]);

    // Add table (jspdf-autotable v5 functional API)
    autoTable(doc, {
      startY: exported.truncated ? 44 : 40,
      head: [[
        exportT('col.timestamp'),
        exportT('col.user'),
        exportT('col.action'),
        exportT('col.stream'),
        exportT('col.resource'),
        exportT('col.id'),
        exportT('col.changeType'),
        exportT('col.ip'),
      ]],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [16, 164, 124] },
    });

    doc.save(`audit_logs_${formatLocalDate()}.pdf`);
  }
}
