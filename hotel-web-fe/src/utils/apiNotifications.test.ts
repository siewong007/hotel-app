import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetLocaleStoreForTests, setActiveLocale } from '../i18n/localeStore';
// Non-English bundles are lazy chunks (see src/i18n/resources/index.ts). The app
// awaits them at boot; a test that asserts translated copy must do the same, or
// it reads the English fallback and fails on a difference that is not a bug.
import { ensureLocaleLoaded } from '../i18n/resources';
import { getApiNotificationMessage, getNotificationPriority } from './apiNotifications';

afterEach(() => {
  resetLocaleStoreForTests();
});

beforeAll(async () => {
  await ensureLocaleLoaded('zh');
});

describe('notification priority', () => {
  it('treats informational and successful messages as info priority', () => {
    expect(getNotificationPriority('info')).toBe('info');
    expect(getNotificationPriority('success')).toBe('info');
  });

  it('treats validation warnings as warning priority', () => {
    expect(getNotificationPriority('warning')).toBe('warning');
  });

  it('treats errors as critical priority', () => {
    expect(getNotificationPriority('error')).toBe('critical');
  });
});

describe('getApiNotificationMessage', () => {
  it('maps a coded payload to the localized string for the active locale', () => {
    setActiveLocale('zh');
    const payload = { error: 'Guest nickname is already taken', code: 'guest_name_taken' };
    expect(getApiNotificationMessage(payload, 409)).toBe('该昵称已被使用，请更换。');
  });

  it('maps every backend code, including profile_incomplete, through the bundle', () => {
    setActiveLocale('zh');
    expect(
      getApiNotificationMessage({ error: 'Profile incomplete', code: 'profile_incomplete' }, 403)
    ).toBe('请完善您的个人资料后继续。');
    expect(
      getApiNotificationMessage(
        { error: 'Enrollment required', code: 'two_factor_enrollment_required' },
        403
      )
    ).toBe('您的角色要求启用双重身份验证，请完成设置后继续。');
  });

  it('keeps the server error text when the code is unknown to the bundle', () => {
    setActiveLocale('zh');
    const payload = { error: 'Upstream rejected the booking window', code: 'some_future_code' };
    expect(getApiNotificationMessage(payload, 400)).toBe('Upstream rejected the booking window');
  });

  it('falls back to a localized status generic when the body has neither code nor text', () => {
    setActiveLocale('zh');
    expect(getApiNotificationMessage({}, 500)).toBe('服务器出现问题，请稍后重试。');
    expect(getApiNotificationMessage({}, 404)).toBe('未找到所请求的内容。');
    expect(getApiNotificationMessage({}, 429)).toBe('请求过于频繁，请稍后重试。');
    expect(getApiNotificationMessage({}, 400)).toBe('请求失败。');
  });

  it('still prefers explicit server text over the generic for uncoded bodies', () => {
    setActiveLocale('zh');
    expect(getApiNotificationMessage({ error: 'Room 12 is occupied' }, 409)).toBe(
      'Room 12 is occupied'
    );
    expect(getApiNotificationMessage({ message: 'Check-in too early' }, 400)).toBe(
      'Check-in too early'
    );
  });

  it('returns the same English strings under the default locale', () => {
    expect(
      getApiNotificationMessage({ error: 'Taken', code: 'guest_name_taken' }, 409)
    ).toBe('That nickname is already taken. Please choose another.');
    expect(getApiNotificationMessage({ error: 'Nope' }, 400)).toBe('Nope');
    expect(getApiNotificationMessage({}, 500)).toBe(
      'A server error occurred. Please try again later.'
    );
    expect(getApiNotificationMessage({}, 404)).toBe('The requested item could not be found.');
    expect(getApiNotificationMessage({}, 429)).toBe(
      'Too many requests. Please try again shortly.'
    );
    expect(getApiNotificationMessage({}, 418)).toBe('Request failed.');
  });
});
