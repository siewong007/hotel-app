import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CompaniesService, RatesService, RoomsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { BookingWithDetails, RoomType } from '../../../types';

export function useCheckInFormData() {
  const queryClient = useQueryClient();
  const [rateCodes, setRateCodes] = useState<string[]>([]);
  const [marketCodes, setMarketCodes] = useState<string[]>([]);
  const [companyOptions, setCompanyOptions] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [roomTypeConfig, setRoomTypeConfig] = useState<RoomType | null>(null);

  const loadDropdownData = useCallback(async () => {
    try {
      const [ratesResp, marketsResp] = await Promise.all([
        queryClient.ensureQueryData({
          queryKey: queryKeys.rates.rateCodes(),
          queryFn: () => RatesService.getRateCodes(),
          staleTime: queryStaleTime.static,
        }),
        queryClient.ensureQueryData({
          queryKey: queryKeys.rates.marketCodes(),
          queryFn: () => RatesService.getMarketCodes(),
          staleTime: queryStaleTime.static,
        }),
      ]);
      setRateCodes(ratesResp.rate_codes);
      setMarketCodes(marketsResp.market_codes);
    } catch (err) {
      console.error('Failed to load dropdown data:', err);
    }
  }, [queryClient]);

  const loadCompanies = useCallback(async () => {
    try {
      setLoadingCompanies(true);
      const params = { is_active: true };
      const companies = await queryClient.ensureQueryData({
        queryKey: queryKeys.companies.list(params),
        queryFn: () => CompaniesService.getCompanies(params),
        staleTime: queryStaleTime.long,
      });
      const options = companies.map((c: any) => ({
        company_name: c.company_name,
        company_registration_number: c.registration_number,
        contact_person: c.contact_person,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
        billing_address: c.billing_address,
      }));
      setCompanyOptions(options);
    } catch (err) {
      console.error('Failed to load companies:', err);
    } finally {
      setLoadingCompanies(false);
    }
  }, [queryClient]);

  // Only the room-type name is read; accepting the narrow shape lets both
  // list-shaped `Booking`s and detail-shaped `BookingWithDetails` through.
  const loadRoomTypeConfig = useCallback(async (booking: { room_type?: string }) => {
    if (!booking.room_type) return;
    try {
      const roomTypes = await queryClient.ensureQueryData({
        queryKey: queryKeys.roomTypes.list(),
        queryFn: () => RoomsService.getAllRoomTypes(),
        staleTime: queryStaleTime.long,
      });
      const matched = roomTypes.find((rt: RoomType) => rt.name === booking.room_type);
      setRoomTypeConfig(matched || null);
    } catch {
      setRoomTypeConfig(null);
    }
  }, [queryClient]);

  return {
    rateCodes,
    marketCodes,
    companyOptions,
    setCompanyOptions,
    loadingCompanies,
    roomTypeConfig,
    setRoomTypeConfig,
    loadDropdownData,
    loadCompanies,
    loadRoomTypeConfig,
  };
}
