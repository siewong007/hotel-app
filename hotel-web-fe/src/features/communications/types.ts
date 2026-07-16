export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type CampaignType = 'announcement' | 'promotion';

export type NotificationTopic = 'announcement' | 'promotion' | 'birthday_voucher';

export interface EmailCampaign {
  id: number;
  name: string;
  campaign_type: CampaignType;
  topic: NotificationTopic;
  status: CampaignStatus;
  subject: string;
  body_html: string;
  body_text: string | null;
  template_id: number | null;
  promotion_id: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  error: string | null;
  created_by: number | null;
  cancelled_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignListResponse {
  items: EmailCampaign[];
  total: number;
  page: number;
  page_size: number;
}

export interface CampaignInput {
  name: string;
  campaign_type: CampaignType;
  subject: string;
  body_html: string;
  body_text?: string | null;
  template_id?: number | null;
  promotion_id?: number | null;
}

export interface CampaignListParams {
  status?: string;
  campaign_type?: string;
  page?: number;
  page_size?: number;
}

export interface AudienceCount {
  eligible: number;
  excluded_no_email: number;
  excluded_inactive: number;
  excluded_unsubscribed: number;
  excluded_suppressed: number;
}

export interface PreviewResponse {
  subject: string;
  body_html: string;
  audience: AudienceCount;
}

export interface DeliverySummary {
  id: number;
  campaign_id: number | null;
  kind: string;
  guest_id: number;
  topic: NotificationTopic;
  recipient_masked: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface DeliveryListResponse {
  items: DeliverySummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface EmailTemplate {
  id: number;
  code: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TemplateInput {
  code: string;
  name: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  variables?: string[];
  is_active?: boolean;
}

export interface EmailSuppression {
  id: number;
  email: string;
  reason: string;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export interface SuppressionListResponse {
  items: EmailSuppression[];
  total: number;
  page: number;
  page_size: number;
}

export interface SuppressionInput {
  email: string;
  reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual';
  notes?: string | null;
}

export interface TopicPreference {
  topic: NotificationTopic;
  subscribed: boolean;
}

export interface PreferencesResponse {
  subscriptions: TopicPreference[];
}

export interface ConsentEvent {
  id: number;
  guest_id: number;
  channel: string;
  topic: string;
  action: 'opt_in' | 'opt_out';
  source: string;
  policy_version: string | null;
  actor_type: 'guest' | 'staff' | 'system';
  actor_user_id: number | null;
  created_at: string;
}

export interface ConsentStatusResponse {
  subscriptions: TopicPreference[];
  events: ConsentEvent[];
}

export interface PreferenceUpdateInput {
  subscriptions: { topic: NotificationTopic; subscribed: boolean }[];
  policy_version?: string;
}

export const TOPIC_LABELS: Record<NotificationTopic, string> = {
  announcement: 'Hotel announcements',
  promotion: 'Promotions and offers',
  birthday_voucher: 'Birthday voucher',
};
