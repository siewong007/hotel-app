import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import {
  getHotelSettings,
  saveHotelSettings,
  type HotelSettings,
} from '../../../utils/hotelSettings';

export function useHotelSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings.hotel(),
    queryFn: () => getHotelSettings(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSaveHotelSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: HotelSettings) => {
      saveHotelSettings(settings);
      return settings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings.hotel(), settings);
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
}
