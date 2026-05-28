import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RoomsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateRoomDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import type {
  Room,
  RoomStatusUpdateInput,
  RoomTypeCreateInput,
  RoomTypeUpdateInput,
} from '../../../types';

type CreateRoomInput = Parameters<typeof RoomsService.createRoom>[0];

type RoomMutationContext = {
  previousRooms?: Room[];
  previousDetail?: Room;
};

const upsertRoomInCache = (queryClient: ReturnType<typeof useQueryClient>, room: Room) => {
  queryClient.setQueryData<Room[]>(queryKeys.rooms.all, (current) => {
    if (!current) return current;
    const exists = current.some((cachedRoom) => String(cachedRoom.id) === String(room.id));
    return exists
      ? current.map((cachedRoom) => String(cachedRoom.id) === String(room.id) ? room : cachedRoom)
      : [...current, room];
  });
  queryClient.setQueryData(queryKeys.rooms.detail(room.id), room);
};

const patchRoomInCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  roomId: string | number,
  patch: Partial<Room>
) => {
  queryClient.setQueryData<Room[]>(queryKeys.rooms.all, (current) =>
    current?.map((room) => String(room.id) === String(roomId) ? { ...room, ...patch } : room)
  );
  queryClient.setQueryData<Room>(queryKeys.rooms.detail(roomId), (current) =>
    current ? { ...current, ...patch } : current
  );
};

const restoreRoomCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  roomId: string | number,
  context?: RoomMutationContext
) => {
  if (context?.previousRooms) {
    queryClient.setQueryData(queryKeys.rooms.all, context.previousRooms);
  }
  if (context?.previousDetail) {
    queryClient.setQueryData(queryKeys.rooms.detail(roomId), context.previousDetail);
  }
};

export function useRooms(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.all,
    queryFn: () => RoomsService.getAllRooms(),
    enabled,
    staleTime: queryStaleTime.standard,
  });
}

export function useAvailableRoomsForDates(
  checkInDate?: string,
  checkOutDate?: string,
  excludeBookingId?: number,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.rooms.available(checkInDate ?? '', checkOutDate ?? '', excludeBookingId),
    queryFn: () => RoomsService.getAvailableRoomsForDates(checkInDate!, checkOutDate!, excludeBookingId),
    enabled: enabled && !!checkInDate && !!checkOutDate,
    staleTime: queryStaleTime.short,
  });
}

export function useRoomDetailedStatus(roomId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.detailedStatus(roomId ?? ''),
    queryFn: () => RoomsService.getRoomDetailedStatus(roomId as string | number),
    enabled: enabled && roomId != null && roomId !== '',
    staleTime: queryStaleTime.realtime,
  });
}

export function useRoomHistory(roomId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.history(roomId ?? ''),
    queryFn: () => RoomsService.getRoomHistory(roomId as string | number),
    enabled: enabled && roomId != null && roomId !== '',
    staleTime: queryStaleTime.short,
  });
}

export function useRoomTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roomTypes.active(),
    queryFn: () => RoomsService.getRoomTypes(),
    enabled,
    staleTime: queryStaleTime.long,
  });
}

export function useAllRoomTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roomTypes.list(),
    queryFn: () => RoomsService.getAllRoomTypes(),
    enabled,
    staleTime: queryStaleTime.long,
  });
}

export function useRoomsWithOccupancy(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.withOccupancy(),
    queryFn: () => RoomsService.getRoomsWithOccupancy(),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRoomInput) => RoomsService.createRoom(data),
    onSuccess: (room) => {
      upsertRoomInCache(queryClient, room);
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useUpdateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, data }: { roomId: string | number; data: Partial<Room> }) =>
      RoomsService.updateRoom(roomId, data),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rooms.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.rooms.detail(variables.roomId) });
      const previousRooms = queryClient.getQueryData<Room[]>(queryKeys.rooms.all);
      const previousDetail = queryClient.getQueryData<Room>(queryKeys.rooms.detail(variables.roomId));
      patchRoomInCache(queryClient, variables.roomId, variables.data);
      return { previousRooms, previousDetail };
    },
    onError: (_error, variables, context) => {
      restoreRoomCache(queryClient, variables.roomId, context);
    },
    onSuccess: (room, variables) => {
      upsertRoomInCache(queryClient, room);
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(variables.roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detailedStatus(variables.roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.history(variables.roomId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useUpdateRoomStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, data }: { roomId: string | number; data: RoomStatusUpdateInput }) =>
      RoomsService.updateRoomStatus(roomId, data),
    onSuccess: (room, variables) => {
      upsertRoomInCache(queryClient, room);
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detailedStatus(variables.roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.history(variables.roomId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useEndMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string | number) => RoomsService.endMaintenance(roomId),
    onSuccess: (_, roomId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detailedStatus(roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.history(roomId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useExecuteRoomChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, targetRoomId }: { roomId: string | number; targetRoomId: string }) =>
      RoomsService.executeRoomChange(roomId, targetRoomId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detailedStatus(variables.roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.history(variables.roomId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detailedStatus(variables.targetRoomId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useDeleteRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string | number) => RoomsService.deleteRoom(roomId as number),
    onMutate: async (roomId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rooms.all });
      const previousRooms = queryClient.getQueryData<Room[]>(queryKeys.rooms.all);
      queryClient.setQueryData<Room[]>(queryKeys.rooms.all, (current) =>
        current?.filter((room) => String(room.id) !== String(roomId))
      );
      return { previousRooms };
    },
    onError: (_error, _roomId, context) => {
      if (context?.previousRooms) {
        queryClient.setQueryData(queryKeys.rooms.all, context.previousRooms);
      }
    },
    onSuccess: (_, roomId) => {
      queryClient.removeQueries({ queryKey: queryKeys.rooms.detail(roomId) });
      queryClient.removeQueries({ queryKey: queryKeys.rooms.detailedStatus(roomId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useCreateRoomType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RoomTypeCreateInput) => RoomsService.createRoomType(data),
    onSuccess: () => invalidateRoomDependencies(queryClient),
  });
}

export function useUpdateRoomType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomTypeId, data }: { roomTypeId: number; data: RoomTypeUpdateInput }) =>
      RoomsService.updateRoomType(roomTypeId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roomTypes.detail(variables.roomTypeId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}

export function useDeleteRoomType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roomTypeId: number) => RoomsService.deleteRoomType(roomTypeId),
    onSuccess: (_, roomTypeId) => {
      queryClient.removeQueries({ queryKey: queryKeys.roomTypes.detail(roomTypeId) });
      invalidateRoomDependencies(queryClient);
    },
  });
}
