// Local tangent-plane projection used by every geo-registered thing in the
// scene (brief §4.1): 1 unit = 1 m, Y up, map north = −Z, east = +X, origin at
// the centre of the Farley ring.
export const LAT0 = 2.2655;
export const LON0 = 111.8625;

const M_PER_DEG_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_DEG_LAT = 110_574;

export interface XZ {
  x: number;
  z: number;
}

export function project(lat: number, lon: number): XZ {
  return { x: (lon - LON0) * M_PER_DEG_LON, z: -(lat - LAT0) * M_PER_DEG_LAT };
}

export function unproject(x: number, z: number): { lat: number; lon: number } {
  return { lat: LAT0 - z / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON };
}

/** Compass bearing (deg, clockwise from north) → unit vector on the XZ plane. */
export function bearingToXZ(deg: number): XZ {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** Unit XZ direction → compass bearing in degrees [0, 360). */
export function xzToBearing(x: number, z: number): number {
  const b = (Math.atan2(x, -z) * 180) / Math.PI;
  return (b + 360) % 360;
}
