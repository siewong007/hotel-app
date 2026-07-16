import { api } from '../../../api/client';
import type {
  AudienceCount,
  CampaignInput,
  CampaignListParams,
  CampaignListResponse,
  ConsentStatusResponse,
  DeliveryListResponse,
  EmailCampaign,
  EmailTemplate,
  PreferenceUpdateInput,
  PreviewResponse,
  SuppressionInput,
  SuppressionListResponse,
  TemplateInput,
} from '../types';

function toSearchParams(values?: Record<string, unknown>): URLSearchParams | undefined {
  if (!values) return undefined;
  const searchParams = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });
  return searchParams;
}

export const CommunicationsApi = {
  listCampaigns(params?: CampaignListParams): Promise<CampaignListResponse> {
    return api
      .get('admin/communications/campaigns', { searchParams: toSearchParams({ ...params }) })
      .json<CampaignListResponse>();
  },

  getCampaign(id: number): Promise<EmailCampaign> {
    return api.get(`admin/communications/campaigns/${id}`).json<EmailCampaign>();
  },

  createCampaign(input: CampaignInput): Promise<EmailCampaign> {
    return api.post('admin/communications/campaigns', { json: input }).json<EmailCampaign>();
  },

  updateCampaign(id: number, input: CampaignInput): Promise<EmailCampaign> {
    return api.put(`admin/communications/campaigns/${id}`, { json: input }).json<EmailCampaign>();
  },

  previewCampaign(id: number): Promise<PreviewResponse> {
    return api.post(`admin/communications/campaigns/${id}/preview`).json<PreviewResponse>();
  },

  testSendCampaign(id: number, recipientEmail: string): Promise<{ status: string }> {
    return api
      .post(`admin/communications/campaigns/${id}/test-send`, {
        json: { recipient_email: recipientEmail },
      })
      .json<{ status: string }>();
  },

  scheduleCampaign(id: number, scheduledAt?: string): Promise<EmailCampaign> {
    return api
      .post(`admin/communications/campaigns/${id}/schedule`, {
        json: { scheduled_at: scheduledAt ?? null },
      })
      .json<EmailCampaign>();
  },

  cancelCampaign(id: number): Promise<EmailCampaign> {
    return api.post(`admin/communications/campaigns/${id}/cancel`).json<EmailCampaign>();
  },

  listDeliveries(id: number, page = 1, pageSize = 25): Promise<DeliveryListResponse> {
    return api
      .get(`admin/communications/campaigns/${id}/deliveries`, {
        searchParams: toSearchParams({ page, page_size: pageSize }),
      })
      .json<DeliveryListResponse>();
  },

  audienceCount(topic: string): Promise<AudienceCount> {
    return api
      .get('admin/communications/audience', { searchParams: toSearchParams({ topic }) })
      .json<AudienceCount>();
  },

  listTemplates(): Promise<EmailTemplate[]> {
    return api.get('admin/communications/templates').json<EmailTemplate[]>();
  },

  createTemplate(input: TemplateInput): Promise<EmailTemplate> {
    return api.post('admin/communications/templates', { json: input }).json<EmailTemplate>();
  },

  updateTemplate(id: number, input: TemplateInput): Promise<EmailTemplate> {
    return api.put(`admin/communications/templates/${id}`, { json: input }).json<EmailTemplate>();
  },

  deactivateTemplate(id: number): Promise<{ status: string }> {
    return api
      .post(`admin/communications/templates/${id}/deactivate`)
      .json<{ status: string }>();
  },

  listSuppressions(page = 1, pageSize = 25): Promise<SuppressionListResponse> {
    return api
      .get('admin/communications/suppressions', {
        searchParams: toSearchParams({ page, page_size: pageSize }),
      })
      .json<SuppressionListResponse>();
  },

  addSuppression(input: SuppressionInput): Promise<{ status: string }> {
    return api
      .post('admin/communications/suppressions', { json: input })
      .json<{ status: string }>();
  },

  removeSuppression(email: string): Promise<{ status: string }> {
    return api
      .delete(`admin/communications/suppressions/${encodeURIComponent(email)}`)
      .json<{ status: string }>();
  },

  guestConsentStatus(guestId: number): Promise<ConsentStatusResponse> {
    return api
      .get(`admin/communications/guests/${guestId}/consent`)
      .json<ConsentStatusResponse>();
  },

  recordStaffConsent(
    guestId: number,
    input: PreferenceUpdateInput
  ): Promise<ConsentStatusResponse> {
    return api
      .post(`admin/communications/guests/${guestId}/consent`, { json: input })
      .json<ConsentStatusResponse>();
  },
};
