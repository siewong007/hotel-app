// Room shell builder driven by hotel.json (brief §4.5). Milestone 1: the
// configurator room's footprint, walls, window/no-window and bed layout at
// true Malaysian bed sizes, as clean massing. The choreographed type
// transitions, furniture set and materials matched to the owner's photos
// arrive in milestone 3.
import * as THREE from 'three';
import hotel from '../data/hotel.json';
import { PLAN } from '../world/SalimInnBuilding';
import { FLOOR_Y } from '../config/dimensions';
import { ROOM_DISPLAY, type RoomCode } from '../config/site';
import { BRAND } from '../config/materials';
import { boxAt, roundedBox } from '../world/geom';

// Malaysian standard bed sizes (m): width × length.
export const BED = { single: [0.91, 1.9], queen: [1.52, 1.9], king: [1.83, 1.9] } as const;

export interface RoomSpec {
  code: RoomCode;
  name: string;
  sizeSqm: number;
  width: number;
  depth: number;
  window: boolean;
  beds: (keyof typeof BED)[];
  maxGuests: number;
  extraBed: boolean;
}

const DEPTH = PLAN.frontRoomDepth - 0.2; // window wall inner face → corridor wall

export function roomSpecs(): RoomSpec[] {
  return hotel.room_types.map((t) => {
    const code = t.code as RoomCode;
    const disp = ROOM_DISPLAY[code];
    const size = t.size_sqm ?? disp.sizeSqm;
    const d = t.description.toLowerCase();
    const beds: (keyof typeof BED)[] = [];
    if (d.includes('king')) beds.push('king');
    if (d.includes('queen')) beds.push('queen');
    const singles = (d.match(/single/g) ?? []).length;
    for (let i = 0; i < singles; i++) beds.push('single');
    return {
      code,
      name: disp.name,
      sizeSqm: size,
      width: size / DEPTH,
      depth: DEPTH,
      window: !t.name.toLowerCase().includes('no window'),
      beds,
      maxGuests: t.max_occupancy,
      extraBed: t.allows_extra_bed,
    };
  });
}

export class RoomBuilder {
  readonly group = new THREE.Group();
  readonly specs = roomSpecs();
  readonly light: THREE.PointLight;
  current: RoomSpec;
  private shell = new THREE.Group();

  constructor(initial: RoomCode = 'DLX') {
    this.current = this.specs.find((s) => s.code === initial) ?? this.specs[0];
    // anchored on its right-hand wall; each type extends to the left
    this.group.position.set(PLAN.showcaseRight, FLOOR_Y.level1, 0);
    this.light = new THREE.PointLight(0xffd6a0, 0, 9, 2);
    this.light.position.set(0, 2.55, -DEPTH / 2 - 0.2);
    this.group.add(this.shell, this.light);
    this.group.name = 'room';
    this.build(this.current);
  }

  build(spec: RoomSpec): void {
    this.current = spec;
    for (const c of this.shell.children) (c as THREE.Mesh).geometry?.dispose();
    this.shell.clear();
    const w = spec.width, d = spec.depth, h = 2.75;
    const z0 = -0.2; // window wall inner face (facade wall is part of the building shell)
    const z1 = z0 - d; // corridor side
    const wall = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xb79a78, roughness: 0.55 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = mesh.receiveShadow = true;
      this.shell.add(mesh);
      return mesh;
    };
    // local x runs from −w (left wall) to 0 (the shared right-hand wall)
    add(boxAt(-w, 0.0, z1, 0, 0.03, z0), floorMat);
    add(boxAt(-w, h, z1, 0, h + 0.05, z0), wall);
    add(boxAt(-w - 0.12, 0, z1, -w, h, z0), wall);
    add(boxAt(0, 0, z1, 0.12, h, z0), wall);
    // no window → the facade opening is closed from inside
    if (!spec.window) add(boxAt(-w, 0, z0 - 0.12, 0, h, z0), wall);
    // ensuite bathroom (≈4.5 m²) at the corridor end of the left wall; the
    // door is at the right-hand end (PLAN.showcaseDoor)
    const bathW = 1.9, bathD = 2.35;
    add(boxAt(-w, 0, z1, -w + bathW, h, z1 + bathD), new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.85 }));

    // beds in the window half, headboards against the left wall
    const duvet = new THREE.MeshPhysicalMaterial({ color: 0xf7f5f0, roughness: 0.9, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) });
    const runner = new THREE.MeshStandardMaterial({ color: BRAND.forest, roughness: 0.8 });
    const head = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.7 });
    let z = z0 - 0.9;
    for (const b of spec.beds) {
      const [bw, bl] = BED[b];
      const cz = z - bw / 2;
      const cx = -w + 0.1 + bl / 2;
      const bed = add(roundedBox(bl, 0.52, bw, 0.05), duvet);
      bed.position.set(cx, 0.3, cz);
      const rn = add(new THREE.BoxGeometry(0.45, 0.02, bw + 0.04), runner);
      rn.position.set(cx + bl * 0.28, 0.57, cz);
      const hb = add(roundedBox(0.08, 1.05, bw + 0.1, 0.02), head);
      hb.position.set(-w + 0.05, 0.62, cz);
      z -= bw + 0.6;
    }
    this.light.position.set(-w / 2, 2.5, (z0 + z1) / 2);
  }

  setLights(v: number): void {
    this.light.intensity = 6 * v;
  }

  select(code: RoomCode): void {
    const s = this.specs.find((r) => r.code === code);
    if (s && s !== this.current) this.build(s);
  }
}
