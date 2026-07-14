export type SupportConversationStatus =
  | 'waiting_for_staff'
  | 'waiting_for_guest'
  | 'resolved'
  | 'closed';

export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

export type SupportQueue =
  | 'unassigned'
  | 'mine'
  | 'waiting_for_staff'
  | 'waiting_for_guest'
  | 'at_risk'
  | 'resolved'
  | 'closed';

export type SupportMessageAuthor = 'guest' | 'staff' | 'system';

export type SupportAction =
  | 'claim'
  | 'assign'
  | 'release'
  | 'set_priority'
  | 'escalate'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'add_internal_note';

export interface SupportConversationListParams {
  queue?: SupportQueue;
  status?: SupportConversationStatus;
  priority?: SupportPriority;
  assigned_to_user_id?: number;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface SupportConversationSummary {
  id: number;
  conversation_number: string;
  guest_id: number | null;
  guest_name: string;
  guest_email?: string | null;
  booking_id?: number | null;
  booking_reference?: string | null;
  room_number?: string | null;
  category: string;
  status: SupportConversationStatus;
  priority: SupportPriority;
  queue: string | null;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  escalation_level: number;
  escalated_at: string | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_activity_at: string;
  unread_count: number;
  is_sla_at_risk: boolean;
  is_sla_breached: boolean;
  version: number;
}

export interface SupportConversation extends SupportConversationSummary {
  subject?: string | null;
  stay_status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  resolution_code?: string | null;
  resolution_summary?: string | null;
  reopen_count: number;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: number;
  conversation_id: number;
  author_type: SupportMessageAuthor;
  author_user_id: number | null;
  author_guest_id?: number | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface SupportEvent {
  id: number;
  conversation_id: number;
  event_type: string;
  actor_user_id: number | null;
  actor_name: string | null;
  body: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface SupportConversationDetailResponse {
  conversation: SupportConversation;
  messages: SupportMessage[];
  events: SupportEvent[];
}

export interface SupportQueueMetrics {
  total_open?: number;
  unassigned?: number;
  waiting_for_staff?: number;
  waiting_for_guest?: number;
  at_risk?: number;
  breached?: number;
}

export interface SupportConversationListResponse {
  items: SupportConversationSummary[];
  total: number;
  page: number;
  page_size: number;
  metrics?: SupportQueueMetrics;
}

export interface SupportAgent {
  id: number;
  name: string;
  email?: string | null;
  is_available?: boolean;
}

export interface SupportMessagePayload {
  message: string;
  client_message_id?: string;
  expected_version?: number;
}

export interface SupportActionPayload {
  action: SupportAction;
  expected_version?: number;
  assignee_id?: number | null;
  priority?: SupportPriority;
  reason?: string;
  resolution_code?: string;
  resolution_summary?: string;
  client_action_id?: string;
}

export interface SupportActionRequest {
  conversationId: number;
  payload: SupportActionPayload;
}

export interface SupportMessageRequest {
  conversationId: number;
  payload: SupportMessagePayload;
}

export const SUPPORT_QUEUE_TABS: Array<{ value: SupportQueue; label: string }> = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'mine', label: 'Mine' },
  { value: 'waiting_for_staff', label: 'Needs reply' },
  { value: 'waiting_for_guest', label: 'Waiting for guest' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'resolved', label: 'Resolved' },
];

export const SUPPORT_STATUS_OPTIONS: SupportConversationStatus[] = [
  'waiting_for_staff',
  'waiting_for_guest',
  'resolved',
  'closed',
];

export const SUPPORT_PRIORITY_OPTIONS: SupportPriority[] = ['low', 'normal', 'high', 'urgent'];
