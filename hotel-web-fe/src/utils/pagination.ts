export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginationState {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  hasItems: boolean;
  hasMultiplePages: boolean;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 50;

export const normalizePage = (page?: number): number => {
  if (!Number.isFinite(page)) return DEFAULT_PAGE;
  return Math.max(DEFAULT_PAGE, Math.floor(Number(page)));
};

export const normalizePageSize = (
  pageSize?: number,
  fallback: number = DEFAULT_PAGE_SIZE
): number => {
  const normalizedFallback = Math.max(1, Math.floor(Number(fallback) || DEFAULT_PAGE_SIZE));
  if (!Number.isFinite(pageSize)) return normalizedFallback;
  return Math.max(1, Math.floor(Number(pageSize)));
};

export const toPaginationSearchParams = ({
  page,
  pageSize,
}: PaginationParams): { page: number; page_size: number } => ({
  page: normalizePage(page),
  page_size: normalizePageSize(pageSize),
});

export const getPaginationState = ({
  page,
  pageSize,
  totalItems,
}: PaginationParams & { totalItems?: number }): PaginationState => {
  const normalizedPageSize = normalizePageSize(pageSize);
  const normalizedTotal = Math.max(0, Math.floor(Number(totalItems) || 0));
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));
  const currentPage = Math.min(normalizePage(page), totalPages);
  const hasItems = normalizedTotal > 0;
  const startItem = hasItems ? (currentPage - 1) * normalizedPageSize + 1 : 0;
  const endItem = hasItems
    ? Math.min(currentPage * normalizedPageSize, normalizedTotal)
    : 0;

  return {
    currentPage,
    pageSize: normalizedPageSize,
    totalItems: normalizedTotal,
    totalPages,
    startItem,
    endItem,
    hasItems,
    hasMultiplePages: normalizedTotal > normalizedPageSize,
  };
};
