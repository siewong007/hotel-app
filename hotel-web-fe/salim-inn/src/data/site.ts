// Typed access to src/data/site.json — the OpenStreetMap extract converted to
// local metres by scripts/build-site-data.mjs. Point lists are flat
// [x0, z0, x1, z1, …] arrays to keep the payload small.
import raw from './site.json';

export interface Road {
  id: number;
  c: string; // highway class
  w: number; // carriageway width (m)
  o: 0 | 1; // one-way
  s?: string; // service=*
  n?: string;
  b?: 1; // bridge
  p: number[];
}
export interface WaterPoly {
  k: string;
  n?: string;
  rings: number[][];
}
export interface Waterway {
  k: string;
  w: number;
  p: number[];
}
export interface LandPoly {
  k: string;
  n?: string;
  p: number[];
}
export interface OsmBuilding {
  id: number;
  k: string;
  lv?: number;
  h?: number;
  n?: string;
  p: number[];
}
export interface Poi {
  k: string;
  n?: string;
  x: number;
  z: number;
}
export interface SiteData {
  origin: { lat: number; lon: number };
  attribution: string;
  osmBase: string;
  extent: number;
  roads: Road[];
  water: WaterPoly[];
  waterways: Waterway[];
  land: LandPoly[];
  buildings: OsmBuilding[];
  pois: Poi[];
}

export const site = raw as unknown as SiteData;

export type Pt = [number, number];

export function pts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** OSM way ids of the four Farley ring buildings (building=retail). */
export const FARLEY_IDS = {
  nwBlock: 269472228,
  nwBar: 269472230,
  seBlock: 269472227,
  seBar: 269472229,
} as const;

export function buildingById(id: number): OsmBuilding {
  const b = site.buildings.find((x) => x.id === id);
  if (!b) throw new Error(`OSM building ${id} missing from site.json`);
  return b;
}
