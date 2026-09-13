// Guest Relations workspace types — mirrors
// hotel-app-be/src/modules/guest_relations/models.rs.
// Field names stay snake_case to match the wire contract; timestamps are
// ISO strings, `NaiveDate`s are YYYY-MM-DD strings.

import type {
  SupportConversationDetailResponse,
  SupportConversationSummary,
  SupportPriority,
} from '../features/support/types';

// ---------------------------------------------------------------------
// Interactions (guest_notes)
// ---------------------------------------------------------------------

/** Allowed `guest_notes.interaction_type` values (backend allowlist). */
export type GuestInteractionType = 'note' | 'call' | 'email' | 'in_person' | 'follow_up';

/** A staff-authored guest interaction or note. */
export interface GuestInteraction {
  id: number;
  guest_id: number;
  interaction_type: GuestInteractionType;
  /** Legacy column kept on its 'general' default — the vocabulary lives on `interaction_type`. */
  note_type: string;
  subject: string | null;
  content: string;
  booking_id: number | null;
  is_alert: boolean;
  is_private: boolean;
  follow_up_at: string | null;
  follow_up_completed_at: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** `POST /guests/{id}/interactions` body. `content` is the only required field. */
export interface GuestInteractionInput {
  interaction_type?: GuestInteractionType;
  subject?: string | null;
  content: string;
  booking_id?: number | null;
  is_alert?: boolean;
  is_private?: boolean;
  follow_up_at?: string | null;
  assigned_to?: number | null;
}

/**
 * `PATCH /guests/{id}/interactions/{nid}` body — patch semantics: an absent
 * field leaves the stored value unchanged. `subject: ""` clears the column
 * to NULL; `follow_up_completed` stamps/clears `follow_up_completed_at`.
 * `follow_up_at` and `assigned_to` can be moved but never cleared (sending
 * `null` would read as "unchanged"), so they are typed without `| null`.
 * `booking_id` is deliberately absent — it is not editable post-create.
 */
export interface GuestInteractionUpdate {
  subject?: string;
  content?: string;
  interaction_type?: GuestInteractionType;
  is_alert?: boolean;
  is_private?: boolean;
  follow_up_at?: string;
  follow_up_completed?: boolean;
  assigned_to?: number;
}

export interface GuestInteractionListParams {
  page?: number;
  page_size?: number;
  /** Completed follow-ups are hidden unless this is true. */
  include_completed_followups?: boolean;
}

/** Guest-domain lists use the `{ data, ... }` envelope (support uses `items`). */
export interface GuestInteractionListResponse {
  data: GuestInteraction[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------
// Preferences (guest_preferences)
// ---------------------------------------------------------------------

/** Controlled vocabulary for `guest_preferences.category` (API-enforced). */
export type GuestPreferenceCategory =
  | 'room'
  | 'bed'
  | 'floor'
  | 'dietary'
  | 'communication'
  | 'occasion'
  | 'other';

export interface GuestPreference {
  id: number;
  /** Typed loose — rows predating the API allowlist can carry other values. */
  category: string;
  preference_key: string;
  preference_value: string;
  updated_at: string;
}

export interface GuestPreferenceEntry {
  category: GuestPreferenceCategory;
  preference_key: string;
  preference_value: string;
}

/**
 * `PUT /guests/{id}/preferences` body — upserts entries on
 * (guest_id, category, preference_key); when `replace_categories` is given,
 * keys absent from `entries` are deleted for the listed categories.
 * Returns the full updated `GuestPreference[]`.
 */
export interface GuestPreferencesPutRequest {
  entries: GuestPreferenceEntry[];
  replace_categories?: GuestPreferenceCategory[];
}

// ---------------------------------------------------------------------
// Reviews (guest_reviews)
// ---------------------------------------------------------------------

export interface GuestReview {
  id: number;
  booking_id: number | null;
  overall_rating: number;
  title: string | null;
  content: string | null;
  response: string | null;
  response_at: string | null;
  is_published: boolean;
  created_at: string;
}

/** `POST /guests/{id}/reviews/{rid}/response` body. */
export interface GuestReviewResponseInput {
  response: string;
}

// ---------------------------------------------------------------------
// Loyalty
// ---------------------------------------------------------------------

export interface GuestLoyaltyRedemption {
  id: number;
  reward_name: string | null;
  points: number;
  status: string;
  created_at: string;
}

/** `GET /guests/{id}/loyalty` returns 200 + `null` for non-members. */
export interface GuestLoyaltySummary {
  member_number: string;
  status: string;
  tier_code: string;
  tier_name: string;
  available_points: number;
  lifetime_points: number;
  qualifying_nights: number;
  recent_redemptions: GuestLoyaltyRedemption[];
}

// ---------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------

export interface GuestVoucher {
  id: number;
  code: string;
  status: string;
  source: string;
  promotion_id: number;
  promotion_name: string | null;
  promotion_slug: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
}

// ---------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------

export interface GuestSubscription {
  channel: string;
  topic: string;
  subscribed: boolean;
  updated_at: string;
}

export interface GuestDelivery {
  id: number;
  kind: string;
  subject: string | null;
  status: string;
  created_at: string;
}

export interface GuestCommunicationsSummary {
  marketing_opt_in: boolean;
  communication_preference: string | null;
  language_preference: string | null;
  email_suppressed: boolean;
  subscriptions: GuestSubscription[];
  recent_deliveries: GuestDelivery[];
}

// ---------------------------------------------------------------------
// Support — reuses the support feature's wire types.
// ---------------------------------------------------------------------

/** `GET /guests/{id}/support` returns the staff conversation summary shape. */
export type GuestSupportConversationSummary = SupportConversationSummary;

/** `POST /support/conversations` returns the staff conversation detail. */
export type GuestSupportConversationDetail = SupportConversationDetailResponse;

/** Mirrors `SUPPORT_CATEGORIES` in modules/support/validation.rs. */
export type GuestSupportConversationCategory =
  | 'booking'
  | 'stay'
  | 'billing'
  | 'loyalty'
  | 'technical'
  | 'other'
  | 'service_request'
  | 'complaint';

/** `POST /support/conversations` body (staff-side creation on a guest's behalf). */
export interface CreateStaffSupportConversationRequest {
  guest_id: number;
  category: GuestSupportConversationCategory;
  subject?: string;
  message: string;
  booking_id?: number;
  priority?: SupportPriority;
  assignee_id?: number;
}
