import React from 'react';
import { Box } from '@mui/material';
import type { BookingWithDetails } from '../../../types';
import type { HotelSettings } from '../../../utils/hotelSettings';
import type { ChargesBreakdown } from '../utils/chargesCalculation';
import { isDepositLikePayment } from '../utils/payments';
import type { CheckoutPaymentRecord } from '../types';
import { formatLocalDate, parseLocalDate, addLocalDays, formatHotelDate } from '../../../utils/date';
import { useTranslation } from '../../../i18n';
import { divideMoney, isLessMoney, isPositiveMoney, subtractMoney, toMoneyNumber } from '../../../utils/money';
import { paperTokens } from '../../../theme';

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
  depositForfeited: boolean;
  balanceDue: number;
  isHourlyBooking: boolean;
  calculateNights: () => number;
  getActualCheckoutDate: () => Date;
  isEarlyCheckout: () => boolean;
  isLateCheckout: () => boolean;
  formatBookingStatus: (status?: string) => string;
  formatCurrency: (value: number) => string;
}

const formatPaymentMethod = (method?: string | null) =>
  method?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

// Only bill-settling payments print as "Amount Paid" — a held deposit is
// collateral and a forfeited one is kept income; listing either as a bill
// payment recreates the same false math the modal used to show.
const completedPayments = (payments: CheckoutPaymentRecord[]) =>
  payments.filter((payment) => payment.payment_status === 'completed' && !isDepositLikePayment(payment));

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
  depositForfeited,
  balanceDue,
  isHourlyBooking,
  calculateNights,
  getActualCheckoutDate,
  isEarlyCheckout,
  isLateCheckout,
  formatBookingStatus,
  formatCurrency,
}) => {
  const { t } = useTranslation('finance');
  return (
  <Box id="printable-invoice" sx={{ display: 'none' }}>
    <div className="invoice-header">
      <h1>{hotelSettings.hotel_name}</h1>
      <p>{hotelSettings.hotel_address}</p>
      <p>{t('checkout.phoneEmail', { phone: hotelSettings.hotel_phone, email: hotelSettings.hotel_email })}</p>
    </div>

    <div className="invoice-meta">
      <div>
        <h3>{t('checkout.invoiceDetails')}</h3>
        <p>
          <span className="label">{t('checkout.field.invoiceNumber')}:</span>
          <span className="value">{booking.invoice_number || booking.folio_number || `#${booking.id}`}</span>
        </p>
        <p>
          <span className="label">{t('common:field.date')}:</span>
          <span className="value">{formatHotelDate(new Date())}</span>
        </p>
        <p>
          <span className="label">{t('common:field.status')}:</span>
          <span className="value">{formatBookingStatus(booking.status)}</span>
        </p>
      </div>

      <div>
        <h3>{t('checkout.guestInfo')}</h3>
        <p>
          <span className="label">{t('common:field.name')}:</span>
          <span className="value">{booking.guest_name}</span>
        </p>
        <p>
          <span className="label">{t('ledger.field.room')}:</span>
          <span className="value">{booking.room_number} - {booking.room_type}</span>
        </p>
        {guestCompanyName && (
          <p>
            <span className="label">{t('ledger.field.company')}:</span>
            <span className="value">{guestCompanyName}</span>
          </p>
        )}
        {guestPhone && (
          <p>
            <span className="label">{t('common:field.phone')}:</span>
            <span className="value">{guestPhone}</span>
          </p>
        )}
        {guestIcNumber && (
          <p>
            <span className="label">{t('checkout.field.idIc')}:</span>
            <span className="value">{guestIcNumber}</span>
          </p>
        )}
        {guestAddress && (
          <p>
            <span className="label">{t('common:field.address')}:</span>
            <span className="value">{guestAddress}</span>
          </p>
        )}
      </div>

      <div>
        <h3>{t('checkout.stayDetails')}</h3>
        <p>
          <span className="label">{t('checkout.checkIn')}:</span>
          <span className="value">{formatHotelDate(booking.check_in_date)}</span>
        </p>
        <p>
          <span className="label">{t('checkout.checkOut')}:</span>
          <span className="value">
            {formatHotelDate(getActualCheckoutDate())}
            {isEarlyCheckout() && t('checkout.earlyCheckoutTag')}
            {isLateCheckout() && t('checkout.lateCheckoutTag')}
          </span>
        </p>
        {(isEarlyCheckout() || isLateCheckout()) && (
          <p>
            <span className="label">{t('checkout.scheduled')}:</span>
            <span className="value">{formatHotelDate(booking.check_out_date)}</span>
          </p>
        )}
        <p>
          <span className="label">{t('checkout.duration')}:</span>
          <span className="value">{isHourlyBooking ? t('checkout.hourlyStay') : t('checkout.nights', { count: calculateNights() })}</span>
        </p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>{t('common:field.description')}</th>
          <th className="amount">{t('common:field.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {isHourlyBooking ? (
          <tr>
            <td>{t('checkout.roomChargesHourly')}</td>
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
                    <td>{t('checkout.roomChargeDay', { date: formatHotelDate(date) })}</td>
                    <td className="amount">{formatCurrency(dayRate)}</td>
                  </tr>
                  {isPositiveMoney(dayTax) && (
                    <tr style={{ color: paperTokens.textSecondary }}>
                      <td style={{ paddingLeft: '24px' }}>{t('checkout.serviceTaxPct', { rate: hotelSettings.service_tax_rate })}</td>
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
                <td>{t('checkout.tourismTax')}</td>
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
                <td>{t('checkout.tourismTaxDay', { date: formatHotelDate(date) })}</td>
                <td className="amount">{formatCurrency(perNight)}</td>
              </tr>
            );
          });
        })()}

        {isPositiveMoney(charges.extraBedCharge) && (
          <>
            <tr>
              <td>{t('checkout.extraBedCharge')}</td>
              <td className="amount">{formatCurrency(charges.extraBedCharge)}</td>
            </tr>
            {isPositiveMoney(charges.extraBedServiceTax) && (
              <tr>
                <td style={{ paddingLeft: '24px' }}>{t('checkout.serviceTaxPct', { rate: hotelSettings.service_tax_rate })}</td>
                <td className="amount">{formatCurrency(charges.extraBedServiceTax)}</td>
              </tr>
            )}
          </>
        )}

        {isPositiveMoney(charges.depositRefund) ? (
          <tr className="refund-row">
            <td>{t('checkout.depositLine', { state: depositRefunded ? t('deposit.print.refundedTag') : depositForfeited ? t('deposit.print.forfeitedTag') : t('deposit.print.pendingTag') })}</td>
            <td className="amount">{formatCurrency(charges.depositRefund)}</td>
          </tr>
        ) : null}

        <tr className="total-row">
          <td>{charges.grandTotal >= 0 ? t('checkout.print.totalDue') : t('checkout.print.totalRefund')}</td>
          <td className="amount">{formatCurrency(Math.abs(charges.grandTotal))}</td>
        </tr>
      </tbody>
    </table>

    {completedPayments(payments).length > 0 && (
      <table style={{ marginTop: '15px' }}>
        <thead>
          <tr>
            <th>{t('ledger.payment.method')}</th>
            <th className="amount">{t('checkout.print.amountPaid')}</th>
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
            <tr style={{ color: paperTokens.orange, fontWeight: 700 }}>
              <td>{t('ledger.payment.balanceDue')}</td>
              <td className="amount">{formatCurrency(balanceDue)}</td>
            </tr>
          )}
          {!isPositiveMoney(balanceDue) && (
            <tr style={{ color: paperTokens.success, fontWeight: 700 }}>
              <td>{isLessMoney(balanceDue, 0) ? t('checkout.print.overpayment') : t('status:ledger.paid')}</td>
              <td className="amount">{isLessMoney(balanceDue, 0) ? formatCurrency(Math.abs(balanceDue)) : '-'}</td>
            </tr>
          )}
        </tbody>
      </table>
    )}

    {depositWaived ? (
      <div className="notes" style={{ backgroundColor: paperTokens.warningBg, borderLeftColor: paperTokens.orange }}>
        <strong style={{ color: paperTokens.orange }}>{t('deposit.print.waivedTitle')}</strong>
        {t('deposit.print.reasonLine', { reason: depositWaiveReason })}
      </div>
    ) : depositForfeited ? (
      <div className="notes" style={{ backgroundColor: paperTokens.warningBg, borderLeftColor: paperTokens.orange }}>
        <strong style={{ color: paperTokens.orange }}>{t('deposit.print.forfeitedTitle')}</strong>
        {t('deposit.print.forfeitedBody', { amount: formatCurrency(charges.depositRefund) })}
      </div>
    ) : isPositiveMoney(charges.depositRefund) ? (
      <div className="notes success-note">
        <strong>{t('deposit.print.title')}</strong>
        {t('deposit.print.refundedBody', { amount: formatCurrency(charges.depositRefund) })}
      </div>
    ) : (
      <div className="notes" style={{ backgroundColor: paperTokens.infoBg, borderLeftColor: paperTokens.info }}>
        <strong style={{ color: paperTokens.info }}>{t('deposit.print.title')}</strong>
        {t('deposit.print.waivedMember')}
      </div>
    )}

    <div className="footer">
      <strong>{t('checkout.print.thanks', { name: hotelSettings.hotel_name })}</strong>
      <p>{t('checkout.print.farewell')}</p>
      <p style={{ marginTop: '10px' }}>{t('checkout.print.generatedNote')}</p>
    </div>
  </Box>
  );
};

export default CheckoutInvoicePrintView;
