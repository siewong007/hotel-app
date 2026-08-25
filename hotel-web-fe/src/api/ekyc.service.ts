/**
 * Guest eKYC submission. Admin-created verifications (EkycCreateDialog) send
 * every field including guest_id; the self-service registration page omits
 * guest_id and may send null for untouched optionals.
 */
export interface EkycSubmitPayload {
  guest_id?: number | string;
  full_name?: string;
  date_of_birth?: string;
  nationality?: string | null;
  phone?: string | null;
  email?: string | null;
  current_address?: string | null;
  id_type?: string;
  id_number?: string;
  id_issuing_country?: string | null;
  id_issue_date?: string | null;
  id_expiry_date?: string;
  id_front_image?: string | null;
  id_back_image?: string | null;
  selfie_image?: string | null;
  proof_of_address?: string | null;
  self_checkin_enabled?: boolean;
}

import { HTTPError } from 'ky';
import { api, APIError } from './client';

export interface EkycListParams {
  [key: string]: string | number | boolean | undefined;
  status?: string;
  submission_from?: string;
  submission_to?: string;
  risk_level?: string;
  verification_method?: string;
  assigned_reviewer_id?: number;
  nationality?: string;
  country?: string;
  document_type?: string;
  provider_result?: string;
  manual_review_required?: boolean;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface EkycApplicationSummary {
  id: number;
  application_id: string;
  user_id: number;
  guest_id: number | null;
  status: string;
  assigned_reviewer_id: number | null;
  assigned_reviewer_name: string | null;
  full_name: string | null;
  email_masked: string | null;
  phone_masked: string | null;
  id_type: string | null;
  id_number_masked: string | null;
  nationality: string | null;
  country: string | null;
  provider_name: string | null;
  provider_verification_result: string | null;
  manual_review_required: boolean;
  risk_level: string;
  risk_score: number;
  triggered_risk_rules: string[];
  recommended_action: string | null;
  potential_duplicate: boolean;
  fraud_suspected: boolean;
  self_checkin_enabled: boolean;
  submitted_at: string | null;
  verified_at: string | null;
  updated_at: string;
  nearing_sla: boolean;
  overdue_sla: boolean;
  version: number;
}

export interface EkycDashboardMetrics {
  total_submitted: number;
  pending_review: number;
  under_manual_review: number;
  approved: number;
  rejected: number;
  resubmission_required: number;
  escalated_high_risk: number;
  average_processing_minutes: number | null;
  nearing_sla: number;
  daily_trend: number;
  weekly_trend: number;
  monthly_trend: number;
}

export interface EkycListResponse {
  data: EkycApplicationSummary[];
  metrics: EkycDashboardMetrics;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface EkycReasonCode {
  code: string;
  label: string;
  category: string;
  requires_details: boolean;
  customer_message_template: string | null;
  is_active: boolean;
}

export interface EkycDecisionHistory {
  id: number;
  application_id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  reason_code: string | null;
  reason: string | null;
  details: unknown;
  created_at: string;
}

export interface EkycNote {
  id: number;
  application_id: number;
  note_type: string;
  body: string;
  customer_visible: boolean;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface EkycApplicationDetail {
  summary: EkycApplicationSummary;
  date_of_birth_masked: string | null;
  current_address_masked: string | null;
  id_issuing_country: string | null;
  id_issue_date: string | null;
  id_expiry_date: string | null;
  document_authenticity_result: string | null;
  face_match_score: number | null;
  face_match_passed: boolean | null;
  liveness_score: number | null;
  liveness_passed: boolean | null;
  duplicate_check_result: string | null;
  watchlist_result: string | null;
  ip_address_masked: string | null;
  device_fingerprint: string | null;
  geolocation: string | null;
  submission_metadata: unknown;
  ocr_data: unknown;
  user_entered_data: unknown;
  provider_raw_response: unknown;
  provider_raw_response_available: boolean;
  verification_notes: string | null;
  customer_message: string | null;
  decision_reason_code: string | null;
  decision_reason: string | null;
  documents: {
    id_front: boolean;
    id_back: boolean;
    selfie: boolean;
    proof_of_address: boolean;
  };
  differences: Array<{
    field: string;
    submitted_value: string | null;
    extracted_value: string | null;
    matches: boolean;
  }>;
  history: EkycDecisionHistory[];
  notes: EkycNote[];
}

export interface EkycActionPayload {
  action: string;
  expected_version: number;
  reason_code?: string;
  reason?: string;
  customer_message?: string;
  assigned_reviewer_id?: number;
  note?: string;
  note_type?: string;
  target_status?: string;
  self_checkin_enabled?: boolean;
  idempotency_key?: string;
}

function paramsToSearch(params?: EkycListParams): string {
  const searchParams = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') return;
    searchParams.set(key, String(value));
  });
  const search = searchParams.toString();
  return search ? `?${search}` : '';
}

async function mapHttpError(error: unknown, fallback: string): Promise<never> {
  if (error instanceof HTTPError) {
    const errorData = await error.response.json<{ error?: string }>().catch(() => ({}) as { error?: string });
    throw new APIError(
      errorData.error || fallback,
      error.response.status,
      errorData
    );
  }
  throw new APIError(fallback);
}

export class EkycService {
  static async getEkycStatus(): Promise<{ status: string; submitted_at?: string } | null> {
    return await api.get('ekyc/status').json();
  }

  static async submitEkycVerification(data: EkycSubmitPayload): Promise<void> {
    try {
      await api.post('ekyc/submit', { json: data });
    } catch (error) {
      await mapHttpError(error, 'eKYC submission failed');
    }
  }

  static async getEkycVerificationDetails(): Promise<any> {
    return await api.get('ekyc/status').json();
  }

  static async getAllEkycVerifications(params?: EkycListParams): Promise<EkycListResponse> {
    return await api.get(`ekyc/admin/applications${paramsToSearch(params)}`).json();
  }

  static async getEkycApplication(applicationId: number): Promise<EkycApplicationDetail> {
    return await api.get(`ekyc/admin/applications/${applicationId}`).json();
  }

  static async getReasonCodes(): Promise<EkycReasonCode[]> {
    return await api.get('ekyc/admin/reason-codes').json();
  }

  static async performReviewAction(
    applicationId: number,
    payload: EkycActionPayload
  ): Promise<EkycApplicationDetail> {
    try {
      return await api
        .post(`ekyc/admin/applications/${applicationId}/actions`, { json: payload })
        .json();
    } catch (error) {
      return await mapHttpError(error, 'eKYC action failed');
    }
  }

  static async revealSensitiveField(
    applicationId: number,
    field: string,
    reason: string
  ): Promise<{ field: string; value: string | null }> {
    try {
      return await api
        .post(`ekyc/admin/applications/${applicationId}/reveal`, {
          json: { field, reason },
        })
        .json();
    } catch (error) {
      return await mapHttpError(error, 'Sensitive field reveal failed');
    }
  }

  static async exportEkycApplications(params?: EkycListParams): Promise<Blob> {
    return await api.get(`ekyc/admin/applications/export${paramsToSearch(params)}`).blob();
  }

  static async approveEkycVerification(verificationId: number): Promise<void> {
    await this.performReviewAction(verificationId, {
      action: 'approve',
      expected_version: 1,
      reason_code: 'manual_override',
      reason: 'Legacy approval action',
      self_checkin_enabled: true,
    });
  }

  static async rejectEkycVerification(verificationId: number, reason: string): Promise<void> {
    await this.performReviewAction(verificationId, {
      action: 'reject',
      expected_version: 1,
      reason_code: 'other',
      reason,
    });
  }

  static async uploadEkycDocument(file: File, documentType: string): Promise<{ filename: string; file_path: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);

    try {
      return await api.post('ekyc/upload-document', { body: formData }).json();
    } catch (error) {
      return await mapHttpError(error, 'Document upload failed');
    }
  }

  static async createEkycApplication(
    payload: EkycAdminCreatePayload
  ): Promise<EkycApplicationDetail> {
    try {
      return await api.post('ekyc/admin/applications', { json: payload }).json();
    } catch (error) {
      return await mapHttpError(error, 'Unable to create eKYC verification');
    }
  }
}

export interface EkycAdminCreatePayload {
  guest_id: number;
  selfie_image: string;
  id_front_image: string;
  id_back_image?: string;
  id_type?: string;
  id_number?: string;
  full_name?: string;
  date_of_birth?: string;
  nationality?: string;
  id_expiry_date?: string;
  id_issue_date?: string;
  id_issuing_country?: string;
  proof_of_address?: string;
  phone?: string;
  email?: string;
  current_address?: string;
  self_checkin_enabled?: boolean;
}
