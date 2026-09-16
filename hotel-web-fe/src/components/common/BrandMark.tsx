import React from 'react';

export interface BrandMarkProps {
  /** Edge length in px — the mark is square. */
  size?: number;
  /** Purely visual use: hide from assistive tech (loaders carry their own
   *  status text). */
  decorative?: boolean;
  /** Accessible name when not decorative. */
  title?: string;
}

/**
 * The Salim Inn monogram — the same mark shipped as the app icon, favicon and
 * PWA icons (deep-green tile, gold roofline, ivory S, gold baseline) — rebuilt
 * as inline SVG so it renders with zero network requests. The tile keeps its
 * brand colors in both themes, exactly like the app icon does.
 *
 * `pathLength={1}` + the `hotel-mark__*` classes let LogoLoader run a stroke
 * draw-on entrance (`stroke-dasharray: 1`) without measuring geometry. With no
 * animation applied the mark renders statically, identical to the asset.
 */
const BrandMark: React.FC<BrandMarkProps> = ({
  size = 64,
  decorative = false,
  title = 'Salim Inn',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    role={decorative ? undefined : 'img'}
    aria-hidden={decorative || undefined}
    aria-label={decorative ? undefined : title}
    focusable="false"
    style={{ display: 'block' }}
  >
    <rect width="64" height="64" rx="15" fill="#0B211A" />
    <rect
      x="1.5"
      y="1.5"
      width="61"
      height="61"
      rx="13.5"
      fill="none"
      stroke="#D9B572"
      strokeWidth="3"
    />
    <path
      className="hotel-mark__roofline"
      pathLength={1}
      d="M13 27 32 13l19 14"
      fill="none"
      stroke="#D9B572"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      className="hotel-mark__s"
      pathLength={1}
      d="M42 28c0-6-20-6-20 1 0 8 20 4 20 13 0 8-20 8-20 1"
      fill="none"
      stroke="#FFFDF7"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <path
      className="hotel-mark__baseline"
      pathLength={1}
      d="M16 51h32"
      stroke="#D9B572"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

export default BrandMark;
