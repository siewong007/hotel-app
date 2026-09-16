import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ChannelsApi } from '../api';
import type {
  BookingChannelInput,
  BookingChannelUpdate,
  ChannelCommissionRuleInput,
  ChannelPricePreviewRequest,
  ChannelPricingRuleInput,
  ChannelRatePlanMappingInput,
  ChannelRoomTypeMappingInput,
} from '../types';

export function useChannels() {
  return useQuery({ queryKey: ['booking-channels'], queryFn: ChannelsApi.list });
}

export function useChannelMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['booking-channels'] });

  const create = useMutation({
    mutationFn: (input: BookingChannelInput) => ChannelsApi.create(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: BookingChannelUpdate }) =>
      ChannelsApi.update(id, input),
    onSuccess: invalidate,
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => ChannelsApi.deactivate(id),
    onSuccess: invalidate,
  });
  return { create, update, deactivate };
}

export function useChannelMatrix(date?: string, ratePlanId?: number) {
  return useQuery({
    queryKey: ['channel-pricing-matrix', date ?? null, ratePlanId ?? null],
    queryFn: () => ChannelsApi.matrix(date, ratePlanId),
  });
}

export function useChannelDetail(channelId: number | null) {
  const rules = useQuery({
    queryKey: ['channel-pricing-rules', channelId],
    queryFn: () => ChannelsApi.pricingRules(channelId as number),
    enabled: channelId !== null,
  });
  const commission = useQuery({
    queryKey: ['channel-commission-rules', channelId],
    queryFn: () => ChannelsApi.commissionRules(channelId as number),
    enabled: channelId !== null,
  });
  const mappings = useQuery({
    queryKey: ['channel-mappings', channelId],
    queryFn: () => ChannelsApi.mappings(channelId as number),
    enabled: channelId !== null,
  });
  return { rules, commission, mappings };
}

export function useChannelDetailMutations(channelId: number | null) {
  const queryClient = useQueryClient();
  const invalidateRules = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['channel-pricing-rules', channelId],
      }),
      queryClient.invalidateQueries({ queryKey: ['channel-pricing-matrix'] }),
    ]);
  const invalidateCommission = () =>
    queryClient.invalidateQueries({
      queryKey: ['channel-commission-rules', channelId],
    });
  const invalidateMappings = () =>
    queryClient.invalidateQueries({ queryKey: ['channel-mappings', channelId] });

  const createRule = useMutation({
    mutationFn: (input: ChannelPricingRuleInput) =>
      ChannelsApi.createPricingRule(channelId as number, input),
    onSuccess: invalidateRules,
  });
  const updateRule = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Partial<ChannelPricingRuleInput>;
    }) => ChannelsApi.updatePricingRule(id, input),
    onSuccess: invalidateRules,
  });
  const deleteRule = useMutation({
    mutationFn: (id: number) => ChannelsApi.deletePricingRule(id),
    onSuccess: invalidateRules,
  });

  const createCommission = useMutation({
    mutationFn: (input: ChannelCommissionRuleInput) =>
      ChannelsApi.createCommissionRule(channelId as number, input),
    onSuccess: invalidateCommission,
  });
  const updateCommission = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Partial<ChannelCommissionRuleInput>;
    }) => ChannelsApi.updateCommissionRule(id, input),
    onSuccess: invalidateCommission,
  });
  const deleteCommission = useMutation({
    mutationFn: (id: number) => ChannelsApi.deleteCommissionRule(id),
    onSuccess: invalidateCommission,
  });

  const upsertRoomMapping = useMutation({
    mutationFn: (input: ChannelRoomTypeMappingInput) =>
      ChannelsApi.upsertRoomTypeMapping(channelId as number, input),
    onSuccess: invalidateMappings,
  });
  const upsertPlanMapping = useMutation({
    mutationFn: (input: ChannelRatePlanMappingInput) =>
      ChannelsApi.upsertRatePlanMapping(channelId as number, input),
    onSuccess: invalidateMappings,
  });
  const deleteRoomMapping = useMutation({
    mutationFn: (id: number) => ChannelsApi.deleteRoomTypeMapping(id),
    onSuccess: invalidateMappings,
  });
  const deletePlanMapping = useMutation({
    mutationFn: (id: number) => ChannelsApi.deleteRatePlanMapping(id),
    onSuccess: invalidateMappings,
  });

  return {
    createRule,
    updateRule,
    deleteRule,
    createCommission,
    updateCommission,
    deleteCommission,
    upsertRoomMapping,
    upsertPlanMapping,
    deleteRoomMapping,
    deletePlanMapping,
  };
}

export function useChannelPreview() {
  return useMutation({
    mutationFn: (input: ChannelPricePreviewRequest) =>
      ChannelsApi.preview(input),
  });
}
