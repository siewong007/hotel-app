import { describe, expect, it } from 'vitest';
import { modelCodeFor, offerPhotos } from './roomMediaSources';

describe('room media', () => {
  it('prefers uploaded photos and keeps their order', () => {
    const { urls, uploaded } = offerPhotos({ room_type_code: 'DLX', images: ['https://cdn/x.jpg', ' ', 'https://cdn/y.jpg'] });
    expect(uploaded).toBe(true);
    expect(urls).toEqual(['https://cdn/x.jpg', 'https://cdn/y.jpg']);
  });
  it('falls back to the bundled landing photo by code', () => {
    expect(offerPhotos({ room_type_code: 'dlx', images: [] }).urls).toEqual(['/salim-inn/rooms/deluxe-king.jpg']);
    expect(offerPhotos({ room_type_code: 'STDQ', images: [] }).urls).toEqual(['/salim-inn/gallery/guest-room.jpg']);
    expect(offerPhotos({ room_type_code: 'PENT', images: [] }).urls).toEqual([]);
  });
  it('maps only the five modelled codes to the 3D room', () => {
    expect(modelCodeFor('FS')).toBe('FS');
    expect(modelCodeFor(' sup ')).toBe('SUP');
    expect(modelCodeFor('PENT')).toBeNull();
  });
});
