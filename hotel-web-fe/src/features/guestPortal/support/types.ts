/**
 * Guest-safe support contracts. These intentionally live with the portal
 * feature rather than in the staff-facing support domain: a guest must never
 * receive assignment, priority, escalation, or internal-note data.
 */

export const PORTAL_SUPPORT_CATEGORIES = [
  { value: 'booking', label: 'Booking or check-in' },
  { value: 'stay', label: 'My stay or room' },
  { value: 'billing', label: 'Billing or payment' },
  { value: 'loyalty', label: 'Membership or rewards' },
  { value: 'technical', label: 'Portal or technical issue' },
  { value: 'other', label: 'Something else' },
] as const;

export type PortalSupportCategory = (typeof PORTAL_SUPPORT_CATEGORIES)[number]['value'];

export type PortalSupportStatus =
  | 'waiting_for_staff'
  | 'waiting_for_guest'
  | 'resolved'
  | 'closed';

export type PortalSupportConversationId = number | string;

export interface PortalSupportConversation {
  id: PortalSupportConversationId;
  category: PortalSupportCategory;
  status: PortalSupportStatus;
  assigned_team: string | null;
  booking_id: number | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  can_reopen: boolean;
  version: number;
}

export interface PortalSupportMessage {
  id: PortalSupportConversationId;
  body: string;
  author_type: 'guest' | 'staff' | 'system';
  created_at: string;
}

export interface PortalSupportConversationDetail {
  conversation: PortalSupportConversation;
  messages: PortalSupportMessage[];
}

export interface CreatePortalSupportConversationRequest {
  category: PortalSupportCategory;
  message: string;
  booking_id?: number;
}

export interface CreatePortalSupportMessageRequest {
  message: string;
  client_message_id?: string;
  expected_version?: number;
}

export interface PortalSupportConversationListResponse {
  items: PortalSupportConversation[];
  total: number;
  page: number;
  page_size: number;
}
