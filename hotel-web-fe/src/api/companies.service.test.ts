import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { CompaniesService } from './companies.service';
import type { Company, CompanyCreateRequest, CompanyUpdateRequest } from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Read the searchParams object passed to the most recent api.get call. */
function lastGetSearchParams(): Record<string, any> {
  const call = get.mock.calls[get.mock.calls.length - 1];
  return call?.[1]?.searchParams ?? {};
}

function buildCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    company_name: 'Acme Corp',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('CompaniesService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
  });

  describe('getCompanies', () => {
    it('calls GET companies with no searchParams when no filters are provided', async () => {
      get.mockReturnValue(mockJsonResponse([buildCompany()]));

      const result = await CompaniesService.getCompanies();

      expect(get).toHaveBeenCalledWith('companies', { searchParams: {} });
      expect(result).toEqual([buildCompany()]);
    });

    it('forwards search, is_active, limit and offset as string searchParams', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await CompaniesService.getCompanies({
        search: 'acme',
        is_active: true,
        limit: 10,
        offset: 20,
      });

      expect(lastGetSearchParams()).toEqual({
        search: 'acme',
        is_active: 'true',
        limit: '10',
        offset: '20',
      });
    });

    it('omits is_active when false is not explicitly provided (undefined)', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await CompaniesService.getCompanies({});

      expect(lastGetSearchParams()).toEqual({});
    });

    it('forwards is_active=false explicitly (undefined check, not truthiness)', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await CompaniesService.getCompanies({ is_active: false });

      expect(lastGetSearchParams()).toEqual({ is_active: 'false' });
    });
  });

  describe('getCompany', () => {
    it('calls GET companies/<id>', async () => {
      const company = buildCompany({ id: 42 });
      get.mockReturnValue(mockJsonResponse(company));

      const result = await CompaniesService.getCompany(42);

      expect(get).toHaveBeenCalledWith('companies/42');
      expect(result).toEqual(company);
    });
  });

  describe('createCompany', () => {
    it('posts the input as json to companies', async () => {
      const input: CompanyCreateRequest = { company_name: 'New Co' };
      const created = buildCompany({ company_name: 'New Co' });
      post.mockReturnValue(mockJsonResponse(created));

      const result = await CompaniesService.createCompany(input);

      expect(post).toHaveBeenCalledWith('companies', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updateCompany', () => {
    it('puts the input as json to companies/<id>', async () => {
      const input: CompanyUpdateRequest = { company_name: 'Renamed Co' };
      const updated = buildCompany({ id: 7, company_name: 'Renamed Co' });
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await CompaniesService.updateCompany(7, input);

      expect(put).toHaveBeenCalledWith('companies/7', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteCompany', () => {
    it('calls DELETE companies/<id> and unwraps the json message', async () => {
      del.mockReturnValue(mockJsonResponse({ message: 'deleted' }));

      const result = await CompaniesService.deleteCompany(9);

      expect(del).toHaveBeenCalledWith('companies/9');
      expect(result).toEqual({ message: 'deleted' });
    });
  });
});
