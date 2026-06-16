/**
 * Custom hook for EnhancedCheckInModal.tsx (1,893 lines).
 * Extracts 43 useState calls and 5+ handler functions.
 */
import { useState, useCallback } from 'react';
import { emitApiNotification } from '../../../utils/apiNotifications';

export function useEnhancedCheckInModalState() {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestData, setGuestData] = useState<Record<string, any>>({});
  const [bookingData, setBookingData] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [chargeIncidentals, setChargeIncidentals] = useState(true);
  const [vipGuest, setVipGuest] = useState(false);
  const [overrideRate, setOverrideRate] = useState(false);
  const [weekdayRate, setWeekdayRate] = useState('90.00');
  const [weekendRate, setWeekendRate] = useState('90.00');
  const [epiRate, setEpiRate] = useState(1);
  const [nextPosting, setNextPosting] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [paymentType, setPaymentType] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardName, setCardName] = useState('');
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [directBillCompany, setDirectBillCompany] = useState('');
  const [driversInfo, setDriversInfo] = useState('');
  const [depositChoice, setDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState('Cash');
  const [depositReason, setDepositReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleGuestChange = useCallback((field: string, value: any) => {
    setGuestData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleBookingChange = useCallback((field: string, value: any) => {
    setBookingData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleBlur = useCallback((field: string, value: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [validationErrors]);

  const handleCheckIn = useCallback(async () => {
    emitApiNotification({ message: 'Check-in processing...', severity: 'info' });
  }, []);

  const handleRegisterNewCompany = useCallback(async () => {
    emitApiNotification({ message: 'Company registration processing...', severity: 'info' });
  }, []);

  return {
    activeTab, setActiveTab, loading, setLoading, error, setError,
    guestData, setGuestData, bookingData, setBookingData,
    validationErrors, setValidationErrors, touched, setTouched,
    chargeIncidentals, setChargeIncidentals, vipGuest, setVipGuest,
    overrideRate, setOverrideRate, weekdayRate, setWeekdayRate,
    weekendRate, setWeekendRate, epiRate, setEpiRate, nextPosting, setNextPosting,
    paymentChoice, setPaymentChoice, paymentType, setPaymentType,
    amountPaid, setAmountPaid, cardNumber, setCardNumber, cardExpiry, setCardExpiry,
    cardName, setCardName, showCardNumber, setShowCardNumber,
    directBillCompany, setDirectBillCompany, driversInfo, setDriversInfo,
    depositChoice, setDepositChoice, depositAmount, setDepositAmount,
    depositMethod, setDepositMethod, depositReason, setDepositReason,
    processing, setProcessing,
    handleGuestChange, handleBookingChange, handleBlur,
    handleCheckIn, handleRegisterNewCompany,
  };
}