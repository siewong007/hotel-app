/**
 * Backdrop-blur (frosted glass) preference — a local device setting like the
 * theme-mode toggle. Published as `--hotel-glass-blur` / `--hotel-glass-alpha`
 * on `:root`; every frosted surface (filled toasts, dialog/drawer scrims, the
 * guest-portal bottom nav) consumes the vars, so one slider tunes the whole
 * app. `--hotel-glass-alpha` keeps frosted fills honest: at 0px surfaces go
 * fully opaque instead of staying translucent with nothing to blur.
 */

export const GLASS_BLUR_STORAGE_KEY = 'glassBlur';
export const DEFAULT_GLASS_BLUR_PX = 10;
export const MIN_GLASS_BLUR_PX = 0;
export const MAX_GLASS_BLUR_PX = 20;

/** Translucency of frosted fills while blur > 0 — matches the :root default. */
export const GLASS_FILL_ALPHA = '82%';
/** `--hotel-glass-blur` fallback baked into `cssVarDeclarations` / var() calls. */
export const DEFAULT_GLASS_BLUR_CSS = `${DEFAULT_GLASS_BLUR_PX}px`;

/**
 * Clamp any persisted/user input to a supported integer px value. Anything
 * unparseable falls back to the default so a corrupted store can't disable or
 * nuke every overlay.
 */
export const normalizeGlassBlur = (value: unknown): number => {
  // Number('')/Number('  ') coerce to 0 — a blank stored value would silently
  // disable every frosted surface, so reject empty strings before parsing.
  if (typeof value === 'string' && value.trim() === '') {
    return DEFAULT_GLASS_BLUR_PX;
  }
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return DEFAULT_GLASS_BLUR_PX;
  }
  return Math.min(
    MAX_GLASS_BLUR_PX,
    Math.max(MIN_GLASS_BLUR_PX, Math.round(parsed)),
  );
};

/** Push the preference onto :root as CSS vars consumed by theme + plain CSS. */
export const applyGlassBlur = (px: number): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const blur = normalizeGlassBlur(px);
  root.style.setProperty('--hotel-glass-blur', `${blur}px`);
  root.style.setProperty(
    '--hotel-glass-alpha',
    blur > 0 ? GLASS_FILL_ALPHA : '100%',
  );
};
