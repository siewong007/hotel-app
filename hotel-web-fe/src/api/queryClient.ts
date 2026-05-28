import { QueryClient } from '@tanstack/react-query';
import { defaultQueryOptions } from './queryConfig';

export const queryClient = new QueryClient({
  defaultOptions: defaultQueryOptions,
});
