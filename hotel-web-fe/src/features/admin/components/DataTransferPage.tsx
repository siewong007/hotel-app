import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Divider,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Upload as UploadIcon,
  DeleteSweep as OverwriteIcon,
  CheckCircle as SuccessIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { DataTransferService, BookingDataExport, ImportResult } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';

const TABLE_LABELS: Record<string, string> = {
  guests: 'Guests',
  guest_complimentary_credits: 'Guest Credits',
  companies: 'Companies',
  bookings: 'Bookings',
  payments: 'Payments',
  invoices: 'Invoices',
  booking_guests: 'Booking Guests',
  booking_modifications: 'Booking Modifications',
  booking_history: 'Booking History',
  night_audit_runs: 'Night Audit Runs',
  night_audit_details: 'Night Audit Details',
  customer_ledgers: 'Customer Ledgers',
  customer_ledger_payments: 'Ledger Payments',
  room_changes: 'Room Changes',
  user_guests: 'User-Guest Links',
  room_types: 'Room Types',
  rooms: 'Rooms',
};

const DataTransferPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exportPreview, setExportPreview] = useState<BookingDataExport | null>(null);
  const [importFile, setImportFile] = useState<BookingDataExport | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<'import' | 'overwrite' | null>(null);

  if (!hasRole('admin')) {
    return (
      <Alert severity="warning">
        You do not have permission to access this page. Only administrators can manage data transfer.
      </Alert>
    );
  }

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setImportResult(null);
    try {
      const data = await DataTransferService.exportData();
      setExportPreview(data);

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hotel-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Data exported successfully! File has been downloaded.');
    } catch (err: any) {
      setError(err.message || 'Failed to export data');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);
    setImportResult(null);
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as BookingDataExport;
        if (!data.version || !data.bookings) {
          setError('Invalid data file format. Please select a valid export file.');
          setImportFile(null);
          return;
        }
        setImportFile(data);
      } catch {
        setError('Failed to parse JSON file. Please select a valid export file.');
        setImportFile(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async (mode: 'import' | 'overwrite') => {
    if (!importFile) return;
    setConfirmDialog(null);
    setLoading(true);
    setError(null);
    setSuccess(null);
    setImportResult(null);
    try {
      const result = await DataTransferService.importData(mode, importFile);
      setImportResult(result);
      setSuccess(
        mode === 'overwrite'
          ? 'All existing data has been replaced with imported data.'
          : 'Data imported successfully! Duplicate records were skipped.'
      );
    } catch (err: any) {
      setError(err.message || 'Failed to import data');
    } finally {
      setLoading(false);
    }
  };

  const getRecordCounts = (data: BookingDataExport) => {
    return Object.entries(TABLE_LABELS).map(([key, label]) => ({
      key,
      label,
      count: (data as any)[key]?.length || 0,
    }));
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        Data Transfer
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Export, import, or overwrite all booking and guest related data.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }} icon={<SuccessIcon />}>
          {success}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Export Section */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <DownloadIcon color="primary" />
                <Typography variant="h6">Export Data</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Download all booking and guest data as a JSON file. Includes guests, bookings, payments,
                invoices, night audit records, customer ledgers, and room changes.
              </Typography>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} /> : <DownloadIcon />}
                onClick={handleExport}
                disabled={loading}
                fullWidth
                size="large"
              >
                {loading ? 'Exporting...' : 'Export All Data'}
              </Button>

              {exportPreview && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Exported at: {new Date(exportPreview.exported_at).toLocaleString()}
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Table</TableCell>
                          <TableCell align="right">Records</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {getRecordCounts(exportPreview).map((row) => (
                          <TableRow key={row.key}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell align="right">
                              <Chip label={row.count} size="small" color={row.count > 0 ? 'primary' : 'default'} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Import Section */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <UploadIcon color="secondary" />
                <Typography variant="h6">Import Data</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Upload a previously exported JSON file to restore data. Choose to append new records
                or overwrite all existing data.
              </Typography>

              <Button
                variant="outlined"
                component="label"
                fullWidth
                sx={{ mb: 2 }}
              >
                {importFileName || 'Select JSON File'}
                <input
                  type="file"
                  accept=".json"
                  hidden
                  onChange={handleFileSelect}
                />
              </Button>

              {importFile && (
                <>
                  <Alert severity="info" sx={{ mb: 2 }} icon={<InfoIcon />}>
                    <Typography variant="body2">
                      File: <strong>{importFileName}</strong> (v{importFile.version})
                    </Typography>
                    <Typography variant="caption">
                      Exported: {new Date(importFile.exported_at).toLocaleString()}
                    </Typography>
                  </Alert>

                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Table</TableCell>
                          <TableCell align="right">Records</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {getRecordCounts(importFile).map((row) => (
                          <TableRow key={row.key}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell align="right">
                              <Chip label={row.count} size="small" color={row.count > 0 ? 'secondary' : 'default'} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Button
                        variant="contained"
                        color="primary"
                        startIcon={loading ? <CircularProgress size={20} /> : <UploadIcon />}
                        onClick={() => setConfirmDialog('import')}
                        disabled={loading}
                        fullWidth
                      >
                        Import
                      </Button>
                    </Grid>
                    <Grid item xs={6}>
                      <Button
                        variant="contained"
                        color="error"
                        startIcon={loading ? <CircularProgress size={20} /> : <OverwriteIcon />}
                        onClick={() => setConfirmDialog('overwrite')}
                        disabled={loading}
                        fullWidth
                      >
                        Overwrite
                      </Button>
                    </Grid>
                  </Grid>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Import Result */}
      {importResult && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <SuccessIcon color="success" />
              <Typography variant="h6">
                {importResult.mode === 'overwrite' ? 'Overwrite' : 'Import'} Complete
              </Typography>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Table</TableCell>
                    <TableCell align="right">Records Imported</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(importResult.records_imported).map(([key, count]) => (
                    <TableRow key={key}>
                      <TableCell>{TABLE_LABELS[key] || key}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label={count}
                          size="small"
                          color={count > 0 ? 'success' : 'default'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialogs */}
      <Dialog open={confirmDialog === 'import'} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>Confirm Import</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 1 }}>
            This will add new records from the file. Existing records with matching IDs will be skipped (no duplicates).
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => handleImport('import')}>
            Confirm Import
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDialog === 'overwrite'} onClose={() => setConfirmDialog(null)}>
        <DialogTitle sx={{ color: 'error.main' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningIcon />
            Confirm Overwrite
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              This will DELETE ALL existing booking and guest data and replace it with the imported file.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              This action cannot be undone. Make sure you have a backup before proceeding.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => handleImport('overwrite')}>
            Delete All & Overwrite
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DataTransferPage;
