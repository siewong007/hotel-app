import { useQuery } from '@tanstack/react-query';
import { CompaniesService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { useAuth } from '../../../auth/AuthContext';

const COMPANY_SEARCH_LIMIT = 100;

export function useGuestCompanyOptions(search?: string, enabled = true) {
  const { hasPermission } = useAuth();
  const canReadCompanies = hasPermission('companies:read');
  const normalizedSearch = search?.trim();
  const params = normalizedSearch
    ? { is_active: true, limit: COMPANY_SEARCH_LIMIT, search: normalizedSearch }
    : { is_active: true, limit: COMPANY_SEARCH_LIMIT };

  return useQuery({
    queryKey: queryKeys.companies.list(params),
    queryFn: () => CompaniesService.getCompanies(params),
    enabled: enabled && canReadCompanies,
    staleTime: queryStaleTime.long,
  });
}
