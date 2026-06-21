import { useQuery } from '@tanstack/react-query';
import { CompaniesService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';

const COMPANY_SEARCH_LIMIT = 100;

export function useGuestCompanyOptions(search?: string, enabled = true) {
  const normalizedSearch = search?.trim();
  const params = normalizedSearch
    ? { is_active: true, limit: COMPANY_SEARCH_LIMIT, search: normalizedSearch }
    : { is_active: true, limit: COMPANY_SEARCH_LIMIT };

  return useQuery({
    queryKey: queryKeys.companies.list(params),
    queryFn: () => CompaniesService.getCompanies(params),
    enabled,
    staleTime: queryStaleTime.long,
  });
}
