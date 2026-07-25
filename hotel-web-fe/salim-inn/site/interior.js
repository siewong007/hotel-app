import * as THREE from '../vendor/three.module.min.js';
import { mat, box, spriteLabel, GROUND_STOREY } from './core.js';

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

  // Deluxe 6001, directly above reception.
  const roomGroup = new THREE.Group();
  roomGroup.position.set(0, GROUND_STOREY, 0);
  interior.add(roomGroup);
  const roomZ = ROOM_D / 2 + 1.4;

  const rbox = (x, y, z, w, h, d, m) => {
    const q = box(roomGroup, x, y, z, w, h, d, m.clone());
    q.material.transparent = true;
    q.material.opacity = 0;
    roomMeshes.push(q);
    return q;
  };

  const deluxeWall = mat(0xeee8d8, 0.9);
  const deluxeFloor = mat(0x74462f, 0.82, 0.04);
  const blondeWood = mat(0xc9af86, 0.76, 0.06);
  const bedBase = mat(0x85503a, 0.86);
  const linen = mat(0xfaf9f3, 0.97, 0.02);
  const linenShade = mat(0xe7e5de, 0.92);
  const navy = mat(0x172b50, 0.78);
  const windowGlass = mat(0xc9e8ee, 0.06, 0.28, { transparent: true, opacity: 0.82 });
  const frame = mat(0xe9e6dc, 0.74);
  const phoneMat = mat(0x242321, 0.5);

  rbox(0, 0.05, roomZ, ROOM_W, 0.1, ROOM_D, deluxeFloor);
  rbox(-ROOM_W / 2, ROOM_H / 2, roomZ, 0.08, ROOM_H, ROOM_D, deluxeWall);
  rbox(ROOM_W / 2, ROOM_H / 2, roomZ, 0.08, ROOM_H, ROOM_D, deluxeWall);
  rbox(0, ROOM_H / 2, roomZ - ROOM_D / 2, ROOM_W, ROOM_H, 0.08, deluxeWall);
  rbox(0, ROOM_H / 2, roomZ + ROOM_D / 2, ROOM_W, ROOM_H, 0.08, deluxeWall);
  rbox(0, ROOM_H, roomZ, ROOM_W, 0.08, ROOM_D, deluxeWall);

  const roomDoorPivot = new THREE.Group();
  roomDoorPivot.position.set(ROOM_W * 0.3, 0, roomZ - ROOM_D / 2 + 0.06);
  roomGroup.add(roomDoorPivot);
  const roomDoor = box(roomDoorPivot, -0.42, 1.05, 0, 0.85, 2.1, 0.06, blondeWood.clone());
  roomDoor.material.transparent = true;
  roomDoor.material.opacity = 0;
  roomMeshes.push(roomDoor);

  // Headboard wall at the back of the room, bed projecting from it.
  const headZ = roomZ + ROOM_D * 0.34;
  rbox(0.15, 1.0, headZ, 2.0, 1.0, 0.1, blondeWood);
  rbox(0.15, 1.85, headZ + 0.01, 1.2, 0.7, 0.11, blondeWood);

  rbox(0.15, 0.28, headZ - 1.2, 1.7, 0.44, 2.1, bedBase);
  rbox(0.15, 0.56, headZ - 1.25, 1.72, 0.18, 2.05, linenShade);
  rbox(0.15, 0.7, headZ - 1.35, 1.74, 0.14, 1.8, linen);
  for (const s of [-1, 1]) rbox(0.15 + s * 0.44, 0.88, headZ - 0.32, 0.76, 0.2, 0.42, linen);
  for (let i = -3; i <= 3; i++) rbox(0.15 + i * 0.22, 0.79, headZ - 1.4, 0.014, 0.03, 1.6, linenShade);

  rbox(1.32, 0.28, headZ - 0.3, 0.44, 0.56, 0.44, phoneMat);
  rbox(1.32, 0.6, headZ - 0.3, 0.2, 0.08, 0.16, phoneMat);

  // Street-facing window on the front wall, navy curtains tied back.
  const winZ = roomZ - ROOM_D / 2 + 0.06;
  rbox(-0.35, 1.5, winZ, 1.9, 1.5, 0.04, windowGlass);
  for (const x of [-1.3, -0.35, 0.6]) rbox(x, 1.5, winZ - 0.03, 0.05, 1.56, 0.05, frame);
  rbox(-0.35, 0.74, winZ - 0.03, 1.98, 0.05, 0.06, frame);
  for (const s of [-1, 1]) rbox(-0.35 + s * 1.14, 1.5, winZ - 0.1, 0.34, 1.9, 0.14, navy);

  const roomLight = new THREE.PointLight(0xffe7bd, 9, 14, 2);
  roomLight.position.set(0.1, GROUND_STOREY + 2.3, roomZ);
  interior.add(roomLight);
  const windowLight = new THREE.PointLight(0xe3f7ff, 7, 10, 2);
  windowLight.position.set(-0.4, GROUND_STOREY + 1.7, winZ + 0.8);
  interior.add(windowLight);

  salimGroup.updateMatrixWorld(true);
  const toWorld = (x, y, z) => interior.localToWorld(new THREE.Vector3(x, y, z));

  return {
    interior, interiorMeshes, roomMeshes, recSign, roomDoorPivot,
    receptionWorld: toWorld(-0.4, 1.6, recZ - 3),
    stairFootWorld: toWorld(1.6, 1.5, recZ + 2.2),
    stairTopWorld: toWorld(1.6, GROUND_STOREY + 1.5, recZ + 1.6),
    roomEntryWorld: toWorld(ROOM_W * 0.3, GROUND_STOREY + 1.5, roomZ - ROOM_D / 2 - 1.1),
    roomInsideWorld: toWorld(-0.5, GROUND_STOREY + 1.6, roomZ - ROOM_D * 0.28),
    bedTargetWorld: toWorld(0.2, GROUND_STOREY + 1.05, headZ - 1.1),
  };
}
