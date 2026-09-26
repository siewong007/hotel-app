// Far field: every OSM building outside the Farley ring (extruded, one merged
// mesh), plus procedural terrace-house rows along residential streets where
// OSM has no footprints — instanced, low detail, red/grey roofs — so the
// establishing shot reads as Sibu's low-rise estates.
import * as THREE from 'three';
import { site, pts, FARLEY_IDS } from '../data/site';
import { rectClear } from './spatial';
import { POINTS } from './layout';
import { mergeAll, paint, prism, rng } from './geom';

const ROWS_R = 2300;

const HEIGHT_BY_KIND: Record<string, number> = { house: 7.2, residential: 7.2, apartments: 13, commercial: 11.5, retail: 11.5, office: 14, school: 10.5, industrial: 9, warehouse: 9, hospital: 16, mosque: 12, temple: 9, church: 11, hotel: 16, roof: 4.5, yes: 8.5 };

export class FarField {
  readonly group = new THREE.Group();
  readonly osm: THREE.Mesh;
  readonly rowBodies: THREE.InstancedMesh;
  readonly rowRoofs: THREE.InstancedMesh;
  rowCount = 0;

  constructor(density = 1) {
    const rand = rng(1337);
    const farley = new Set<number>(Object.values(FARLEY_IDS));
    const geos: THREE.BufferGeometry[] = [];
    for (const b of site.buildings) {
      if (farley.has(b.id)) continue;
      const ring = pts(b.p).map(([x, z]) => new THREE.Vector2(x, z));
      if (ring.length < 3) continue;
      const h = b.h ?? (b.lv ? b.lv * 3.2 + 1 : HEIGHT_BY_KIND[b.k] ?? 8.5) * (0.92 + rand() * 0.16);
      const g = prism(ring, 0, h);
      // walls light, roofs coloured
      const roof = b.k === 'house' || b.k === 'residential' ? [0xa14b33, 0x8c3b2b, 0x9a5a3a][Math.floor(rand() * 3)] : [0xb9bec0, 0x9da8ae, 0xc9c6bd][Math.floor(rand() * 3)];
      paint(g, 0xe2ddd2);
      const nrm = g.getAttribute('normal');
      const col = g.getAttribute('color') as THREE.BufferAttribute;
      const rc = new THREE.Color(roof);
      for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) > 0.9) col.setXYZ(i, rc.r, rc.g, rc.b);
      geos.push(g);
    }
    this.osm = new THREE.Mesh(mergeAll(geos, ['position', 'normal', 'color']), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
    this.osm.castShadow = true;
    this.osm.receiveShadow = true;
    this.osm.name = 'osm-buildings';

    // Procedural terrace rows along residential streets.
    const rows: { x: number; z: number; yaw: number; L: number; D: number; H: number }[] = [];
    const c = POINTS.hotelCentre;
    for (const r of site.roads) {
      if (r.c !== 'residential' && r.c !== 'unclassified') continue;
      const line = pts(r.p);
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        const segL = Math.hypot(bx - ax, bz - az);
        if (segL < 20) continue;
        const ux = (bx - ax) / segL, uz = (bz - az) / segL;
        for (const side of [-1, 1]) {
          let s = 4 + rand() * 6;
          while (s < segL - 12) {
            const L = Math.min(segL - s - 3, 22 + rand() * 34);
            if (L < 14) break;
            const D = 11 + rand() * 4;
            const off = r.w / 2 + 4.2 + D / 2;
            const cx = ax + ux * (s + L / 2) - uz * off * side;
            const cz = az + uz * (s + L / 2) + ux * off * side;
            const dc = Math.hypot(cx - c.x, cz - c.z);
            if (dc < ROWS_R && dc > 150 && rand() < density && rectClear(cx, cz, ux, uz, L / 2, D / 2, 1.2)) {
              rows.push({ x: cx, z: cz, yaw: Math.atan2(-uz, ux), L, D, H: rand() < 0.8 ? 7.4 : 10.6 });
            }
            s += L + 5 + rand() * 9;
          }
        }
      }
    }
    this.rowCount = rows.length;
    // unit geometry: body box (0..0.72) and a gabled roof prism (0.72..1)
    const body = new THREE.BoxGeometry(1, 0.74, 1).translate(0, 0.37, 0);
    const roofShape = new THREE.Shape([new THREE.Vector2(-0.56, 0), new THREE.Vector2(0.56, 0), new THREE.Vector2(0, 0.28)]);
    const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false });
    roof.translate(0, 0, -0.5).rotateY(Math.PI / 2).translate(0, 0.72, 0);
    this.rowBodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), Math.max(1, rows.length));
    this.rowRoofs = new THREE.InstancedMesh(roof, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }), Math.max(1, rows.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const bodyCols = [0xe8e2d4, 0xefe9dd, 0xd9d2c3, 0xe3d6bf, 0xf2efe6];
    const roofCols = [0x96503a, 0x874334, 0x9a6149, 0x8c5a48, 0x72716c, 0x7e8a92, 0x8a4a38, 0x6d7478];
    const col = new THREE.Color();
    rows.forEach((r, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.yaw);
      m.compose(new THREE.Vector3(r.x, 0, r.z), q, new THREE.Vector3(r.L, r.H, r.D));
      this.rowBodies.setMatrixAt(i, m);
      this.rowRoofs.setMatrixAt(i, m);
      this.rowBodies.setColorAt(i, col.setHex(bodyCols[Math.floor(rand() * bodyCols.length)]));
      this.rowRoofs.setColorAt(i, col.setHex(roofCols[Math.floor(rand() * roofCols.length)]));
    });
    this.rowBodies.count = this.rowRoofs.count = rows.length;
    for (const mesh of [this.rowBodies, this.rowRoofs]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
    }
    this.rowBodies.name = 'terrace-bodies';
    this.rowRoofs.name = 'terrace-roofs';
    this.group.add(this.osm, this.rowBodies, this.rowRoofs);
  }
}
