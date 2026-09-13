import { createHotelTheme, darkTokens } from '../../../theme';

/**
 * Guest-facing surfaces share the staff app's dark token system — one visual
 * identity across the product. `displaySerif` keeps the Georgia display
 * headings as the hospitality signature guests see.
 */
export const guestPortalTheme = createHotelTheme(darkTokens, {
  displaySerif: true,
});
