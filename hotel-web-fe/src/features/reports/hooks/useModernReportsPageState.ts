/**
 * Custom hook for ModernReportsPage.tsx (1,619 lines).
 * Extracts state for report type selection, report generation, and print preview.
 */
import { useState, useCallback } from 'react';

export type ReportType = 'occupancy' | 'revenue' | 'guest' | 'room' | 'payment' | 'maintenance';

export function useModernReportsPageState() {
  const [reportType, setReportType] = useState<ReportType>('occupancy');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [filterRoomType, setFilterRoomType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const handleReportTypeChange = useCallback((type: ReportType) => {
    setReportType(type);
    setReportData(null);
    setReportError(null);
  }, []);

  const handleGenerateReport = useCallback(() => {
    setReportLoading(true);
    setReportError(null);
    // Report generation logic is delegated to the component's data fetching
  }, []);

  const handlePrintPreview = useCallback(() => {
    setPrintPreviewOpen(true);
  }, []);

  const handlePrint = useCallback(() => {
    const printContent = document.getElementById('print-preview-content');
    if (!printContent) return;
    const printWindow = window.open('', '', 'width=800,height=600');
    if (printWindow) {
      printWindow.document.write('<html><head><title>Report</title></head><body>');
      printWindow.document.write(printContent.innerHTML);
      printWindow.document.write('</body></html>');
      printWindow.document.close();
      printWindow.print();
    }
  }, []);

  const handleClosePrintPreview = useCallback(() => {
    setPrintPreviewOpen(false);
  }, []);

  return {
    reportType, setReportType, dateRange, setDateRange,
    reportLoading, setReportLoading, reportData, setReportData,
    reportError, setReportError, printPreviewOpen, setPrintPreviewOpen,
    filterRoomType, setFilterRoomType, filterStatus, setFilterStatus,
    handleReportTypeChange, handleGenerateReport,
    handlePrintPreview, handlePrint, handleClosePrintPreview,
  };
}