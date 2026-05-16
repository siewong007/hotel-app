import { api } from './client';
import { withRetry } from '../utils/retry';
import type { Company, CompanyCreateRequest, CompanyUpdateRequest } from '../types';

export class CompaniesService {
  static async getCompanies(params?: {
    search?: string;
    is_active?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Company[]> {
    const searchParams: Record<string, string> = {};
    if (params?.search) searchParams.search = params.search;
    if (params?.is_active !== undefined) searchParams.is_active = params.is_active.toString();
    if (params?.limit) searchParams.limit = params.limit.toString();
    if (params?.offset) searchParams.offset = params.offset.toString();

    return await withRetry(
      () => api.get('companies', { searchParams }).json<Company[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getCompany(companyId: number): Promise<Company> {
    return await api.get(`companies/${companyId}`).json<Company>();
  }

  static async createCompany(data: CompanyCreateRequest): Promise<Company> {
    return await api.post('companies', { json: data }).json<Company>();
  }

  static async updateCompany(companyId: number, data: CompanyUpdateRequest): Promise<Company> {
    return await api.put(`companies/${companyId}`, { json: data }).json<Company>();
  }

  static async deleteCompany(companyId: number): Promise<{ message: string }> {
    return await api.delete(`companies/${companyId}`).json();
  }
}
