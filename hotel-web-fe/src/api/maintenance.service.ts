import { api } from './client';
import type {
  CreateMaintenanceTicketRequest,
  ListMaintenanceTicketsQuery,
  MaintenanceTicket,
  MaintenanceTicketListResponse,
  UpdateMaintenanceTicketRequest,
} from '../types/maintenance.types';

export class MaintenanceService {
  static async listTickets(params: ListMaintenanceTicketsQuery = {}): Promise<MaintenanceTicketListResponse> {
    return api.get('maintenance', { searchParams: params as Record<string, string | number> })
      .json<MaintenanceTicketListResponse>();
  }

  static async getTicket(id: string | number): Promise<MaintenanceTicket> {
    return api.get(`maintenance/${id}`).json<MaintenanceTicket>();
  }

  static async createTicket(input: CreateMaintenanceTicketRequest): Promise<MaintenanceTicket> {
    return api.post('maintenance', { json: input }).json<MaintenanceTicket>();
  }

  static async updateTicket(
    id: string | number,
    input: UpdateMaintenanceTicketRequest,
  ): Promise<MaintenanceTicket> {
    return api.patch(`maintenance/${id}`, { json: input }).json<MaintenanceTicket>();
  }
}
