import React from 'react';
import { Box } from '@mui/material';
import type { BookingWithDetails } from '../../../types';
import type { HotelSettings } from '../../../utils/hotelSettings';
import type { ChargesBreakdown } from '../utils/chargesCalculation';
import type { CheckoutPaymentRecord } from '../types';
import { formatLocalDate, parseLocalDate, addLocalDays } from '../../../utils/date';
import { divideMoney, isLessMoney, isPositiveMoney, subtractMoney, toMoneyNumber } from '../../../utils/money';

interface CheckoutInvoicePrintViewProps {
  booking: BookingWithDetails;
  hotelSettings: HotelSettings;
  guestCompanyName: string;
  guestAddress: string;
  guestPhone: string;
  guestIcNumber: string;
  payments: CheckoutPaymentRecord[];
  charges: ChargesBreakdown;
  editableDailyRates: Record<string, number>;
  depositRefunded: boolean;
  depositWaived: boolean;
  depositWaiveReason: string;
  balanceDue: number;
  isHourlyBooking: boolean;
  calculateNights: () => number;
  getActualCheckoutDate: () => Date;
  isEarlyCheckout: () => boolean;
  formatBookingStatus: (status?: string) => string;
  formatCurrency: (value: number) => string;
}

const formatPaymentMethod = (method?: string | null) =>
  method?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

const completedPayments = (payments: CheckoutPaymentRecord[]) =>
  payments.filter((payment) => payment.payment_status === 'completed');

const CheckoutInvoicePrintView: React.FC<CheckoutInvoicePrintViewProps> = ({
  booking,
  hotelSettings,
  guestCompanyName,
  guestAddress,
  guestPhone,
  guestIcNumber,
  payments,
  charges,
  editableDailyRates,
  depositRefunded,
  depositWaived,
  depositWaiveReason,
  balanceDue,
  isHourlyBooking,
  calculateNights,
  getActualCheckoutDate,
  isEarlyCheckout,
  formatBookingStatus,
  formatCurrency,
}) => (
  <Box id="printable-invoice" sx={{ display: 'none' }}>
    <div className="invoice-header">
      <h1>{hotelSettings.hotel_name}</h1>
      <p>{hotelSettings.hotel_address}</p>
      <p>Phone: {hotelSettings.hotel_phone} | Email: {hotelSettings.hotel_email}</p>
    </div>

    <div className="invoice-meta">
      <div>
        <h3>Invoice Details</h3>
        <p>
          <span className="label">Invoice Number:</span>
          <span className="value">{booking.invoice_number || booking.folio_number || `#${booking.id}`}</span>
        </p>
        <p>
          <span className="label">Date:</span>
          <span className="value">{new Date().toLocaleDateString()}</span>
        </p>
        <p>
          <span className="label">Status:</span>
          <span className="value">{formatBookingStatus(booking.status)}</span>
        </p>
      </div>

      <div>
        <h3>Guest Information</h3>
        <p>
          <span className="label">Name:</span>
          <span className="value">{booking.guest_name}</span>
        </p>
        <p>
          <span className="label">Room:</span>
          <span className="value">{booking.room_number} - {booking.room_type}</span>
        </p>
        {guestCompanyName && (
          <p>
            <span className="label">Company:</span>
            <span className="value">{guestCompanyName}</span>
          </p>
        )}
        {guestPhone && (
          <p>
            <span className="label">Phone:</span>
            <span className="value">{guestPhone}</span>
          </p>
        )}
        {guestIcNumber && (
          <p>
            <span className="label">ID / IC:</span>
            <span className="value">{guestIcNumber}</span>
          </p>
        )}
        {guestAddress && (
          <p>
            <span className="label">Address:</span>
            <span className="value">{guestAddress}</span>
          </p>
        )}
      </div>

      <div>
        <h3>Stay Details</h3>
        <p>
          <span className="label">Check-in:</span>
          <span className="value">{new Date(booking.check_in_date).toLocaleDateString()}</span>
        </p>
        <p>
          <span className="label">Check-out:</span>
          <span className="value">
            {getActualCheckoutDate().toLocaleDateString()}
            {isEarlyCheckout() && ' (Early Checkout)'}
          </span>
        </p>
        {isEarlyCheckout() && (
          <p>
            <span className="label">Scheduled:</span>
            <span className="value">{new Date(booking.check_out_date).toLocaleDateString()}</span>
          </p>
        )}
        <p>
          <span className="label">Duration:</span>
          <span className="value">{isHourlyBooking ? 'Hourly Stay' : `${calculateNights()} night(s)`}</span>
        </p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th className="amount">Amount</th>
        </tr>
      </thead>
      <tbody>
        {isHourlyBooking ? (
          <tr>
            <td>Room Charges (Hourly Stay)</td>
            <td className="amount">{formatCurrency(charges.roomCharges)}</td>
          </tr>
        ) : (
          (() => {
            const nights = calculateNights();
            const taxRate = hotelSettings.service_tax_rate / 100;
            const taxMultiplier = 1 + taxRate;
            const checkIn = parseLocalDate(booking.check_in_date);
            return Array.from({ length: nights }, (_, i) => {
              const date = addLocalDays(checkIn, i);
              const dateKey = formatLocalDate(date);
              const taxInclusiveRate = editableDailyRates[dateKey] || 0;
              const dayRate = divideMoney(taxInclusiveRate, taxMultiplier);
              const dayTax = subtractMoney(taxInclusiveRate, dayRate);
              return (
                <React.Fragment key={i}>
                  <tr>
                    <td>Room Charge — {date.toLocaleDateString()}</td>
                    <td className="amount">{formatCurrency(dayRate)}</td>
                  </tr>
                  {isPositiveMoney(dayTax) && (
                    <tr style={{ color: '#666' }}>
                      <td style={{ paddingLeft: '24px' }}>Service Tax ({hotelSettings.service_tax_rate}%)</td>
                      <td className="amount">{formatCurrency(dayTax)}</td>
                    </tr>
                  )}
                </React.Fragment>
              );
            });
          })()
        )}

        {isPositiveMoney(charges.tourismTax) && (() => {
          const tourismTaxNights = calculateNights();
          if (isHourlyBooking || tourismTaxNights <= 0) {
            return (
              <tr>
                <td>Tourism Tax</td>
                <td className="amount">{formatCurrency(charges.tourismTax)}</td>
              </tr>
            );
          }
          const perNight = divideMoney(charges.tourismTax, tourismTaxNights);
          const checkIn = new Date(booking.check_in_date);
          return Array.from({ length: tourismTaxNights }, (_, i) => {
            const date = new Date(checkIn);
            date.setDate(date.getDate() + i);
            return (
              <tr key={`tt-print-${i}`}>
                <td>Tourism Tax — {date.toLocaleDateString()}</td>
                <td className="amount">{formatCurrency(perNight)}</td>
              </tr>
            );
          });
        })()}

        {isPositiveMoney(charges.extraBedCharge) && (
          <>
            <tr>
              <td>Extra Bed Charge</td>
              <td className="amount">{formatCurrency(charges.extraBedCharge)}</td>
            </tr>
            {isPositiveMoney(charges.extraBedServiceTax) && (
              <tr>
                <td style={{ paddingLeft: '24px' }}>Service Tax ({hotelSettings.service_tax_rate}%)</td>
                <td className="amount">{formatCurrency(charges.extraBedServiceTax)}</td>
              </tr>
            )}
          </>
        )}

        {isPositiveMoney(charges.depositRefund) ? (
          <tr className="refund-row">
            <td>Deposit {depositRefunded ? '(Refunded)' : '(Pending Refund)'}</td>
            <td className="amount">{formatCurrency(charges.depositRefund)}</td>
          </tr>
        ) : null}

        <tr className="total-row">
          <td>{charges.grandTotal >= 0 ? 'Total Amount Due' : 'Total Refund'}</td>
          <td className="amount">{formatCurrency(Math.abs(charges.grandTotal))}</td>
        </tr>
      </tbody>
    </table>

    {completedPayments(payments).length > 0 && (
      <table style={{ marginTop: '15px' }}>
        <thead>
          <tr>
            <th>Payment Method</th>
            <th className="amount">Amount Paid</th>
          </tr>
        </thead>
        <tbody>
          {completedPayments(payments).map((payment, idx) => (
            <tr key={payment.id || idx}>
              <td>{formatPaymentMethod(payment.payment_method)}</td>
              <td className="amount">{formatCurrency(toMoneyNumber(payment.total_amount))}</td>
            </tr>
          ))}
          {isPositiveMoney(balanceDue) && (
            <tr style={{ color: '#e65100', fontWeight: 700 }}>
              <td>Balance Due</td>
              <td className="amount">{formatCurrency(balanceDue)}</td>
            </tr>
          )}
          {!isPositiveMoney(balanceDue) && (
            <tr style={{ color: '#2e7d32', fontWeight: 700 }}>
              <td>{isLessMoney(balanceDue, 0) ? 'Overpayment' : 'Fully Paid'}</td>
              <td className="amount">{isLessMoney(balanceDue, 0) ? formatCurrency(Math.abs(balanceDue)) : '-'}</td>
            </tr>
          )}
        </tbody>
      </table>
    )}

    {depositWaived ? (
      <div className="notes" style={{ backgroundColor: '#fff3e0', borderLeftColor: '#e65100' }}>
        <strong style={{ color: '#e65100' }}>Deposit - Waived</strong>
        Reason: {depositWaiveReason}
      </div>
    ) : isPositiveMoney(charges.depositRefund) ? (
      <div className="notes success-note">
        <strong>Deposit</strong>
        Deposit of {formatCurrency(charges.depositRefund)} has been refunded separately to the guest.
      </div>
    ) : (
      <div className="notes" style={{ backgroundColor: '#e3f2fd', borderLeftColor: '#1565c0' }}>
        <strong style={{ color: '#1565c0' }}>Deposit</strong>
        Waived (Member benefit)
      </div>
    )}

    <div className="footer">
      <strong>Thank you for choosing {hotelSettings.hotel_name}!</strong>
      <p>We hope to see you again soon.</p>
      <p style={{ marginTop: '10px' }}>This is a computer-generated invoice and does not require a signature.</p>
    </div>
  </Box>
);

export default CheckoutInvoicePrintView;
