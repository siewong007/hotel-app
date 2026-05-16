import { useState, useCallback, useEffect, useRef } from 'react';
import { HotelAPIService } from '../../../api';
import { CustomerLedger } from '../../../types';

export function useLedgers() {
  const [ledgers, setLedgers] = useState<CustomerLedger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ledgersRequestId = useRef(0);

  const loadLedgers = useCallback(async () => {
    const requestId = ledgersRequestId.current + 1;
    ledgersRequestId.current = requestId;

    setLoading(true);
    try {
      const data = await HotelAPIService.getCustomerLedgers();
      if (ledgersRequestId.current !== requestId) return;

      setLedgers(data);
      setError(null);
    } catch (err: any) {
      if (ledgersRequestId.current !== requestId) return;

      setError(err.message || 'Failed to load ledger data. Please check your connection and try again.');
    } finally {
      if (ledgersRequestId.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(async () => {
    await loadLedgers();
  }, [loadLedgers]);

  useEffect(() => {
    loadLedgers();
  }, [loadLedgers]);

  return {
    ledgers,
    loading,
    error,
    setError,
    reload,
    loadLedgers,
  };
}
