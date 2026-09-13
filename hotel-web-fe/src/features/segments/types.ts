export type SegmentConditionValue = string | number | boolean | string[] | number[] | null;

export interface SegmentCondition {
  field: string;
  op: string;
  value?: SegmentConditionValue;
}

export interface SegmentRuleGroup {
  conditions: SegmentCondition[];
}

export interface SegmentRules {
  groups: SegmentRuleGroup[];
}

export interface GuestSegment {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  rules: SegmentRules;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SegmentSummary extends GuestSegment {
  member_count: number;
}

export interface SegmentListResponse {
  items: SegmentSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface SegmentListParams {
  search?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface SegmentInput {
  name: string;
  description?: string | null;
  rules: SegmentRules;
  is_active?: boolean;
}

export interface SegmentPreview {
  count: number;
  sample: { id: number; name: string }[];
}

export interface LoyaltyTierOption {
  id: number;
  name: string;
}

export interface SegmentFieldOptions {
  loyalty_tiers: LoyaltyTierOption[];
  guest_types: string[];
  distinct_values: {
    countries: string[];
    nationalities: string[];
    languages: string[];
    communication_preferences: string[];
    vip_statuses: string[];
  };
}
