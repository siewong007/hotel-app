// Camera views for the room configurator — one per type, matched to the
// owner's photo of that type so the "See the real room" toggle can lay the
// photo over the render (brief §3 ch. 6: "the owner's photo in a matched
// frame"). Poses are room-local metres (see roomLayouts.ts); vfov is the
// photo's vertical field of view, aspect its width / height, roll the tilt
// it was taken with.
//
// Solved in perf/calib (points-room-*.json) from pixel ↔ model
// correspondences; the fitted furniture positions were fed back into
// roomLayouts.ts:
//   DLX  2.9 px mean — headboard, art frame, wardrobe edges, bedside table, bed edge
//   SUP  0.7 px      — both headboards, art frame, table, wardrobe edge
//   FS   ~6 px       — headboard, mirror, desk, wall corner, divan corners
//   FR   2.8 px — a narrow (≈22° vertical) shot from beyond the modelled
//        room's far corner: the view is used as solved, with the walls between
//        the camera and the room cut away (RoomBuilder.cutawayFor)
//   STDQ no Standard Queen photo exists: guest-room.jpg is framed by eye
import * as THREE from 'three';
import type { RoomCode } from '../config/site';

export interface RoomView {
  pos: [number, number, number];
  target: [number, number, number];
  vfov: number;
  aspect: number;
  roll: number; // degrees
  photo: string | null;
}

export const ROOM_VIEWS: Record<RoomCode, RoomView> = {
  DLX: { pos: [-1.878, 1.259, -3.936], target: [-9.92, -0.579, 1.716], vfov: 78.24, aspect: 0.75, roll: 3.56, photo: '/salim-inn/rooms/deluxe-king.jpg' },
  SUP: { pos: [-0.467, 1.36, -4.097], target: [-8.51, -0.863, 1.415], vfov: 61.55, aspect: 0.75, roll: -0.21, photo: '/salim-inn/rooms/superior-twin.jpg' },
  FR: { pos: [-6.837, 1.95, -8.033], target: [0.319, 0.48, -1.205], vfov: 22.06, aspect: 4 / 3, roll: 5.58, photo: '/salim-inn/rooms/family-room.jpg' },
  FS: { pos: [-2.398, 1.298, -4.208], target: [3.226, -1.986, 3.381], vfov: 79.56, aspect: 0.75, roll: 0.46, photo: '/salim-inn/rooms/family-suite.jpg' },
  // by eye: turned towards the TV wall so the window sits right of centre, as in guest-room.jpg
  STDQ: { pos: [-2.05, 1.5, -4.45], target: [-0.76, 1.62, -0.35], vfov: 60, aspect: 4 / 3, roll: 0, photo: '/salim-inn/gallery/guest-room.jpg' },
};

/** Room-local → world, given the room group. */
export function viewToWorld(v: RoomView, room: THREE.Object3D): { pos: THREE.Vector3; target: THREE.Vector3 } {
  room.updateMatrixWorld(true);
  return {
    pos: new THREE.Vector3(...v.pos).applyMatrix4(room.matrixWorld),
    target: new THREE.Vector3(...v.target).applyMatrix4(room.matrixWorld),
  };
}
