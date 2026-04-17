import { useState, useCallback } from 'react';
import { HotelAPIService } from '../../../api';
import { CustomerLedger, CustomerLedgerSummary } from '../../../types';

export function useLedgerData() {
  const [ledgers, setLedgers] = useState<CustomerLedger[]>([]);
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ledgersData, summaryData] = await Promise.all([
        HotelAPIService.getCustomerLedgers(),
        HotelAPIService.getCustomerLedgerSummary(),
      ]);
      setLedgers(ledgersData);
      setSummary(summaryData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load ledger data. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { ledgers, summary, loading, error, setError, reload };
}
