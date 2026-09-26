// Quality tiers (brief §8). Picked at start by detect-gpu, then only ever
// lowered at runtime by the FPS governor (never raised mid-session).

export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  dprCap: number;
  shadowMap: number; // 0 = baked contact shadows only
  ao: 'full' | 'half' | 'off';
  bloom: boolean;
  dof: boolean;
  smaa: boolean;
  farTrees: boolean;
  farDensity: number; // 0..1 share of procedural far-field houses kept
  glassTransmission: boolean;
}

export const TIERS: Record<TierName, Tier> = {
  high: { name: 'high', dprCap: 2, shadowMap: 2048, ao: 'full', bloom: true, dof: true, smaa: true, farTrees: true, farDensity: 1, glassTransmission: true },
  medium: { name: 'medium', dprCap: 1.5, shadowMap: 1024, ao: 'half', bloom: true, dof: false, smaa: true, farTrees: true, farDensity: 0.7, glassTransmission: false },
  low: { name: 'low', dprCap: 1, shadowMap: 0, ao: 'off', bloom: false, dof: false, smaa: true, farTrees: false, farDensity: 0.45, glassTransmission: false },
};

export const MOBILE_DPR_CAP = 1.5;

export const GOVERNOR = {
  windowSeconds: 2,
  dropBelowFps: 45,
  graceSeconds: 3, // ignore the first seconds after load / tier change
} as const;
