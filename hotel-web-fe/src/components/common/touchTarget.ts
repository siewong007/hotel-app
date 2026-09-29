/** Minimum touch target (WCAG 2.5.8 / platform guidelines), in px. */
export const TOUCH_TARGET_PX = 44;

/**
 * Grows an icon button's *hit area* to 44x44 on touch devices without
 * changing how it looks: an invisible, centred `::after` catches taps that
 * land just outside a dense 24-40px control (room tile "More", room-type card
 * actions). Mouse users keep the compact layout; phones and touch tablets get
 * a target a thumb can hit. MUI's ButtonBase is already `position: relative`.
 *
 * Spread into the button's `sx`: `sx={{ ...COARSE_HIT_AREA_SX, width: 24 }}`.
 */
export const COARSE_HIT_AREA_SX = {
  '@media (pointer: coarse)': {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: TOUCH_TARGET_PX,
      height: TOUCH_TARGET_PX,
      transform: 'translate(-50%, -50%)',
    },
  },
} as const;
