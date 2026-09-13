import { api } from '../../api/client';
import type {
  GuestSegment,
  SegmentFieldOptions,
  SegmentInput,
  SegmentListParams,
  SegmentListResponse,
  SegmentPreview,
  SegmentRules,
} from './types';

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

export const SegmentsApi = {
  list(params?: SegmentListParams): Promise<SegmentListResponse> {
    return api
      .get('admin/segments', { searchParams: toSearchParams({ ...params }) })
      .json<SegmentListResponse>();
  },

  get(id: number): Promise<GuestSegment> {
    return api.get(`admin/segments/${id}`).json<GuestSegment>();
  },

  create(input: SegmentInput): Promise<GuestSegment> {
    return api.post('admin/segments', { json: input }).json<GuestSegment>();
  },

  update(id: number, input: SegmentInput): Promise<GuestSegment> {
    return api.put(`admin/segments/${id}`, { json: input }).json<GuestSegment>();
  },

  remove(id: number): Promise<{ status: string }> {
    return api.delete(`admin/segments/${id}`).json<{ status: string }>();
  },

  /** Saved-segment preview: live count + up to 10 sample names. */
  preview(id: number): Promise<SegmentPreview> {
    return api.get(`admin/segments/${id}/preview`).json<SegmentPreview>();
  },

  /** Unsaved-rules preview from the editor — count only. */
  previewRules(rules: SegmentRules): Promise<SegmentPreview> {
    return api.post('admin/segments/preview', { json: { rules } }).json<SegmentPreview>();
  },

  fieldOptions(): Promise<SegmentFieldOptions> {
    return api.get('admin/segments/field-options').json<SegmentFieldOptions>();
  },
};
