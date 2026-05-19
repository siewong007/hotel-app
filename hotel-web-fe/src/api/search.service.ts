import { api } from './client';

export interface SearchHit {
  id: number;
  title: string;
  subtitle: string;
  route: string;
}

export interface SearchGroup {
  type: string; // bookings | guests | rooms
  label: string;
  results: SearchHit[];
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
}

export class SearchService {
  /**
   * Federated global search across bookings, guests and rooms.
   * Results are RBAC-filtered server-side. Pass an AbortSignal so
   * superseded keystrokes can be cancelled.
   */
  static async search(
    q: string,
    opts?: { types?: string[]; limit?: number; signal?: AbortSignal }
  ): Promise<SearchResponse> {
    const sp = new URLSearchParams();
    sp.set('q', q);
    if (opts?.types?.length) sp.set('types', opts.types.join(','));
    if (opts?.limit) sp.set('limit', String(opts.limit));
    return await api
      .get(`search?${sp.toString()}`, { signal: opts?.signal })
      .json<SearchResponse>();
  }
}
