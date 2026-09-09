import { useCallback, useMemo, useState } from 'react';
import {
  CONSENT_DOCUMENT_VERSIONS,
  type ConsentPrompt,
  type LegalDocumentId,
  type LegalLocale,
} from './content';

/**
 * One consent decision in the shape the API expects. Mirrors
 * `ConsentAcceptance` in `hotel-app-be/src/modules/consent/models.rs`.
 */
export interface ConsentAcceptance {
  document: Exclude<LegalDocumentId, 'marketing'>;
  version: string;
  granted: boolean;
  locale: LegalLocale;
}

export interface ConsentPayload {
  consents: ConsentAcceptance[];
  /**
   * Marketing is sent separately, not as a consent record: the backend routes
   * it to the notification consent ledger which owns the unsubscribe link.
   */
  marketing_opt_in: boolean;
}

export interface ConsentState {
  /** Which boxes are ticked, keyed by document. */
  checked: Record<string, boolean>;
  toggle: (documentId: LegalDocumentId, value: boolean) => void;
  /** True once every `required` prompt is ticked. */
  allRequiredGranted: boolean;
  /** Required prompts still unticked — used to highlight them after a failed submit. */
  missing: LegalDocumentId[];
  /** Set when the user submits with something missing, so errors appear on submit rather than while typing. */
  showErrors: boolean;
  setShowErrors: (value: boolean) => void;
  /** Request body fragment. Records refusals too, so a declined optional box is evidenced. */
  buildPayload: (locale: LegalLocale) => ConsentPayload;
}

/**
 * Drives a consent block.
 *
 * No box starts ticked. Under PDPA consent must be a positive act, so a
 * pre-ticked box is not consent at all — this hook has no initial-value
 * parameter precisely so a caller cannot introduce one by accident.
 */
export function useConsent(prompts: ConsentPrompt[]): ConsentState {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [showErrors, setShowErrors] = useState(false);

  const toggle = useCallback((documentId: LegalDocumentId, value: boolean) => {
    setChecked((current) => ({ ...current, [documentId]: value }));
  }, []);

  const missing = useMemo(
    () =>
      prompts
        .filter((prompt) => prompt.required && !checked[prompt.documentId])
        .map((prompt) => prompt.documentId),
    [prompts, checked],
  );

  const buildPayload = useCallback(
    (locale: LegalLocale): ConsentPayload => {
      const consents: ConsentAcceptance[] = [];
      let marketingOptIn = false;

      for (const prompt of prompts) {
        const granted = Boolean(checked[prompt.documentId]);
        if (prompt.documentId === 'marketing') {
          marketingOptIn = granted;
          continue;
        }
        consents.push({
          document: prompt.documentId,
          version: CONSENT_DOCUMENT_VERSIONS[prompt.documentId],
          granted,
          locale,
        });
      }

      return { consents, marketing_opt_in: marketingOptIn };
    },
    [prompts, checked],
  );

  return {
    checked,
    toggle,
    allRequiredGranted: missing.length === 0,
    missing,
    showErrors,
    setShowErrors,
    buildPayload,
  };
}
