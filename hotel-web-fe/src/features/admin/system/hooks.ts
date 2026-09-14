import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getJobFailures,
  getStaffNotifications,
  getSystemHealth,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
} from './api';

const POLL_MS = 30_000;

export function useSystemHealth(enabled = true) {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: getSystemHealth,
    staleTime: 15_000,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    enabled,
  });
}

export function useJobFailures(enabled = true) {
  return useQuery({
    queryKey: ['system', 'job-failures'],
    queryFn: getJobFailures,
    staleTime: 15_000,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    enabled,
  });
}

export function useStaffNotifications(enabled: boolean, open: boolean) {
  return useQuery({
    queryKey: ['system', 'staff-notifications'],
    queryFn: getStaffNotifications,
    staleTime: 15_000,
    refetchInterval: open ? 15_000 : 60_000,
    refetchIntervalInBackground: false,
    enabled,
  });
}

export function useMarkStaffNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markStaffNotificationRead,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['system', 'staff-notifications'] }),
  });
}

export function useMarkAllStaffNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllStaffNotificationsRead,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['system', 'staff-notifications'] }),
  });
}
