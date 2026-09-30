// Quality tiers (brief §8). Picked at start by detect-gpu, then only ever
// lowered at runtime by the FPS governor (never raised mid-session).

export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  dprCap: number;
  shadowMap: number; // 0 = baked contact shadows only
  ao: 'full' | 'half' | 'off';
  /** Mip levels of the glow, 0 = off. Each is two small draws; the high
   *  tier keeps the widest three, the soft haze the bright bedding and the
   *  lamps throw over their surroundings (the M4 look). */
  bloom: number;
  dof: boolean;
  smaa: boolean;
  farTrees: boolean;
  farDensity: number; // 0..1 share of procedural far-field houses kept
  /** Trees' and cars' level-of-detail distances × this; below 1 the lamp
   *  posts and the shop rows' trim also drop out above 250 m (World). */
  lodScale: number;
  glassTransmission: boolean;
}

export const TIERS: Record<TierName, Tier> = {
  high: { name: 'high', dprCap: 2, shadowMap: 2048, ao: 'full', bloom: 8, dof: true, smaa: true, farTrees: true, farDensity: 1, lodScale: 1, glassTransmission: true },
  medium: { name: 'medium', dprCap: 1.5, shadowMap: 1024, ao: 'half', bloom: 5, dof: false, smaa: true, farTrees: true, farDensity: 0.7, lodScale: 0.6, glassTransmission: false },
  low: { name: 'low', dprCap: 1, shadowMap: 0, ao: 'off', bloom: 0, dof: false, smaa: true, farTrees: false, farDensity: 0.45, lodScale: 0.45, glassTransmission: false },
};

export const MOBILE_DPR_CAP = 1.5;

export const GOVERNOR = {
  windowSeconds: 2,
  dropBelowFps: 45,
  graceSeconds: 3, // ignore the first seconds after load / tier change
} as const;
