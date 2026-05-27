import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RoomsService } from '../../../api';
import { queryKeys } from '../../../api/queryKeys';
import type {
  Room,
  RoomStatusUpdateInput,
  RoomTypeCreateInput,
  RoomTypeUpdateInput,
} from '../../../types';

type CreateRoomInput = Parameters<typeof RoomsService.createRoom>[0];

const invalidateRoomDependencies = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.roomTypes.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.nightAudit.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
};

export function useRooms(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.all,
    queryFn: () => RoomsService.getAllRooms(),
    enabled,
    staleTime: 60_000,
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
    staleTime: 30_000,
  });
}

export function useRoomDetailedStatus(roomId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.detailedStatus(roomId ?? ''),
    queryFn: () => RoomsService.getRoomDetailedStatus(roomId as string | number),
    enabled: enabled && roomId != null && roomId !== '',
    staleTime: 15_000,
  });
}

export function useRoomHistory(roomId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.history(roomId ?? ''),
    queryFn: () => RoomsService.getRoomHistory(roomId as string | number),
    enabled: enabled && roomId != null && roomId !== '',
    staleTime: 30_000,
  });
}

export function useRoomTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roomTypes.active(),
    queryFn: () => RoomsService.getRoomTypes(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAllRoomTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roomTypes.list(),
    queryFn: () => RoomsService.getAllRoomTypes(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useRoomsWithOccupancy(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.withOccupancy(),
    queryFn: () => RoomsService.getRoomsWithOccupancy(),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRoomInput) => RoomsService.createRoom(data),
    onSuccess: () => invalidateRoomDependencies(queryClient),
  });
}

export function useUpdateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, data }: { roomId: string | number; data: Partial<Room> }) =>
      RoomsService.updateRoom(roomId, data),
    onSuccess: (_, variables) => {
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
    onSuccess: (_, variables) => {
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
