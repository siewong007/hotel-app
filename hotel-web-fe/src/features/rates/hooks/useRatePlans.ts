import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { RatesApi } from '../api';
import type { BulkRoomRateInput, RatePlanInput } from '../types';

export function useRatePlans() {
  return useQuery({ queryKey: ['rate-plans'], queryFn: RatesApi.plans });
}

export function useRatePlanWithRates(id: number | null) {
  return useQuery({
    queryKey: ['rate-plans', id, 'with-rates'],
    queryFn: () => RatesApi.planWithRates(id as number),
    enabled: id !== null,
  });
}

export function useRateRoomTypes() {
  return useQuery({ queryKey: ['rate-room-types'], queryFn: RatesApi.roomTypes });
}

export function useRatePlanMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rate-plans'] }),
      queryClient.invalidateQueries({ queryKey: ['rate-calendar'] }),
    ]);

  const createPlan = useMutation({
    mutationFn: (input: RatePlanInput) => RatesApi.createPlan(input),
    onSuccess: invalidate,
  });
  const updatePlan = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<RatePlanInput> }) =>
      RatesApi.updatePlan(id, input),
    onSuccess: invalidate,
  });
  const deletePlan = useMutation({
    mutationFn: (id: number) => RatesApi.deletePlan(id),
    onSuccess: invalidate,
  });
  return { createPlan, updatePlan, deletePlan };
}

export function useRoomRateMutations(planId: number | null) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rate-plans', planId, 'with-rates'] }),
      queryClient.invalidateQueries({ queryKey: ['rate-calendar'] }),
    ]);

  const createRate = useMutation({
    mutationFn: (input: Parameters<typeof RatesApi.createRoomRate>[0]) =>
      RatesApi.createRoomRate(input),
    onSuccess: invalidate,
  });
  const updateRate = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Parameters<typeof RatesApi.updateRoomRate>[1];
    }) => RatesApi.updateRoomRate(id, input),
    onSuccess: invalidate,
  });
  const deleteRate = useMutation({
    mutationFn: (id: number) => RatesApi.deleteRoomRate(id),
    onSuccess: invalidate,
  });
  const bulkUpsert = useMutation({
    mutationFn: (input: BulkRoomRateInput) => RatesApi.bulkUpsert(input),
    onSuccess: invalidate,
  });
  return { createRate, updateRate, deleteRate, bulkUpsert };
}
