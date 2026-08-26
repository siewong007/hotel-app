export type DeliveryTier = 'transactional' | 'marketing';
export type TierFilter = 'all' | DeliveryTier;

/** One row of the admin delivery feed (masked recipient, server-derived tier). */
export interface DeliveryFeedItem {
  id: number;
  campaign_id: number | null;
  kind: string;
  guest_id: number;
  topic: string;
  subject: string;
  recipient_masked: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  tier: DeliveryTier;
}

export interface DeliveryFeedResponse {
  items: DeliveryFeedItem[];
  total: number;
  /** queued + sending across all filters — drives the bell badge. */
  unread: number;
  page: number;
  page_size: number;
}

export interface DeliveryFeedParams {
  tier?: TierFilter;
  status?: string;
  page?: number;
  page_size?: number;
}
