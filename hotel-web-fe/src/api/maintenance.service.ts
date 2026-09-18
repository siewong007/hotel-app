import { api } from './client';
import { grpcEnabled } from './grpc/flags';
import * as grpcMaintenance from './grpc/housekeeping';
import type {
  CreateMaintenanceTicketRequest,
  ListMaintenanceTicketsQuery,
  MaintenanceTicket,
  MaintenanceTicketListResponse,
  UpdateMaintenanceTicketRequest,
} from '../types/maintenance.types';

export class MaintenanceService {
  static async listTickets(params: ListMaintenanceTicketsQuery = {}): Promise<MaintenanceTicketListResponse> {
    if (grpcEnabled('maintenance')) {
      return await grpcMaintenance.listTickets(params);
    }
    return api.get('maintenance', { searchParams: params as Record<string, string | number> })
      .json<MaintenanceTicketListResponse>();
  }

  static async getTicket(id: string | number): Promise<MaintenanceTicket> {
    if (grpcEnabled('maintenance')) {
      return await grpcMaintenance.getTicket(id);
    }
    return api.get(`maintenance/${id}`).json<MaintenanceTicket>();
  }

  static async createTicket(input: CreateMaintenanceTicketRequest): Promise<MaintenanceTicket> {
    if (grpcEnabled('maintenance')) {
      return await grpcMaintenance.createTicket(input);
    }
    return api.post('maintenance', { json: input }).json<MaintenanceTicket>();
  }

  static async updateTicket(
    id: string | number,
    input: UpdateMaintenanceTicketRequest,
  ): Promise<MaintenanceTicket> {
    if (grpcEnabled('maintenance')) {
      return await grpcMaintenance.updateTicket(id, input);
    }
    return api.patch(`maintenance/${id}`, { json: input }).json<MaintenanceTicket>();
  }
}
