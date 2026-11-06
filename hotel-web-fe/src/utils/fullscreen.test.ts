import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exitDocumentFullscreen,
  getFullscreenElement,
  isDocumentFullscreenSupported,
  requestDocumentFullscreen,
  subscribeFullscreenChange,
} from './fullscreen';

describe('fullscreen helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Drop any stubs we hung on document / documentElement.
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    Reflect.deleteProperty(document.documentElement, 'webkitRequestFullscreen');
    Reflect.deleteProperty(document, 'exitFullscreen');
    Reflect.deleteProperty(document, 'webkitExitFullscreen');
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'webkitFullscreenElement');
  });

  it('reports unsupported when neither requestFullscreen variant exists', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: undefined,
    });
    expect(isDocumentFullscreenSupported()).toBe(false);
  });

  it('reports supported for the standard requestFullscreen', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    expect(isDocumentFullscreenSupported()).toBe(true);
  });

  it('reports supported for the webkit prefix', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: vi.fn(),
    });
    expect(isDocumentFullscreenSupported()).toBe(true);
  });

  it('requestDocumentFullscreen prefers the standard API', async () => {
    const standard = vi.fn(async () => undefined);
    const webkit = vi.fn();
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: standard,
    });
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: webkit,
    });
    await requestDocumentFullscreen();
    expect(standard).toHaveBeenCalledTimes(1);
    expect(webkit).not.toHaveBeenCalled();
  });

  it('exitDocumentFullscreen falls back to webkitExitFullscreen', async () => {
    const webkit = vi.fn();
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'webkitExitFullscreen', {
      configurable: true,
      value: webkit,
    });
    await exitDocumentFullscreen();
    expect(webkit).toHaveBeenCalledTimes(1);
  });

  it('getFullscreenElement reads webkitFullscreenElement when standard is empty', () => {
    const el = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    Object.defineProperty(document, 'webkitFullscreenElement', {
      configurable: true,
      value: el,
    });
    expect(getFullscreenElement()).toBe(el);
  });

  it('subscribeFullscreenChange listens to both event names', () => {
    const handler = vi.fn();
    const unsub = subscribeFullscreenChange(handler);
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(handler).toHaveBeenCalledTimes(2);
    unsub();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
