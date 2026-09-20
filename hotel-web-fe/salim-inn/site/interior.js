import * as THREE from '../vendor/three.module.min.js';
import { mat, box, spriteLabel, canvasPlane, rand, GROUND_STOREY } from './core.js';

// Ground-floor reception and the Deluxe 6001 room above it. The design is
// unchanged from the previous build — timber floor, cream shell, gold desk
// trim, queen bed with a pale headboard, navy curtains — but every dimension
// was previously derived from lotW, which was 2.4 m when a shophouse lot is
// really 6 m. Sizes are now stated in metres directly so the room stops
// inheriting the plan's scale error.
const REC_W = 5.6;
const REC_D = 12;
const REC_H = 3.3;
const ROOM_W = 3.8;
const ROOM_D = 6.4;
const ROOM_H = 2.75;

// ---------------------------------------------------------------------------
// Room-surface helpers. The room is rebuilt against Salim Inn's own guest-room
// photographs: peach walls, dark-brown floor tiles, a sliding window with
// drawn navy curtains, a laminate desk + mirror + TV + wall AC down the left
// wall, the bed on the back wall and a compact bathroom pod beside the entry.

// Tiled surface painted once into a canvas — the same technique the sky and
// standing-seam roofs already use. `w`/`h` are the surface size in metres so
// the tiles land at real-world pitch; `tw`/`th` are the tile size. Per-tile
// value jitter uses the seeded rand() so the scene stays deterministic.
function tileTexture({ w, h, tw, th, base, grout, stagger = false, seed = 1 }) {
  const px = 512;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.max(4, Math.round((px * h) / w));
  const ctx = c.getContext('2d');
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, c.width, c.height);
  const nx = Math.max(1, Math.round(w / tw));
  const ny = Math.max(1, Math.round(h / th));
  const sx = c.width / nx;
  const sy = c.height / ny;
  const g = Math.max(1.2, Math.min(sx, sy) * 0.045);
  const col = new THREE.Color(base);
  for (let r = 0; r <= ny; r++) {
    for (let q = -1; q <= nx; q++) {
      const off = stagger && r % 2 ? sx / 2 : 0;
      const cc = col.clone().multiplyScalar(0.93 + rand(seed + r * 13.7 + q * 7.1) * 0.14);
      ctx.fillStyle = `#${cc.getHexString()}`;
      ctx.fillRect(q * sx + off + g / 2, r * sy + g / 2, sx - g, sy - g);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// A hanging curtain panel: a plane displaced in z by sine folds, slightly
// looser at the hem so it reads as fabric rather than a corrugated board.
function curtainGeo(w, h, folds, amp) {
  const g = new THREE.PlaneGeometry(w, h, Math.max(24, folds * 8), 4);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const v = pos.getY(i) / h + 0.5; // 0 hem -> 1 rod
    const flare = 1.3 - v * 0.55;
    pos.setZ(i, Math.sin((x / w + 0.5) * Math.PI * folds * 2) * amp * flare);
  }
  g.computeVertexNormals();
  return g;
}

export function buildInterior(salim) {
  const { group: salimGroup, hotel } = salim;

  const interior = new THREE.Group();
  // Sits in the hotel bay and turns with the frontage, so local +z runs into
  // the building and local -z faces the street. The row bends, so the interior
  // has to inherit the local bearing rather than the block's.
  interior.position.set(hotel.x + hotel.dx * 1.4, 0, hotel.z + hotel.dz * 1.4);
  interior.rotation.y = hotel.ry;
  salimGroup.add(interior);

  const interiorMeshes = [];
  const roomMeshes = [];

  const wall = mat(0xdad8cf, 0.92, 0, { side: THREE.DoubleSide });
  const floorMat = mat(0x77543c, 0.9);
  const wood = mat(0x684b35, 0.86);
  const gold = mat(0xd6b06d, 0.45, 0.18);
  const green = mat(0x314e3d, 0.85);

  const ibox = (x, y, z, w, h, d, m) => {
    const q = box(interior, x, y, z, w, h, d, m.clone());
    q.material.transparent = true;
    q.material.opacity = 0;
    interiorMeshes.push(q);
    return q;
  };

  // Reception runs back from the entrance doors into the shophouse. Depths are
  // measured inward from the frontage line at local z = 0.
  const recZ = REC_D / 2 + 0.6;
  ibox(0, 0.05, recZ, REC_W, 0.1, REC_D, floorMat);
  ibox(-REC_W / 2, REC_H / 2, recZ, 0.1, REC_H, REC_D, wall);
  ibox(REC_W / 2, REC_H / 2, recZ, 0.1, REC_H, REC_D, wall);
  ibox(0, REC_H / 2, recZ + REC_D / 2, REC_W, REC_H, 0.1, wall);
  ibox(0, REC_H, recZ, REC_W, 0.1, REC_D, wall);

  ibox(-0.5, 0.55, recZ - 2.2, 3.1, 1.1, 0.75, wood);
  ibox(-0.5, 1.14, recZ - 2.2, 3.0, 0.08, 0.68, gold);
  ibox(REC_W * 0.34, 0.45, recZ - 3.6, 0.6, 0.9, 0.9, green);
  ibox(REC_W * 0.32, 1.5, recZ + 1.4, 0.7, 2.0, 0.06, green);

  const recSign = spriteLabel('RECEPTION', true, 3.2);
  recSign.position.set(-0.4, 2.5, recZ + REC_D / 2 - 0.1);
  recSign.material.opacity = 0;
  interior.add(recSign);

  const lobbyLight = new THREE.PointLight(0xffd39a, 12, 20, 2);
  lobbyLight.position.set(-0.4, 2.8, recZ - 1.5);
  interior.add(lobbyLight);

  // ======================= Deluxe 6001 ======================================
  const roomGroup = new THREE.Group();
  roomGroup.name = 'salim-room';
  roomGroup.position.set(0, GROUND_STOREY, 0);
  interior.add(roomGroup);
  const roomZ = ROOM_D / 2 + 1.4; // 4.6 — interior z spans [1.45, 7.75]

  // Everything in the room shares the roomReveal opacity ramp. Materials are
  // shared rather than cloned — setOpacity writes the same value to each.
  const rtrack = (q, cast = true) => {
    q.castShadow = cast;
    q.receiveShadow = true;
    const mats = Array.isArray(q.material) ? q.material : [q.material];
    for (const m of mats) { m.transparent = true; m.opacity = 0; }
    roomMeshes.push(q);
    return q;
  };
  const rbox = (x, y, z, w, h, d, m, cast = true) =>
    rtrack(box(roomGroup, x, y, z, w, h, d, m, cast), cast);
  const rmesh = (geo, m, cast = true) => {
    const q = new THREE.Mesh(geo, m);
    roomGroup.add(q);
    return rtrack(q, cast);
  };
  const rcyl = (x, y, z, rt, rb, h, m, seg = 18, cast = true) => {
    const q = rmesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, cast);
    q.position.set(x, y, z);
    return q;
  };

  // Materials read off the room photographs: peach paint, dark-brown floor
  // tile, cream bathroom tile, white linen, navy curtains, chrome and ceramic.
  const peachWall = mat(0xd6ac9c, 0.95);
  const ceilMat = mat(0xf0ece2, 0.92);
  const darkWood = mat(0x6b4a34, 0.7);
  const blondeWood = mat(0xc9af86, 0.68);
  const linen = mat(0xf7f5ee, 0.96);
  const linenShade = mat(0xe7e5de, 0.94);
  const throwMat = mat(0xa96a4e, 0.9);
  const navy = mat(0x1c3050, 0.92, 0, { side: THREE.DoubleSide });
  const chrome = mat(0xd8dce0, 0.28, 0.9);
  const ceramic = mat(0xf5f4ef, 0.14, 0.02);
  const plasticGreen = mat(0x47a83c, 0.55);
  const blackGloss = mat(0x14161a, 0.22, 0.35);
  const mirrorMat = mat(0xffffff, 0.06, 1.0);
  const frameMat = mat(0xdcd8ce, 0.6, 0.35);
  const corridorMat = mat(0x4a4640, 0.96);

  const floorTex = tileTexture({
    w: ROOM_W, h: ROOM_D, tw: 0.6, th: 0.6,
    base: 0x4e342a, grout: 0x2a1d16, seed: 3,
  });
  const floorTile = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.62, metalness: 0.04 });
  const bathTex = tileTexture({
    w: 1.5, h: ROOM_H, tw: 0.3, th: 0.6,
    base: 0xe6dfd2, grout: 0xb3aa9a, stagger: true, seed: 11,
  });
  const bathTile = new THREE.MeshStandardMaterial({ map: bathTex, roughness: 0.45, metalness: 0.02 });
  const bathFloorTex = tileTexture({
    w: 1.5, h: 1.6, tw: 0.3, th: 0.3,
    base: 0x5d4438, grout: 0x2a1d16, seed: 7,
  });
  const bathFloorMat = new THREE.MeshStandardMaterial({ map: bathFloorTex, roughness: 0.55 });

  // ---- Shell ---------------------------------------------------------------
  rbox(0, 0.05, roomZ, ROOM_W, 0.1, ROOM_D, floorTile);
  rbox(0, ROOM_H, roomZ, ROOM_W, 0.1, ROOM_D, ceilMat);
  // Tray border around the ceiling edge — the stepped recess in the photo.
  for (const s of [-1, 1]) rbox(s * 1.68, 2.63, roomZ, 0.34, 0.14, ROOM_D, ceilMat, false);
  for (const s of [-1, 1]) rbox(0, 2.63, roomZ + s * 3.03, 3.02, 0.14, 0.34, ceilMat, false);
  rbox(-1.9, ROOM_H / 2, roomZ, 0.1, ROOM_H, ROOM_D, peachWall);
  rbox(1.9, ROOM_H / 2, roomZ, 0.1, ROOM_H, ROOM_D, peachWall);
  rbox(0, ROOM_H / 2, 7.8, ROOM_W, ROOM_H, 0.1, peachWall);
  // Skirting along the three uninterrupted walls.
  rbox(-1.83, 0.14, roomZ, 0.03, 0.09, ROOM_D - 0.1, ceilMat, false);
  rbox(1.83, 0.14, roomZ - 0.6, 0.03, 0.09, ROOM_D - 1.4, ceilMat, false);
  rbox(0, 0.14, 7.73, ROOM_W - 0.1, 0.09, 0.03, ceilMat, false);

  // Front wall (z = 1.4) is built as segments with REAL apertures — the window
  // and the door are openings, not glass over a solid slab, so the camera can
  // physically arrive through the doorway and daylight can enter the window.
  const FZ = 1.4;
  const pierW = (xa, xb) => rbox((xa + xb) / 2, ROOM_H / 2, FZ, xb - xa, ROOM_H, 0.1, peachWall);
  pierW(-1.9, -1.75);            // left edge pier
  pierW(-0.65, -0.45);           // between window and door
  pierW(0.45, 1.9);              // door's right pier = bathroom pod front wall
  rbox(-1.2, 0.425, FZ, 1.1, 0.65, 0.1, peachWall);   // window sill wall
  rbox(-1.2, 2.5, FZ, 1.1, 0.5, 0.1, peachWall);      // window lintel
  rbox(0, 2.425, FZ, 0.9, 0.55, 0.1, peachWall);      // door lintel
  // Window aperture: x[-1.75,-0.65], y[0.75,2.25].  Door: x[-0.45,0.45], y[0.1,2.15].

  // ---- Window, backdrop, curtains ------------------------------------------
  // Aluminium sliding frame recessed in the aperture: perimeter + centre rail.
  rbox(-1.2, 2.235, 1.41, 1.14, 0.05, 0.09, frameMat, false);
  rbox(-1.2, 0.765, 1.41, 1.14, 0.05, 0.09, frameMat, false);
  rbox(-1.73, 1.5, 1.41, 0.05, 1.52, 0.09, frameMat, false);
  rbox(-0.67, 1.5, 1.41, 0.05, 1.52, 0.09, frameMat, false);
  rbox(-1.2, 1.5, 1.41, 0.045, 1.47, 0.06, frameMat, false); // centre meeting rail
  const glassMat = mat(0xc9e8ee, 0.08, 0.3, {
    transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
  });
  const glassL = rmesh(new THREE.PlaneGeometry(0.53, 1.45), glassMat, false);
  glassL.position.set(-1.475, 1.5, 1.385);
  const glassR = rmesh(new THREE.PlaneGeometry(0.53, 1.45), glassMat, false);
  glassR.position.set(-0.925, 1.5, 1.44);

  // The view: a photograph of the actual outlook (car park, trees, shophouse
  // roofs) hung as a lit backdrop half a metre outside the glazing — a diorama
  // backdrop rather than real geometry, since the exterior has dissolved by
  // the time the room reveals.
  const backdropTex = new THREE.TextureLoader().load('/salim-inn/textures/window-view.jpg');
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  const backdrop = rmesh(
    new THREE.PlaneGeometry(1.8, 2.0),
    new THREE.MeshBasicMaterial({ map: backdropTex }),
    false
  );
  backdrop.position.set(-1.2, 1.5, 0.82);

  // Curtain rod and two floor-length panels drawn toward the edges like the
  // photograph: the left one covers the window's left half, the right one
  // sits past the jamb — a ~0.5 m slit of view stays open right of centre.
  const rod = rcyl(-0.6, 2.42, 1.52, 0.018, 0.018, 2.4, chrome, 12, false);
  rod.rotation.z = Math.PI / 2;
  // The right one must stop short of the door aperture (x -0.45) or the
  // arriving camera clips through the fabric.
  const curtainL = rmesh(curtainGeo(0.7, 2.32, 5, 0.055), navy);
  curtainL.position.set(-1.55, 1.26, 1.52);
  const curtainR = rmesh(curtainGeo(0.3, 2.32, 3, 0.05), navy);
  curtainR.position.set(-0.55, 1.26, 1.53);

  // ---- Entry door ----------------------------------------------------------
  // Right-jamb hinge; swings OUTWARD into the corridor void so it never fights
  // the bathroom pod or the camera path.
  const roomDoorPivot = new THREE.Group();
  roomDoorPivot.position.set(0.45, 0, FZ + 0.06);
  roomGroup.add(roomDoorPivot);
  const roomDoor = box(roomDoorPivot, -0.42, 1.05, 0, 0.85, 2.1, 0.05, blondeWood.clone());
  roomDoor.material.transparent = true;
  roomDoor.material.opacity = 0;
  roomMeshes.push(roomDoor);
  rbox(0, 2.17, FZ + 0.04, 0.98, 0.06, 0.14, blondeWood, false); // head jamb
  rbox(-0.475, 1.1, FZ + 0.04, 0.05, 2.15, 0.14, blondeWood, false);
  rbox(0.475, 1.1, FZ + 0.04, 0.05, 2.15, 0.14, blondeWood, false);
  const knob = rcyl(0.36, 1.02, FZ + 0.1, 0.022, 0.022, 0.09, chrome, 10, false);
  knob.rotation.x = Math.PI / 2;

  // ---- Bed on the back wall --------------------------------------------------
  // Headboard: two upholstered panels on the wall, then frame, mattress, a
  // turned-down white duvet, terracotta throw across the foot, pillows.
  rbox(-0.57, 0.95, 7.71, 0.78, 0.95, 0.07, blondeWood);
  rbox(0.27, 0.95, 7.71, 0.78, 0.95, 0.07, blondeWood);
  rbox(-0.15, 0.22, 6.62, 1.62, 0.26, 2.1, darkWood);
  rbox(-0.15, 0.48, 6.58, 1.58, 0.22, 2.0, linenShade);
  rbox(-0.15, 0.64, 6.55, 1.62, 0.1, 2.05, linen);
  rbox(-0.15, 0.6, 5.78, 1.5, 0.09, 0.55, throwMat);
  rbox(-0.15, 0.5, 5.52, 1.5, 0.24, 0.05, throwMat); // throw drape over the foot
  for (const s of [-1, 1]) {
    const pillow = rmesh(new THREE.SphereGeometry(0.3, 20, 14), linen);
    pillow.scale.set(0.72, 0.32, 0.55);
    pillow.position.set(-0.15 + s * 0.37, 0.78, 7.28);
    pillow.rotation.x = -0.28;
  }
  // Stitched duvet seams, kept from the original build.
  for (let i = -3; i <= 3; i++) rbox(-0.15 + i * 0.22, 0.69, 6.5, 0.014, 0.02, 1.6, linenShade, false);

  // ---- Nightstand, phone, lamp ---------------------------------------------
  rbox(1.42, 0.28, 7.4, 0.5, 0.56, 0.45, blondeWood);
  rbox(1.42, 0.575, 7.4, 0.52, 0.03, 0.47, darkWood, false);
  rbox(1.3, 0.61, 7.3, 0.2, 0.05, 0.16, blackGloss, false); // phone
  rcyl(1.55, 0.73, 7.5, 0.028, 0.035, 0.3, chrome, 10, false); // lamp stem
  const lampShade = rmesh(new THREE.CylinderGeometry(0.09, 0.13, 0.15, 18, 1, true), linen.clone());
  lampShade.material.emissive = new THREE.Color(0xffc182);
  lampShade.material.emissiveIntensity = 0.55;
  lampShade.material.side = THREE.DoubleSide;
  lampShade.position.set(1.55, 0.95, 7.5);
  const lampLight = new THREE.PointLight(0xffc182, 2.4, 4.5, 2);
  lampLight.position.set(1.55, 0.98, 7.45);
  lampLight.userData.base = 2.4;
  roomGroup.add(lampLight);

  // ---- Left wall: TV, desk, mirror, chair, AC -------------------------------
  // The photograph's corner arrangement: wall-mounted flat screen, laminate
  // writing desk under a mirror, bright green plastic chair, split AC above.
  rbox(-1.84, 1.58, 4.4, 0.05, 0.5, 0.9, blackGloss);            // TV panel
  rbox(-1.845, 1.58, 4.4, 0.03, 0.42, 0.82, mat(0x0a0f16, 0.12, 0.5), false); // screen
  rbox(-1.82, 1.35, 4.4, 0.08, 0.05, 0.3, blackGloss, false);    // mount
  rbox(-1.58, 0.74, 3.35, 0.6, 0.05, 0.75, blondeWood);          // desk top
  rbox(-1.6, 0.4, 3.02, 0.52, 0.68, 0.05, blondeWood, false);    // leg panels
  rbox(-1.6, 0.4, 3.68, 0.52, 0.68, 0.05, blondeWood, false);
  rbox(-1.84, 0.45, 3.35, 0.04, 0.58, 0.62, blondeWood, false);  // modesty panel
  rbox(-1.848, 1.42, 3.35, 0.03, 0.7, 0.7, darkWood, false);     // mirror frame
  const deskMirror = rmesh(new THREE.PlaneGeometry(0.62, 0.62), mirrorMat, false);
  deskMirror.position.set(-1.827, 1.42, 3.35);
  deskMirror.rotation.y = Math.PI / 2;
  for (const dz of [-0.12, 0.1]) {                                // water bottles
    rcyl(-1.62, 0.885, 3.3 + dz, 0.035, 0.035, 0.23, mat(0xbfd8d2, 0.15, 0.1, { transparent: true, opacity: 0.75 }), 10, false);
    rcyl(-1.62, 1.01, 3.3 + dz, 0.014, 0.014, 0.03, plasticGreen, 8, false);
  }
  rcyl(-1.5, 0.25, 3.82, 0.13, 0.11, 0.3, blackGloss, 14, false); // bin
  // Green monobloc chair facing the desk.
  rbox(-1.32, 0.45, 3.35, 0.42, 0.05, 0.4, plasticGreen);
  const chairBack = rbox(-1.12, 0.72, 3.35, 0.05, 0.5, 0.42, plasticGreen);
  chairBack.rotation.z = -0.1;
  for (const [dx, dz] of [[-0.16, -0.15], [-0.16, 0.15], [0.16, -0.15], [0.16, 0.15]]) {
    const leg = rcyl(-1.32 + dx, 0.22, 3.35 + dz, 0.018, 0.018, 0.44, plasticGreen, 8, false);
    leg.rotation.z = dx * 0.18;
    leg.rotation.x = -dz * 0.18;
  }
  // Split AC high on the wall, over the desk end — as photographed.
  rbox(-1.74, 2.42, 3.35, 0.24, 0.28, 0.85, mat(0xeeece4, 0.5), false);
  rbox(-1.66, 2.32, 3.35, 0.03, 0.04, 0.75, mat(0xc9c5b8, 0.6), false); // vane

  // ---- Bathroom pod ----------------------------------------------------------
  // Compact wet bath filling the front-right corner: x[0.45,1.85], z[1.45,3.0].
  // Its -z wall is shared with the room's front wall; its +x wall is shared
  // with the room's right wall. The open door on the room-facing side shows a
  // lit interior: pedestal sink, WC under a chrome towel rack, shower curtain.
  const podWall = (x, y, z, w, h, d) => rbox(x, y, z, w, h, d, peachWall);
  podWall(0.45, ROOM_H / 2, 2.22, 0.08, ROOM_H, 1.56);            // room-facing side
  podWall(1.5, ROOM_H / 2, 3.0, 0.7, ROOM_H, 0.08);               // front, right of door
  podWall(0.5, ROOM_H / 2, 3.0, 0.1, ROOM_H, 0.08);               // front, left of door
  podWall(0.85, 2.37, 3.0, 0.6, 0.76, 0.08);                      // lintel over bath door
  // Bath door aperture: x[0.55,1.15], y[0.1,1.99], hinged at left jamb, ajar
  // inward so the sink and towel rack read through the opening.
  const bathDoorPivot = new THREE.Group();
  bathDoorPivot.position.set(0.55, 0, 3.0);
  roomGroup.add(bathDoorPivot);
  const bathDoor = box(bathDoorPivot, 0.28, 1.0, 0, 0.56, 1.95, 0.04, blondeWood.clone());
  bathDoor.material.transparent = true;
  bathDoor.material.opacity = 0;
  roomMeshes.push(bathDoor);
  bathDoorPivot.rotation.y = 1.45; // swung nearly flat to the inner wall — doorway reads open
  // Cream tile liners inside the pod (the room-facing faces stay peach).
  const liner = (w, h, x, y, z, ry) => {
    const p = rmesh(new THREE.PlaneGeometry(w, h), bathTile, false);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    return p;
  };
  liner(1.44, 2.6, 0.505, 1.4, 2.22, Math.PI / 2);   // side wall interior
  liner(1.3, 2.6, 1.15, 1.4, 2.94, Math.PI);         // front wall interior
  liner(1.3, 2.6, 1.15, 1.4, 1.51, 0);               // back wall interior
  liner(1.44, 2.6, 1.84, 1.4, 2.22, -Math.PI / 2);   // right wall interior
  const podFloor = rmesh(new THREE.PlaneGeometry(1.3, 1.44), bathFloorMat, false);
  podFloor.rotation.x = -Math.PI / 2;
  podFloor.position.set(1.15, 0.105, 2.22);

  // Pedestal sink against the pod's right wall — visible through the doorway.
  rcyl(1.62, 0.4, 2.5, 0.09, 0.12, 0.6, ceramic, 16);            // pedestal
  rcyl(1.58, 0.75, 2.5, 0.24, 0.17, 0.14, ceramic, 20);          // basin
  const basinTop = rmesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 20), mat(0xdfe4e2, 0.3), false);
  basinTop.position.set(1.58, 0.83, 2.5);
  rcyl(1.72, 0.92, 2.5, 0.02, 0.02, 0.16, chrome, 10, false);    // faucet riser
  rbox(1.64, 0.99, 2.5, 0.16, 0.025, 0.04, chrome, false);       // spout
  const bathMirror = rmesh(new THREE.PlaneGeometry(0.5, 0.6), mirrorMat, false);
  bathMirror.position.set(1.82, 1.55, 2.5);
  bathMirror.rotation.y = -Math.PI / 2;
  rbox(1.838, 1.55, 2.5, 0.03, 0.68, 0.58, frameMat, false);     // cabinet frame

  // WC against the back wall, chrome towel rack above it — the photograph's
  // arrangement, down to the rolled towels and the draped one on the seat.
  rbox(1.3, 0.62, 1.72, 0.44, 0.36, 0.16, ceramic);              // cistern
  const bowl = rmesh(new THREE.CylinderGeometry(0.21, 0.15, 0.4, 18), ceramic);
  bowl.scale.z = 1.25;
  bowl.position.set(1.3, 0.3, 1.98);
  const seat = rmesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 18), ceramic);
  seat.scale.z = 1.28;
  seat.position.set(1.3, 0.52, 1.98);
  const draped = rbox(1.3, 0.56, 1.98, 0.34, 0.05, 0.4, linen, false); // towel on seat
  draped.rotation.y = 0.15;
  // Towel rack: shelf of chrome bars + rolled towels + a hanging pair.
  for (const dz of [-0.06, 0.0, 0.06]) rbox(1.3, 1.68, 1.6 + dz, 0.7, 0.015, 0.05, chrome, false);
  rbox(1.0, 1.58, 1.6, 0.03, 0.22, 0.14, chrome, false);
  rbox(1.6, 1.58, 1.6, 0.03, 0.22, 0.14, chrome, false);
  for (let i = 0; i < 3; i++) {
    const roll = rcyl(1.08 + i * 0.24, 1.76, 1.6, 0.07, 0.07, 0.34, linen, 14, false);
    roll.rotation.x = Math.PI / 2;
    roll.rotation.z = Math.PI / 2;
  }
  rbox(1.14, 1.4, 1.62, 0.26, 0.5, 0.04, linen, false);          // hanging towels
  rbox(1.5, 1.38, 1.62, 0.24, 0.46, 0.04, linenShade, false);
  // Toilet-roll holder, "no paper in the WC" sign, bidet sprayer + hose.
  rcyl(0.56, 1.05, 2.35, 0.055, 0.055, 0.1, linenShade, 12, false).rotation.x = Math.PI / 2;
  rbox(0.53, 1.05, 2.35, 0.04, 0.09, 0.13, chrome, false);
  const noPaper = canvasPlane(0.16, 0.2, (ctx, w, h) => {
    ctx.fillStyle = '#f6f4ee';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = w * 0.03;
    ctx.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(w * 0.3, h * 0.34, w * 0.16, h * 0.3);        // tank
    ctx.beginPath();
    ctx.ellipse(w * 0.52, h * 0.6, w * 0.2, h * 0.14, 0, 0, Math.PI * 2); // bowl
    ctx.fill();
    ctx.strokeStyle = '#c03a30';
    ctx.lineWidth = w * 0.055;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.5, w * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.27, h * 0.26);
    ctx.lineTo(w * 0.73, h * 0.74);
    ctx.stroke();
  });
  noPaper.position.set(0.52, 1.42, 2.35);
  noPaper.rotation.y = Math.PI / 2;
  roomGroup.add(noPaper);
  noPaper.material.transparent = true;
  noPaper.material.opacity = 0;
  roomMeshes.push(noPaper);
  const sprayer = rcyl(1.78, 1.0, 1.95, 0.018, 0.024, 0.14, chrome, 8, false);
  sprayer.rotation.z = Math.PI / 2;
  const hose = rmesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(1.78, 1.0, 1.9),
        new THREE.Vector3(1.72, 0.6, 1.85),
        new THREE.Vector3(1.74, 0.3, 1.75),
      ]),
      16, 0.011, 6
    ),
    chrome,
    false
  );
  // Shower corner: chrome head on the back wall, blue curtain on a rod,
  // partially drawn — the blue curtain from the photographs.
  rcyl(0.75, 2.1, 1.56, 0.02, 0.02, 0.14, chrome, 8, false).rotation.x = Math.PI / 2;
  rcyl(0.75, 2.02, 1.66, 0.05, 0.03, 0.06, chrome, 10, false);
  const showerRod = rcyl(1.05, 2.05, 2.0, 0.014, 0.014, 0.9, chrome, 8, false);
  showerRod.rotation.x = Math.PI / 2;
  const showerCurtain = rmesh(curtainGeo(0.75, 1.85, 5, 0.04), mat(0x2e6da8, 0.8, 0, { side: THREE.DoubleSide }));
  showerCurtain.rotation.y = Math.PI / 2;
  showerCurtain.position.set(1.05, 1.1, 1.85);
  rcyl(1.68, 0.24, 2.8, 0.12, 0.1, 0.28, blackGloss, 12, false); // waste bin

  // ---- Corridor --------------------------------------------------------------
  // The room sits in a 15 m hotel bay; the flyway reaches the door down the
  // right-side corridor. A floor slab, a neighbour's door and a picture frame
  // sell the corridor without building the whole floor.
  rbox(2.55, 0.02, 4.5, 1.5, 0.06, 8.4, corridorMat, false);
  rbox(-0.025, 0.02, 0.75, 3.65, 0.06, 1.35, corridorMat, false);
  rbox(1.96, 1.07, 5.6, 0.06, 2.05, 0.9, blondeWood);            // neighbour door
  rbox(1.96, 1.62, 6.9, 0.05, 0.5, 0.7, darkWood, false);        // picture frame
  const corridorLight = new THREE.PointLight(0xffd9a8, 3.2, 7, 2);
  corridorLight.position.set(2.5, 2.4, 4.2);
  corridorLight.userData.base = 3.2;
  roomGroup.add(corridorLight);

  // ---- Lights ------------------------------------------------------------------
  // Every room light ramps in with roomReveal (see salim-inn.js) so the room
  // switches on as it materialises instead of glowing through the dissolve.
  const roomLight = new THREE.PointLight(0xffe7bd, 9, 14, 2);
  roomLight.position.set(0.1, 2.45, 4.8);
  roomLight.userData.base = 9;
  roomGroup.add(roomLight);

  // Daylight shaft through the window aperture: the one shadow caster in the
  // room, so the frame and curtains throw a real window-shaped pool of light.
  const windowSpot = new THREE.SpotLight(0xdcefff, 60, 16, 0.72, 0.75, 2);
  windowSpot.position.set(-1.2, 2.1, 0.9);
  windowSpot.target.position.set(-0.85, 0.1, 4.4);
  windowSpot.castShadow = true;
  windowSpot.shadow.mapSize.set(1024, 1024);
  windowSpot.shadow.camera.near = 0.3;
  windowSpot.shadow.camera.far = 14;
  windowSpot.shadow.bias = -0.0004;
  windowSpot.userData.base = 60;
  roomGroup.add(windowSpot, windowSpot.target);

  const bathLight = new THREE.PointLight(0xffd9a0, 4.5, 6, 2);
  bathLight.position.set(1.2, 2.3, 2.2);
  bathLight.userData.base = 4.5;
  roomGroup.add(bathLight);

  salimGroup.updateMatrixWorld(true);
  const toWorld = (x, y, z) => interior.localToWorld(new THREE.Vector3(x, y, z));
  const toRoom = (x, y, z) => toWorld(x, GROUND_STOREY + y, z);

  return {
    interior, interiorMeshes, roomMeshes, recSign, roomDoorPivot,
    roomLights: [roomLight, windowSpot, bathLight, lampLight, corridorLight],
    receptionWorld: toWorld(-0.4, 1.6, recZ - 3),
    stairFootWorld: toWorld(1.6, 1.5, recZ + 2.2),
    stairTopWorld: toWorld(1.6, GROUND_STOREY + 1.5, recZ + 1.6),
    // Upstairs path anchors: down the corridor void on the room's right side,
    // to the door, then inside and across to the bed-side corner — the final
    // frame looks back at the window/desk wall, the photograph's composition.
    corridorMidWorld: toRoom(2.55, 1.5, 5.6),
    corridorFrontWorld: toRoom(2.55, 1.5, 0.95),
    roomEntryWorld: toRoom(0.3, 1.45, 0.45),
    roomInsideWorld: toRoom(-0.1, 1.55, 3.7),
    roomCornerWorld: toRoom(1.15, 1.58, 7.55),
    // Aimed low on purpose: the frame pitches down like the room photograph,
    // so the bed's foot corner catches the bottom edge.
    windowTargetWorld: toRoom(-0.9, 0.45, 1.9),
  };
}
