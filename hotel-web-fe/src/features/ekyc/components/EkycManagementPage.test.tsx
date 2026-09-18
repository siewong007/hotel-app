import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EkycApplicationDetail,
  EkycApplicationSummary,
  EkycDashboardMetrics,
  EkycReasonCode,
} from '../../../api/ekyc.service';

const mocks = vi.hoisted(() => ({
  list: {
    data: undefined as unknown,
    isPending: false,
    isFetching: false,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  detail: {
    data: undefined as unknown,
    isPending: false,
    isLoading: false,
    error: null as unknown,
  },
  reasonCodes: { data: [] as EkycReasonCode[] },
  reviewAction: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
  reveal: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
}));

const emptyMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { id: 'u1' } }),
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

vi.mock('../hooks/useEkycQueries', () => ({
  useAllEkycVerifications: () => mocks.list,
  useEkycApplication: () => mocks.detail,
  useEkycReasonCodes: () => mocks.reasonCodes,
  useRevealEkycField: () => mocks.reveal,
  useReviewEkycAction: () => mocks.reviewAction,
  useApproveEkyc: () => emptyMutation,
  useRejectEkyc: () => emptyMutation,
}));

vi.mock('../../../api/ekyc.service', () => ({
  EkycService: { exportEkycApplications: vi.fn() },
}));

// The detail dialog loads document images through the raw api client; answer
// 404 so they settle on the "No document on file" state without a real fetch.
vi.mock('../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(() => ({
        blob: () =>
          Promise.reject(
            Object.assign(new Error('document not stored'), { response: { status: 404 } }),
          ),
      })),
    },
  };
});

vi.mock('./EkycCreateDialog', () => ({
  default: () => null,
}));

import EkycManagementPage from './EkycManagementPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const metricsFixture = (): EkycDashboardMetrics => ({
  total_submitted: 1,
  pending_review: 1,
  under_manual_review: 0,
  approved: 0,
  rejected: 0,
  resubmission_required: 0,
  escalated_high_risk: 0,
  average_processing_minutes: null,
  nearing_sla: 0,
  daily_trend: 0,
  weekly_trend: 0,
  monthly_trend: 0,
});

const summaryFixture = (over: Partial<EkycApplicationSummary> = {}): EkycApplicationSummary => ({
  id: 7,
  application_id: 'EKYC-0007',
  user_id: 42,
  guest_id: 9,
  status: 'submitted',
  assigned_reviewer_id: null,
  assigned_reviewer_name: null,
  full_name: 'Amina Yusof',
  email_masked: 'a***@example.com',
  phone_masked: '+60****123',
  id_type: 'passport',
  id_number_masked: 'A****789',
  nationality: 'MY',
  country: 'MY',
  provider_name: 'stub',
  provider_verification_result: 'clear',
  manual_review_required: true,
  risk_level: 'low',
  risk_score: 12,
  triggered_risk_rules: [],
  recommended_action: null,
  potential_duplicate: false,
  fraud_suspected: false,
  self_checkin_enabled: false,
  submitted_at: '2026-09-01T04:00:00Z',
  verified_at: null,
  updated_at: '2026-09-01T04:00:00Z',
  nearing_sla: false,
  overdue_sla: false,
  next_arrival_date: null,
  arrival_imminent: false,
  version: 3,
  ...over,
});

const detailFixture = (over: Partial<EkycApplicationDetail> = {}): EkycApplicationDetail => ({
  summary: summaryFixture(),
  date_of_birth_masked: null,
  current_address_masked: null,
  id_issuing_country: null,
  id_issue_date: null,
  id_expiry_date: null,
  document_authenticity_result: 'clear',
  face_match_score: 0.97,
  face_match_passed: true,
  liveness_score: 0.99,
  liveness_passed: true,
  duplicate_check_result: 'clear',
  watchlist_result: 'clear',
  ip_address_masked: null,
  device_fingerprint: null,
  geolocation: null,
  submission_metadata: null,
  ocr_data: null,
  user_entered_data: null,
  provider_raw_response: null,
  provider_raw_response_available: false,
  verification_notes: null,
  customer_message: null,
  decision_reason_code: null,
  decision_reason: null,
  documents: { id_front: true, id_back: true, selfie: true, proof_of_address: false },
  differences: [],
  history: [],
  notes: [],
  ...over,
});

const reasonCodeFixture = (over: Partial<EkycReasonCode> = {}): EkycReasonCode => ({
  code: 'DOC_UNREADABLE',
  label: 'Document unreadable',
  category: 'document',
  requires_details: false,
  customer_message_template: null,
  is_active: true,
  ...over,
});

// Queue rows open the detail dialog only through the row's view icon-button —
// the TableRow itself has no click handler.
const openDetailDialog = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: 'View application' }));
  return await screen.findByRole('dialog');
};

// The review-action dialog opens stacked on top of the detail dialog; MUI
// appends later portals to the body, so it is the last dialog in the DOM.
const lastDialog = async (): Promise<HTMLElement> => {
  const dialogs = await screen.findAllByRole('dialog');
  return dialogs[dialogs.length - 1];
};

describe('EkycManagementPage', () => {
  beforeEach(() => {
    mocks.list = {
      data: {
        data: [summaryFixture()],
        total: 1,
        page: 1,
        page_size: 10,
        total_pages: 1,
        metrics: metricsFixture(),
      },
      isPending: false,
      isFetching: false,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    mocks.detail = { data: detailFixture(), isPending: false, isLoading: false, error: null };
    mocks.reasonCodes = { data: [] };
    mocks.reviewAction.mutateAsync.mockReset();
    mocks.reviewAction.mutateAsync.mockResolvedValue(detailFixture());
    mocks.reviewAction.mutate.mockReset();
    mocks.reviewAction.isPending = false;
    mocks.reveal.mutateAsync.mockReset();
    mocks.reveal.mutateAsync.mockResolvedValue({ field: 'id_number', value: 'A12345678' });
    mocks.reveal.mutate.mockReset();
    mocks.reveal.isPending = false;
  });

  afterEach(cleanup);

  it('renders the eKYC review queue', () => {
    render(<EkycManagementPage />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<EkycManagementPage />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await expectNoCriticalAxeViolations(container);
  });

  it('opens the detail dialog when a queue row is viewed', async () => {
    render(<EkycManagementPage />);

    const detailDialog = await openDetailDialog();

    expect(within(detailDialog).getByText('EKYC-0007')).toBeTruthy();
    expect(within(detailDialog).getByText('Amina Yusof')).toBeTruthy();
    expect(within(detailDialog).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(detailDialog).getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('approves with the self-checkin flag and expected_version', async () => {
    render(<EkycManagementPage />);
    const detailDialog = await openDetailDialog();

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Approve' }));
    const actionDialog = await lastDialog();

    // The flag defaults to enabled for approvals; turning it off proves the
    // checkbox is what feeds payload.self_checkin_enabled.
    fireEvent.click(within(actionDialog).getByLabelText('Enable self check-in'));
    fireEvent.click(within(actionDialog).getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(mocks.reviewAction.mutateAsync).toHaveBeenCalledWith({
        applicationId: 7,
        payload: expect.objectContaining({
          action: 'approve',
          expected_version: 3,
          self_checkin_enabled: false,
          idempotency_key: expect.any(String),
        }),
      }),
    );
  });

  it('reject sends the chosen reason_code and reason text', async () => {
    mocks.reasonCodes.data = [reasonCodeFixture()];
    render(<EkycManagementPage />);
    const detailDialog = await openDetailDialog();

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Reject' }));
    const actionDialog = await lastDialog();

    fireEvent.mouseDown(within(actionDialog).getByLabelText(/Reason Code/));
    fireEvent.click(await screen.findByRole('option', { name: 'Document unreadable' }));
    fireEvent.change(within(actionDialog).getByLabelText('Reason'), {
      target: { value: 'Photo too dark' },
    });
    fireEvent.click(within(actionDialog).getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(mocks.reviewAction.mutateAsync).toHaveBeenCalledWith({
        applicationId: 7,
        payload: expect.objectContaining({
          action: 'reject',
          expected_version: 3,
          reason_code: 'DOC_UNREADABLE',
          reason: 'Photo too dark',
        }),
      }),
    );
  });

  it('surfaces a failed review action as an alert', async () => {
    mocks.reviewAction.mutateAsync.mockRejectedValueOnce(new Error('version conflict'));
    render(<EkycManagementPage />);
    const detailDialog = await openDetailDialog();

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Approve' }));
    const actionDialog = await lastDialog();
    fireEvent.click(within(actionDialog).getByRole('button', { name: 'Submit' }));

    // The page-level Alert renders while the action dialog stays open (so the
    // reviewer can retry); the open Modal aria-hides the rest of the page, so
    // the alert is not reachable by role — assert on its rendered text instead.
    const alertText = await screen.findByText('version conflict');
    expect(alertText.closest('[role="alert"]')).toBeTruthy();
  });

  it('reveals a sensitive field with the audit reason', async () => {
    render(<EkycManagementPage />);
    const detailDialog = await openDetailDialog();

    fireEvent.click(within(detailDialog).getByRole('button', { name: 'Reveal' }));
    const revealDialog = await lastDialog();

    fireEvent.change(within(revealDialog).getByLabelText('Reason'), {
      target: { value: 'Audit trail check' },
    });
    fireEvent.click(within(revealDialog).getByRole('button', { name: 'Reveal' }));

    await waitFor(() =>
      expect(mocks.reveal.mutateAsync).toHaveBeenCalledWith({
        applicationId: 7,
        field: 'id_number',
        reason: 'Audit trail check',
      }),
    );
    expect(await within(revealDialog).findByDisplayValue('A12345678')).toBeTruthy();
  });
});
