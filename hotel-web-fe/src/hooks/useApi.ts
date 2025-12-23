import { useState } from 'react';

interface UseApiOptions<T, P extends any[]> {
  apiFn: (...params: P) => Promise<T>;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

interface UseApiReturn<T, P extends any[]> {
  execute: (...params: P) => Promise<T | undefined>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  data: T | undefined;
}

/**
 * Hook for executing API operations with loading and error states
 *
 * @example
 * const { execute: createBooking, loading } = useApi({
 *   apiFn: HotelAPIService.createBooking,
 *   onSuccess: () => {
 *     showSnackbar('Booking created!');
 *     reload();
 *   },
 * });
 *
 * // Usage
 * await createBooking(bookingData);
 */
export function useApi<T, P extends any[]>({
  apiFn,
  onSuccess,
  onError,
}: UseApiOptions<T, P>): UseApiReturn<T, P> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | undefined>(undefined);

  const execute = async (...params: P): Promise<T | undefined> => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiFn(...params);
      setData(result);
      onSuccess?.(result);
      return result;
    } catch (err: any) {
      const errorMessage = err.message || 'Operation failed';
      setError(errorMessage);
      onError?.(err);
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => setError(null);

  return { execute, loading, error, clearError, data };
}
