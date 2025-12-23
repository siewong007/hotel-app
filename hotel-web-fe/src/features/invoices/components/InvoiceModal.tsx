import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  IconButton,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Print as PrintIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';

interface InvoiceModalProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
}

const InvoiceModal: React.FC<InvoiceModalProps> = ({ open, onClose, bookingId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceData, setInvoiceData] = useState<any>(null);

  useEffect(() => {
    if (open && bookingId) {
      loadInvoice();
    }
  }, [open, bookingId]);

  const loadInvoice = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await HotelAPIService.getInvoicePreview(bookingId);
      setInvoiceData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    // Create a printable version
    const printContent = document.getElementById('invoice-content');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice ${invoiceData?.invoice?.invoice_number}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f5f5f5; font-weight: bold; }
            .header { text-align: center; margin-bottom: 30px; }
            .total-row { font-weight: bold; font-size: 1.1em; }
            .info-section { margin: 20px 0; }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.print();
  };

  const formatCurrency = (amount: number | string): string => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `$${num.toFixed(2)}`;
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
            <CircularProgress />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  const invoice = invoiceData?.invoice;
  const payment = invoiceData?.payment;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h5">Invoice</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {invoice && (
          <Box id="invoice-content">
            {/* Header */}
            <Box className="header" textAlign="center" mb={4}>
              <Typography variant="h4" gutterBottom>
                INVOICE
              </Typography>
              <Typography variant="h6" color="text.secondary">
                Invoice # {invoice.invoice_number}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Date: {formatDate(invoice.invoice_date)}
              </Typography>
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Customer & Booking Info */}
            <Box className="info-section" display="flex" justifyContent="space-between" mb={4}>
              <Box>
                <Typography variant="h6" gutterBottom>
                  Bill To:
                </Typography>
                <Typography variant="body1">{invoice.customer_name}</Typography>
                <Typography variant="body2">{invoice.customer_email}</Typography>
                {invoice.customer_phone && (
                  <Typography variant="body2">{invoice.customer_phone}</Typography>
                )}
              </Box>

              <Box textAlign="right">
                <Typography variant="h6" gutterBottom>
                  Booking Details:
                </Typography>
                <Typography variant="body2">
                  <strong>Room:</strong> {invoice.room_number} ({invoice.room_type})
                </Typography>
                <Typography variant="body2">
                  <strong>Check-in:</strong> {formatDate(invoice.check_in_date)}
                </Typography>
                <Typography variant="body2">
                  <strong>Check-out:</strong> {formatDate(invoice.check_out_date)}
                </Typography>
                <Typography variant="body2">
                  <strong>Nights:</strong> {invoice.number_of_nights}
                </Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Line Items */}
            <TableContainer component={Paper} elevation={0}>
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                    <TableCell><strong>Description</strong></TableCell>
                    <TableCell align="right"><strong>Quantity</strong></TableCell>
                    <TableCell align="right"><strong>Unit Price</strong></TableCell>
                    <TableCell align="right"><strong>Total</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoice.line_items && Array.isArray(invoice.line_items) && invoice.line_items.map((item: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell align="right">{formatCurrency(item.total)}</TableCell>
                    </TableRow>
                  ))}

                  {/* Subtotal */}
                  <TableRow>
                    <TableCell colSpan={3} align="right">
                      <strong>Subtotal:</strong>
                    </TableCell>
                    <TableCell align="right">{formatCurrency(invoice.subtotal)}</TableCell>
                  </TableRow>

                  {/* Service Charge */}
                  {parseFloat(invoice.service_charge) > 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="right">
                        Service Charge ({invoice.service_charge_percentage}%):
                      </TableCell>
                      <TableCell align="right">{formatCurrency(invoice.service_charge)}</TableCell>
                    </TableRow>
                  )}

                  {/* Tax */}
                  {parseFloat(invoice.tax_amount) > 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="right">
                        Tax ({invoice.tax_percentage}%):
                      </TableCell>
                      <TableCell align="right">{formatCurrency(invoice.tax_amount)}</TableCell>
                    </TableRow>
                  )}

                  {/* Keycard Deposit */}
                  {parseFloat(invoice.keycard_deposit) > 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="right">
                        Keycard Deposit (Refundable):
                      </TableCell>
                      <TableCell align="right">{formatCurrency(invoice.keycard_deposit)}</TableCell>
                    </TableRow>
                  )}

                  {/* Total */}
                  <TableRow className="total-row">
                    <TableCell colSpan={3} align="right">
                      <Typography variant="h6">
                        <strong>Total Amount:</strong>
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="h6" color="primary">
                        <strong>{formatCurrency(invoice.total_amount)}</strong>
                      </Typography>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {/* Payment Status */}
            {payment && (
              <Box mt={3}>
                <Alert severity="success">
                  <Typography variant="body2">
                    <strong>Payment Status:</strong> {payment.payment_status}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Payment Method:</strong> {payment.payment_method}
                  </Typography>
                  {payment.transaction_reference && (
                    <Typography variant="body2">
                      <strong>Reference:</strong> {payment.transaction_reference}
                    </Typography>
                  )}
                </Alert>
              </Box>
            )}

            {/* Notes */}
            {invoice.notes && (
              <Box mt={3}>
                <Typography variant="subtitle2" gutterBottom>
                  Notes:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {invoice.notes}
                </Typography>
              </Box>
            )}

            {/* Terms and Conditions */}
            {invoice.terms_and_conditions && (
              <Box mt={3}>
                <Typography variant="subtitle2" gutterBottom>
                  Terms and Conditions:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {invoice.terms_and_conditions}
                </Typography>
              </Box>
            )}

            {/* Footer */}
            <Box mt={4} textAlign="center">
              <Typography variant="body2" color="text.secondary">
                Thank you for your business!
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          startIcon={<PrintIcon />}
          onClick={handlePrint}
          variant="outlined"
        >
          Print
        </Button>
        <Button
          startIcon={<DownloadIcon />}
          onClick={handleDownload}
          variant="contained"
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default InvoiceModal;
