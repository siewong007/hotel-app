import { api } from '../../../api/client';
import type {
  JobRunRow,
  StaffNotificationsResponse,
  SystemHealthResponse,
} from './types';

export function getSystemHealth(): Promise<SystemHealthResponse> {
  return api.get('system/health').json<SystemHealthResponse>();
}

export function getJobFailures(): Promise<JobRunRow[]> {
  return api.get('system/jobs/failures').json<JobRunRow[]>();
}

export function getStaffNotifications(): Promise<StaffNotificationsResponse> {
  return api.get('system/notifications').json<StaffNotificationsResponse>();
}

export function markStaffNotificationRead(id: number): Promise<void> {
  return api.post(`system/notifications/${id}/read`).json<void>();
}

export function markAllStaffNotificationsRead(): Promise<void> {
  return api.post('system/notifications/read-all').json<void>();
}
