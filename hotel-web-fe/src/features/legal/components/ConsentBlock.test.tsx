import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';
import { REGISTRATION_CONSENTS } from '../content';
import { useLegalLocale } from '../LegalLocaleContext';
import { useConsent } from '../useConsent';
import { ConsentBlock } from './ConsentBlock';

afterEach(() => {
  cleanup();
  resetLocaleStoreForTests();
});

function Recorder() {
  const consent = useConsent(REGISTRATION_CONSENTS);
  const { locale } = useLegalLocale();
  return (
    <>
      <ConsentBlock prompts={REGISTRATION_CONSENTS} state={consent} />
      <button
        type="button"
        onClick={() => {
          const payload = consent.buildPayload(locale);
          document.getElementById('payload')!.textContent = JSON.stringify(payload);
        }}
      >
        record
      </button>
      <pre id="payload" data-testid="payload" />
    </>
  );
}

describe('ConsentBlock locale', () => {
  it('never pre-ticks a required box', () => {
    render(<Recorder />);
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
  });

  it('records the language the guest is reading, not a stale parent locale', () => {
    render(<Recorder />);

    fireEvent.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Terma dan Syarat Tempahan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Notis Privasi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'record' }));

    const payload = JSON.parse(screen.getByTestId('payload').textContent || '{}') as {
      consents: Array<{ locale: string; granted: boolean }>;
    };
    expect(payload.consents.every((entry) => entry.locale === 'ms')).toBe(true);
    expect(payload.consents.every((entry) => entry.granted)).toBe(true);
  });
});
