// Photo / 3D view for a room-type card on the Choose step.
import React, { Suspense, lazy, useRef, useState } from 'react';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HotelIcon from '@mui/icons-material/Hotel';
import { Box, CircularProgress, IconButton, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useTranslation } from '../../../i18n';
import type { GuestBookingOffer } from './types';
import { modelCodeFor, offerPhotos } from './roomMedia';

// three.js + the landing room only download when a guest taps 3D.
const RoomModel3D = lazy(() => import('./RoomModel3D'));

export const ROOM_MEDIA_HEIGHT = 200;
const FALLBACK = 'linear-gradient(135deg, var(--hotel-surface-raised) 0%, var(--hotel-surface-sunken) 55%, var(--hotel-primary) 160%)';

export function RoomMedia({ offer }: { offer: GuestBookingOffer }) {
  const { t } = useTranslation('guestPortal');
  const { urls, bundled } = offerPhotos(offer);
  const modelCode = modelCodeFor(offer.room_type_code);
  const [view, setView] = useState<'photo' | '3d'>('photo');
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const working = urls.filter((u) => !failed.has(u));
  // every uploaded photo broken: the bundled landing photo, then the placeholder
  const photos = working.length > 0 ? working : bundled && !failed.has(bundled) ? [bundled] : [];
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const current = Math.min(index, Math.max(0, photos.length - 1));

  const go = (next: number) => {
    const n = (next + photos.length) % photos.length;
    setIndex(n);
    const track = trackRef.current;
    track?.scrollTo?.({ left: n * track.clientWidth, behavior: 'smooth' });
  };
  const navSx = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, bgcolor: 'rgba(6,17,14,0.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(6,17,14,0.75)' } } as const;

  return (
    <Box sx={{ position: 'relative', height: ROOM_MEDIA_HEIGHT, overflow: 'hidden', bgcolor: 'var(--hotel-surface-raised)' }} data-testid="room-media">
      {view === '3d' && modelCode ? (
        <Suspense fallback={<Box sx={{ height: ROOM_MEDIA_HEIGHT, display: 'grid', placeItems: 'center', bgcolor: '#0f1714' }}><CircularProgress size={28} /></Box>}>
          <RoomModel3D code={modelCode} height={ROOM_MEDIA_HEIGHT} label={t('book.media.modelAlt', { name: offer.room_type_name })} hint={t('book.media.dragHint')} unsupported={t('book.media.noWebgl')} />
        </Suspense>
      ) : photos.length > 0 ? (
        <>
          <Box
            ref={trackRef}
            onScroll={(e) => { const el = e.currentTarget; if (el.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth)); }}
            sx={{ display: 'flex', height: '100%', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
          >
            {photos.map((src, i) => (
              <Box key={src} component="img" src={src} loading="lazy" alt={t('book.roomImageAlt', { name: offer.room_type_name }) + (photos.length > 1 ? ` (${i + 1}/${photos.length})` : '')}
                onError={() => setFailed((prev) => new Set(prev).add(src))}
                sx={{ flex: '0 0 100%', width: '100%', height: '100%', objectFit: 'cover', scrollSnapAlign: 'start', display: 'block' }} />
            ))}
          </Box>
          {photos.length > 1 && (
            <>
              <IconButton aria-label={t('book.media.previous')} onClick={() => go(current - 1)} sx={{ ...navSx, left: 6 }}><ChevronLeftIcon /></IconButton>
              <IconButton aria-label={t('book.media.next')} onClick={() => go(current + 1)} sx={{ ...navSx, right: 6 }}><ChevronRightIcon /></IconButton>
              <Box aria-hidden="true" sx={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 0.75 }}>
                {photos.map((src, i) => <Box key={src} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: i === current ? 'primary.main' : 'rgba(255,255,255,0.6)' }} />)}
              </Box>
            </>
          )}
        </>
      ) : (
        <Box aria-hidden="true" sx={{ height: '100%', background: FALLBACK, display: 'grid', placeItems: 'center', color: 'var(--hotel-text-secondary)' }}><HotelIcon sx={{ fontSize: 48 }} /></Box>
      )}
      {modelCode && (
        <ToggleButtonGroup
          exclusive size="small" value={view} aria-label={t('book.media.viewAria')}
          onChange={(_, v: 'photo' | '3d' | null) => { if (v) setView(v); }}
          sx={{
            position: 'absolute', top: 8, right: 8, borderRadius: 999, bgcolor: 'rgba(6,17,14,0.72)', backdropFilter: 'blur(8px)', p: '2px',
            '& .MuiToggleButton-root': { minHeight: 44, minWidth: 64, px: 1.75, border: 0, borderRadius: '999px !important', color: '#f3ede2', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'none' },
            '& .MuiToggleButton-root.Mui-selected, & .MuiToggleButton-root.Mui-selected:hover': { bgcolor: 'primary.main', color: 'primary.contrastText' },
          }}
        >
          <ToggleButton value="photo">{t('book.media.photo')}</ToggleButton>
          <ToggleButton value="3d">{t('book.media.model')}</ToggleButton>
        </ToggleButtonGroup>
      )}
    </Box>
  );
}
