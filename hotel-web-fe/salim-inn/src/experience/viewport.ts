// The film's viewport. On a phone the browser's toolbars collapse and come
// back as the visitor scrolls (iOS Safari above all), and each time
// innerHeight changes and a resize event fires — several times a scroll.
// Resizing the canvas then reallocates the WebGL drawing buffer and every
// render target of the post chain, and re-laying out the chapters moves the
// film's scroll length under the visitor's finger: a stall of 100 ms or more
// in the middle of a swipe, with a jump in the camera after it. The canvas is
// CSS 100lvh (the largest viewport), so on touch screens the film keeps the
// tallest height seen at the current width; a new width (rotation, a split
// view) starts over.
import { isMobileLike } from './Renderer';

let width = 0;
let height = 0;

export function filmViewport(): { w: number; h: number } {
  const w = Math.max(1, Math.floor(innerWidth));
  const h = Math.max(1, Math.floor(innerHeight));
  if (!isMobileLike() || w !== width) {
    width = w;
    height = h;
  } else height = Math.max(height, h);
  return { w: width, h: height };
}

/** test hook */
export function resetFilmViewport(): void {
  width = height = 0;
}
