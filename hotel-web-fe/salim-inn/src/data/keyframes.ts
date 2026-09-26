// Earth Studio keyframes (salim_inn_google_earth_animation_pack) converted to
// local metres and re-aimed at the surveyed hotel block.
//
// What changed vs the pack, and why (listed in the README):
// • The pack targets 2.266 N, 111.8619 E — the publicly listed point, ~95 m
//   south-west of the real building. Keyframes 0–5 keep their shape but are
//   translated by (true hotel − listed target) so the flight is centred on
//   the right block; at 280–1,800 m altitude the shift is imperceptible.
// • The pack's heading/tilt values do not converge on its own target (e.g.
//   KF2's view ray lands ~300 m away), because Earth Studio re-aims at the
//   target anyway. We do the same: every "Salim Inn" keyframe looks at the
//   hotel block; the two "Farley commercial area" keyframes look at the ring.
// • Keyframes 6–9 (lock-on, reveal, half-orbit, hero): their bearings are
//   re-spaced into one monotonic orbit (WSW → W → NW → NNW) ending on the
//   entrance side. The pack's W → N → W swing would finish square-on to the
//   side wall of the real block, with the SALIM INN roof sign edge-on.
// • The film compresses the pack's 58° → 31° FOV run (brief §6.4: ≤ 6° per
//   chapter), so chapter 3 flies at 47.5° → 44° where the pack used 38° → 31°.
//   To keep the pack's framing, each of those keyframes is pulled in along its
//   own view ray by tan(pack FOV / 2) / tan(film FOV / 2) — same bearing, same
//   look-down angle, the hotel the same size in frame. Altitudes therefore
//   come down with the distance (hero: 48 m → 35 m; listed in the README).
import * as THREE from 'three';
import raw from './earth-studio-keyframes.json';
import { project, xzToBearing, bearingToXZ } from './geo';
import { POINTS, RING_CENTRE } from '../world/layout';

export interface CamKey {
  label: string;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number; // vertical FOV, degrees (Earth Studio FOV)
  source: { lat: number; lon: number; alt: number; heading: number; tilt: number };
}

const listed = project(raw.camera_target.lat, raw.camera_target.lon);
const hotel = POINTS.hotelCentre;
const shift = new THREE.Vector2(hotel.x - listed.x, hotel.z - listed.z);

// Re-spaced orbit for KF6–9: bearing FROM the hotel TO the camera.
const ORBIT_BEARINGS = [247, 276, 308, 326];
/** The film's vertical FOV at KF6–9 (see cameraPath.ts). */
export const FILM_FOV_C3 = [47.5, 46, 45, 44];
/** Extra push-in on the hero keyframe beyond the framing match. */
const HERO_TIGHTEN = 0.9;

export const EXTERIOR_KEYS: CamKey[] = raw.keyframes.map((k, i) => {
  const src = { lat: k.camera_latitude, lon: k.camera_longitude, alt: k.altitude_m, heading: k.heading_deg, tilt: k.tilt_deg };
  const p = project(k.camera_latitude, k.camera_longitude);
  const lookAtRing = k.target !== 'Salim Inn';
  const target = lookAtRing ? RING_CENTRE.clone().setY(0) : hotel.clone();
  let pos: THREE.Vector3;
  if (i < 6) {
    pos = new THREE.Vector3(p.x + shift.x, k.altitude_m, p.z + shift.y);
  } else {
    // The pack's distance to its target, scaled so the hotel keeps its size
    // in frame at the film's wider FOV (both legs of the view ray scale).
    const j = i - 6;
    const tanRatio = Math.tan(THREE.MathUtils.degToRad(k.field_of_view_deg / 2)) / Math.tan(THREE.MathUtils.degToRad(FILM_FOV_C3[j] / 2));
    const s = tanRatio * (i === 9 ? HERO_TIGHTEN : 1);
    const d = Math.hypot(p.x - listed.x, p.z - listed.z) * s;
    const dir = bearingToXZ(ORBIT_BEARINGS[j]);
    pos = new THREE.Vector3(hotel.x + dir.x * d, hotel.y + (k.altitude_m - hotel.y) * s, hotel.z + dir.z * d);
  }
  return { label: k.shot, pos, target, fov: k.field_of_view_deg, source: src };
});

/** Bearing of each converted keyframe (for the debug overlay / README). */
export function describeKeys(): string[] {
  return EXTERIOR_KEYS.map((k) => {
    const dx = k.target.x - k.pos.x, dz = k.target.z - k.pos.z;
    const h = Math.hypot(dx, dz);
    const tilt = (Math.atan2(h, k.pos.y - k.target.y) * 180) / Math.PI;
    return `${k.label}: pos(${k.pos.x.toFixed(0)}, ${k.pos.y.toFixed(0)}, ${k.pos.z.toFixed(0)}) heading ${xzToBearing(dx, dz).toFixed(0)}° tilt ${tilt.toFixed(0)}° fov ${k.fov}`;
  });
}
