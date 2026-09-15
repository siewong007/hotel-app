import { HTTPError } from 'ky';
import { api, APIError, readErrorData, toApiError } from './client';
import type {
  CreateStaffSupportConversationRequest,
  FollowUpQueueParams,
  FollowUpQueueResponse,
  GuestCommunicationsSummary,
  GuestInteraction,
  GuestInteractionInput,
  GuestInteractionListParams,
  GuestInteractionListResponse,
  GuestInteractionUpdate,
  GuestLoyaltySummary,
  GuestPreference,
  GuestPreferencesPutRequest,
  GuestRelationsOverview,
  GuestReview,
  GuestReviewResponseInput,
  GuestSupportConversationDetail,
  GuestSupportConversationSummary,
  GuestVoucher,
} from '../types';
import { withRetry } from '../utils/retry';
import { t } from '../i18n';

const notifyUnauthorized = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('auth:unauthorized'));
};

// Mirrors GuestsService.toGuestApiError: 401 gets a dedicated session-expired
// message + logout notification; everything else (including already-wrapped
// APIErrors, which toApiError passes through) uses the shared mapper.
const toGuestRelationsApiError = async (error: unknown, fallback: string): Promise<APIError> => {
  if (error instanceof HTTPError && error.response.status === 401) {
    notifyUnauthorized();
    return new APIError(t('errors.sessionExpired', undefined, 'auth'), error.response.status, readErrorData(error));
  }

  return toApiError(error, fallback);
};

/**
 * Guest Relations workspace endpoints — all scoped under `/guests/{id}`
 * (see hotel-app-be/src/modules/guest_relations/routes.rs) plus the staff-side
 * `POST /support/conversations` creation route.
 */
export class GuestRelationsService {
  // ------------------------------------------------------------------
  // Interactions (guest_notes)
  // ------------------------------------------------------------------

  static async getInteractions(
    guestId: number | string,
    params: GuestInteractionListParams = {},
  ): Promise<GuestInteractionListResponse> {
    const searchParams: Record<string, any> = {};
    if (params.page != null) searchParams.page = params.page;
    if (params.page_size != null) searchParams.page_size = params.page_size;
    if (params.include_completed_followups != null) {
      searchParams.include_completed_followups = String(params.include_completed_followups);
    }

    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/interactions`, { searchParams }).json<GuestInteractionListResponse>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestInteractions'));
    }
  }

  static async createInteraction(
    guestId: number | string,
    data: GuestInteractionInput,
  ): Promise<GuestInteraction> {
    try {
      // No retry: the create is not idempotent and a lost response would
      // double-file the note.
      return await api
        .post(`guests/${guestId}/interactions`, { json: data })
        .json<GuestInteraction>();
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.createGuestInteraction'));
    }
  }

  static async updateInteraction(
    guestId: number | string,
    interactionId: number,
    data: GuestInteractionUpdate,
  ): Promise<GuestInteraction> {
    try {
      return await api
        .patch(`guests/${guestId}/interactions/${interactionId}`, { json: data })
        .json<GuestInteraction>();
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.updateGuestInteraction'));
    }
  }

  static async deleteInteraction(
    guestId: number | string,
    interactionId: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await api
        .delete(`guests/${guestId}/interactions/${interactionId}`)
        .json<{ success: boolean; message: string }>();
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.deleteGuestInteraction'));
    }
  }

  // ------------------------------------------------------------------
  // Preferences (guest_preferences)
  // ------------------------------------------------------------------

  static async getPreferences(guestId: number | string): Promise<GuestPreference[]> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/preferences`).json<GuestPreference[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestPreferences'));
    }
  }

  /** Returns the full updated preference list. */
  static async putPreferences(
    guestId: number | string,
    data: GuestPreferencesPutRequest,
  ): Promise<GuestPreference[]> {
    try {
      return await api
        .put(`guests/${guestId}/preferences`, { json: data })
        .json<GuestPreference[]>();
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.updateGuestPreferences'));
    }
  }

  // ------------------------------------------------------------------
  // Reviews (guest_reviews)
  // ------------------------------------------------------------------

  static async getReviews(guestId: number | string): Promise<GuestReview[]> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/reviews`).json<GuestReview[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestReviews'));
    }
  }

  static async respondToReview(
    guestId: number | string,
    reviewId: number,
    data: GuestReviewResponseInput,
  ): Promise<GuestReview> {
    try {
      return await api
        .post(`guests/${guestId}/reviews/${reviewId}/response`, { json: data })
        .json<GuestReview>();
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.respondToGuestReview'));
    }
  }

  // ------------------------------------------------------------------
  // Loyalty / vouchers / communications / support (read-only joins)
  // ------------------------------------------------------------------

  /** 200 + `null` when the guest has no loyalty membership. */
  static async getLoyalty(guestId: number | string): Promise<GuestLoyaltySummary | null> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/loyalty`).json<GuestLoyaltySummary | null>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestLoyaltySummary'));
    }
  }

  static async getVouchers(guestId: number | string): Promise<GuestVoucher[]> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/vouchers`).json<GuestVoucher[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestVouchers'));
    }
  }

  static async getCommunications(guestId: number | string): Promise<GuestCommunicationsSummary> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/communications`).json<GuestCommunicationsSummary>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestCommunicationsSummary'));
    }
  }

  static async getSupportConversations(
    guestId: number | string,
  ): Promise<GuestSupportConversationSummary[]> {
    try {
      return await withRetry(
        () => api.get(`guests/${guestId}/support`).json<GuestSupportConversationSummary[]>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestSupportConversations'));
    }
  }

  /**
   * Staff-side support conversation creation — `POST /support/conversations`
   * (files a conversation on the guest's behalf; lands in the staff queue as
   * `waiting_for_staff`). Returns the staff conversation detail.
   */
  static async createSupportConversation(
    data: CreateStaffSupportConversationRequest,
  ): Promise<GuestSupportConversationDetail> {
    try {
      return await api
        .post('support/conversations', { json: data })
        .json<GuestSupportConversationDetail>();
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.createSupportConversation'));
    }
  }

  // ------------------------------------------------------------------
  // Phase 2 — cross-guest operational layer (not guest-scoped)
  // ------------------------------------------------------------------

  /**
   * `GET /guest-relations/overview` — dashboard aggregate. `support` /
   * `reviews` sections are absent unless the caller holds those read
   * permissions; the other sections always come back.
   */
  static async getOverview(): Promise<GuestRelationsOverview> {
    try {
      return await withRetry(
        () => api.get('guest-relations/overview').json<GuestRelationsOverview>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchGuestRelationsOverview'));
    }
  }

  /**
   * `GET /guest-relations/follow-ups` — paginated open follow-up queue.
   * `due` is sent only when set (the backend defaults to `all`).
   */
  static async listFollowUps(
    params: FollowUpQueueParams = {},
  ): Promise<FollowUpQueueResponse> {
    const searchParams: Record<string, any> = {};
    if (params.due != null) searchParams.due = params.due;
    if (params.page != null) searchParams.page = params.page;
    if (params.page_size != null) searchParams.page_size = params.page_size;

    try {
      return await withRetry(
        () => api.get('guest-relations/follow-ups', { searchParams }).json<FollowUpQueueResponse>(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      throw await toGuestRelationsApiError(error, t('errors:request.fetchFollowUpQueue'));
    }
  }
}
