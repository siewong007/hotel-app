// Room-type media for the portal's Choose step: which photos a card shows and
// whether the 3D model (the landing's configurator room) covers the type.
import { apiUrl } from '../../../desktop/runtimeApi';
import type { GuestBookingOffer } from './types';

/** Room-type codes the landing's three.js room is laid out for
 *  (salim-inn/src/interiors/roomLayouts.ts). */
export const MODEL_CODES = ['STDQ', 'DLX', 'SUP', 'FR', 'FS'] as const;
export type ModelCode = (typeof MODEL_CODES)[number];

/** The landing's bundled photos, used until staff upload real ones in Room
 *  configuration. STDQ has no photo of its own; the generic guest room stands
 *  in (as on the landing). */
const BUNDLED_PHOTOS: Record<ModelCode, string> = {
  STDQ: '/salim-inn/gallery/guest-room.jpg',
  DLX: '/salim-inn/rooms/deluxe-king.jpg',
  SUP: '/salim-inn/rooms/superior-twin.jpg',
  FR: '/salim-inn/rooms/family-room.jpg',
  FS: '/salim-inn/rooms/family-suite.jpg',
};

export function modelCodeFor(code: string | null | undefined): ModelCode | null {
  const c = String(code ?? '').trim().toUpperCase();
  return (MODEL_CODES as readonly string[]).includes(c) ? (c as ModelCode) : null;
}

/** Uploaded photos first (relative /uploads paths resolve against the API —
 *  the desktop sidecar in the webview); else the bundled landing photo. */
export function offerPhotos(offer: Pick<GuestBookingOffer, 'images' | 'room_type_code'>): { urls: string[]; uploaded: boolean; bundled: string | null } {
  const uploaded = (offer.images ?? [])
    .filter((image): image is string => typeof image === 'string' && image.trim().length > 0)
    .map((raw) => (raw.startsWith('/') ? apiUrl(raw) : raw));
  const code = modelCodeFor(offer.room_type_code);
  const bundled = code ? BUNDLED_PHOTOS[code] : null;
  if (uploaded.length > 0) return { urls: uploaded, uploaded: true, bundled };
  return { urls: bundled ? [bundled] : [], uploaded: false, bundled };
}
