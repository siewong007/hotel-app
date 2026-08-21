import * as THREE from '../vendor/three.module.min.js';
import { ROUTE } from './plan.js';
import { clamp, smoother } from './core.js';

// The five stages, their copy and their scroll timings are unchanged. What
// changed is what they show: the sequence now starts at Farley's front door
// and walks the internal ring around the block to the Salim Inn frontage —
// the way a guest actually gets between the two — instead of flying straight
// across ground that is really a service road and a planted verge.
const INTERIOR_AT = 0.64;

const curve = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildPaths(salim, farley, interior) {
  const [nx, nz] = farley.normal;
  const [fdx, fdz] = farley.dir;
  const door = farley.door;

  // Stage 01 establishes the whole complex before the walk begins: high on the
  // north-west side, where Farley's frontage faces the camera and the hotel's
  // locator beam is visible 157 m away across the block.
  const openPos = V(-176, 172, -104);
  const midPos = V(door.x + nx * 96, 96, door.z + nz * 96 - 30);

  // Stage 03: the walk. Position follows the traced route; the target runs a
  // couple of points ahead so the camera looks where it is going, then settles
  // on the hotel frontage.
  // 3.4 m, not the 7.5 m this used to fly at. The reference walkthrough is
  // shot from a car roof, so the horizon sits across the middle of frame and
  // the shophouse fascias read at their real height. From 7.5 m the same
  // route pitched down into the tarmac and never showed the sky at all.
  const walkPos = [farley.doorStand.clone()];
  for (let i = 1; i < ROUTE.length; i++) {
    walkPos.push(V(ROUTE[i][0], 3.4, ROUTE[i][1]));
  }
  walkPos.push(salim.standWorld.clone());

  const walkTar = [];
  for (let i = 0; i < ROUTE.length; i++) {
    const j = Math.min(i + 2, ROUTE.length - 1);
    walkTar.push(V(ROUTE[j][0], 3.5, ROUTE[j][1]));
  }
  walkTar.push(salim.facadeTarget.clone());
  walkTar.push(salim.facadeTarget.clone());

  const paths = [
    {
      a: 0,
      b: 0.2,
      pos: curve([openPos, midPos, farley.viewWorld.clone()]),
      // Aim at the midpoint of the two buildings so both are in frame before
      // the camera commits to Farley.
      tar: curve([
        V(-59, 0, 39),
        farley.facadeWorld.clone().lerp(V(-59, 0, 39), 0.45),
        farley.facadeWorld.clone(),
      ]),
    },
    {
      // Down onto the frontage and in under the entrance canopy.
      a: 0.2,
      b: 0.42,
      pos: curve([
        farley.viewWorld.clone(),
        V(door.x + nx * 46 + fdx * -6, 12, door.z + nz * 46 + fdz * -6),
        V(door.x + nx * 34 + fdx * -11, 5.4, door.z + nz * 34 + fdz * -11),
        farley.doorStand.clone(),
      ]),
      tar: curve([
        farley.facadeWorld.clone(),
        farley.facadeWorld.clone(),
        farley.facadeWorld.clone(),
        farley.facadeWorld.clone(),
      ]),
    },
    {
      a: 0.42,
      b: INTERIOR_AT,
      pos: curve(walkPos),
      tar: curve(walkTar),
    },
  ];

  // Reception, stair rise, corridor and room entry share one continuous spline
  // so there is no velocity reset at the stage 04 -> 05 boundary.
  const interiorPos = curve([
    salim.standWorld.clone(),
    salim.doorWorld.clone(),
    interior.receptionWorld.clone().add(V(0.8, 0.2, -1.2)),
    interior.stairFootWorld.clone(),
    interior.stairTopWorld.clone(),
    interior.roomEntryWorld.clone(),
    interior.roomInsideWorld.clone().add(V(0.1, 0.1, -0.5)),
  ]);
  const interiorTar = curve([
    salim.facadeTarget.clone(),
    interior.receptionWorld.clone(),
    interior.receptionWorld.clone().add(V(-0.4, -0.1, 1.5)),
    interior.stairTopWorld.clone(),
    interior.roomEntryWorld.clone(),
    interior.roomInsideWorld.clone(),
    interior.bedTargetWorld.clone(),
  ]);

  function samplePath(p, key) {
    if (p >= INTERIOR_AT) {
      const u = smoother(clamp((p - INTERIOR_AT) / (1 - INTERIOR_AT), 0, 0.999));
      return (key === 'pos' ? interiorPos : interiorTar).getPoint(u);
    }
    const seg = paths.find((s) => p <= s.b) || paths[paths.length - 1];
    const u = smoother(clamp((p - seg.a) / (seg.b - seg.a), 0, 1));
    return seg[key].getPointAt(u);
  }

  return { samplePath, INTERIOR_AT };
}
