import { useState, useCallback, useEffect, useRef } from 'react';
import { HotelAPIService } from '../../../api';
import { CustomerLedger, CustomerLedgerSummary } from '../../../types';

export function useLedgers() {
  const [ledgers, setLedgers] = useState<CustomerLedger[]>([]);
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
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

  const loadSummary = useCallback(async () => {
    try {
      const data = await HotelAPIService.getCustomerLedgerSummary();
      setSummary(data);
    } catch {
      // summary is non-critical
    }
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadLedgers(), loadSummary()]);
  }, [loadLedgers, loadSummary]);

  // Initial summary load
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Initial ledger load.
  useEffect(() => {
    loadLedgers();
  }, [loadLedgers]);

  return {
    ledgers,
    summary,
    loading,
    error,
    setError,
    reload,
    loadLedgers,
  };
}
