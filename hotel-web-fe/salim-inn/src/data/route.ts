// The owner's "flying line" (salim_inn_farley_route.geojson) in local metres.
// The pack's points are creative framing points, not surveyed roads: the
// opening leg runs from the pack's 1,800 m viewpoint, so it is flown as an
// arc above the city, descending to rooftop height as it enters the Farley
// ring and ending at the hotel entrance. Points that fall inside a building
// footprint are pushed to the nearest outside point (see RouteLine.ts).
import * as THREE from 'three';
import geo from './route.geojson?raw';
import { project } from './geo';
import { POINTS } from '../world/layout';

interface GeoJson {
  features: { geometry: { type: string; coordinates: number[][] | number[] } }[];
}

const data = JSON.parse(geo) as GeoJson;
const line = data.features.find((f) => f.geometry.type === 'LineString')!.geometry.coordinates as number[][];

const listed = project(2.266, 111.8619);
const shift = new THREE.Vector2(POINTS.hotelCentre.x - listed.x, POINTS.hotelCentre.z - listed.z);

/** Route points in local metres, shifted like the keyframes and drawn in
 *  towards the hotel so the loop runs round the neighbourhood itself (the
 *  pack's points trace the camera's own ground track 0.5–1.8 km out, which is
 *  mostly behind or below the camera while it flies). */
const PULL = 0.42;
export const ROUTE_POINTS: THREE.Vector3[] = line.map(([lon, lat]) => {
  const p = project(lat, lon);
  const v = new THREE.Vector3(p.x + shift.x, 0, p.z + shift.y);
  const h = POINTS.hotelCentre;
  return new THREE.Vector3(h.x + (v.x - h.x) * PULL, 0, h.z + (v.z - h.z) * PULL);
});

/** The last few pack points circle the listed target; the rendered line ends
 *  at the real entrance instead. */
export const ROUTE_END = POINTS.guestBay.clone();
