import { useState, useCallback } from 'react';
import { HotelAPIService } from '../../../api';
import { BookingWithDetails, RoomType } from '../../../types';

export function useCheckInFormData() {
  const [rateCodes, setRateCodes] = useState<string[]>([]);
  const [marketCodes, setMarketCodes] = useState<string[]>([]);
  const [companyOptions, setCompanyOptions] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [roomTypeConfig, setRoomTypeConfig] = useState<RoomType | null>(null);

  const loadDropdownData = useCallback(async () => {
    try {
      const [ratesResp, marketsResp] = await Promise.all([
        HotelAPIService.getRateCodes(),
        HotelAPIService.getMarketCodes(),
      ]);
      setRateCodes(ratesResp.rate_codes);
      setMarketCodes(marketsResp.market_codes);
    } catch (err) {
      console.error('Failed to load dropdown data:', err);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      setLoadingCompanies(true);
      const companies = await HotelAPIService.getCompanies({ is_active: true });
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
  }, []);

  const loadRoomTypeConfig = useCallback(async (booking: BookingWithDetails) => {
    if (!booking.room_type) return;
    try {
      const roomTypes = await HotelAPIService.getAllRoomTypes();
      const matched = roomTypes.find((rt: RoomType) => rt.name === booking.room_type);
      setRoomTypeConfig(matched || null);
    } catch {
      setRoomTypeConfig(null);
    }
  }, []);

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
