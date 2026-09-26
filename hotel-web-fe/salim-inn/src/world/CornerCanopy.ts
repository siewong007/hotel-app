// The curved dark canopy at the south tip of the Farley NW block — the
// Farley Cafe corner facing the supermarket (rec1_13–16, rec2_t000s). The
// brief lists it with the hero block; the frames place it at this corner of
// the same block (see README). A thick charcoal fascia follows an arc around
// the corner on slim stainless poles, with a dark slatted soffit.
import * as THREE from 'three';
import { buildingById, FARLEY_IDS, pts } from '../data/site';
import { FACADE } from '../config/materials';
import { mergeAll } from './geom';
import { soffitSlats } from './textures';

export class CornerCanopy {
  readonly group = new THREE.Group();

  constructor() {
    const ring = pts(buildingById(FARLEY_IDS.nwBlock).p).map(([x, z]) => new THREE.Vector2(x, z));
    // the south tip: the vertex nearest the supermarket
    let tip = 0;
    ring.forEach((p, i) => { if (p.distanceTo(new THREE.Vector2(16, -16)) < ring[tip].distanceTo(new THREE.Vector2(16, -16))) tip = i; });
    const P = ring[tip];
    const A = ring[(tip - 1 + ring.length) % ring.length];
    const B = ring[(tip + 1) % ring.length];
    const dA = A.clone().sub(P).normalize();
    const dB = B.clone().sub(P).normalize();
    const out = dA.clone().add(dB).normalize().negate(); // outward bisector
    const centre = P.clone().addScaledVector(out, -1.0);
    const aOut = Math.atan2(out.y, out.x);
    const span = Math.PI * 0.78;
    const R0 = 2.2, R1 = 8.4, y0 = 3.75, hFascia = 1.05;
    const seg = 28;

    // canopy slab (annular sector) as an extruded shape
    const shape = new THREE.Shape();
    for (let i = 0; i <= seg; i++) {
      const a = aOut - span / 2 + (span * i) / seg;
      const v = new THREE.Vector2(Math.cos(a) * R1, -Math.sin(a) * R1);
      if (i === 0) shape.moveTo(v.x, v.y); else shape.lineTo(v.x, v.y);
    }
    for (let i = seg; i >= 0; i--) {
      const a = aOut - span / 2 + (span * i) / seg;
      shape.lineTo(Math.cos(a) * R0, -Math.sin(a) * R0);
    }
    const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 1 });
    slab.rotateX(-Math.PI / 2).translate(centre.x, y0 + hFascia - 0.2, centre.y);
    // fascia band along the outer arc
    const band = new THREE.CylinderGeometry(R1, R1, hFascia, seg * 2, 1, true, Math.PI / 2 - (aOut + span / 2), span);
    band.translate(centre.x, y0 + hFascia / 2, centre.y);
    const bandIn = new THREE.CylinderGeometry(R1 - 0.12, R1 - 0.12, hFascia, seg * 2, 1, true, Math.PI / 2 - (aOut + span / 2), span);
    bandIn.scale(1, 1, 1).translate(centre.x, y0 + hFascia / 2, centre.y);
    const charcoal = mergeAll([slab, band, bandIn], ['position', 'normal']);
    const mat = new THREE.MeshStandardMaterial({ color: FACADE.salimCharcoal, roughness: 0.48, metalness: 0.3, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(charcoal, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'corner-canopy';

    // slatted soffit underneath
    const soffitShape = shape.clone();
    const sg = new THREE.ShapeGeometry(soffitShape, 1);
    sg.rotateX(-Math.PI / 2).translate(centre.x, y0 - 0.001, centre.y);
    const uv = sg.getAttribute('uv') as THREE.BufferAttribute;
    const pos = sg.getAttribute('position');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    const sl = soffitSlats();
    const soffitMat = new THREE.MeshStandardMaterial({ map: sl.map.clone(), roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide });
    soffitMat.map!.repeat.set(1 / 0.88, 1);
    soffitMat.map!.needsUpdate = true;
    const soffit = new THREE.Mesh(sg, soffitMat);
    soffit.name = 'corner-canopy-soffit';

    // slim poles along the outer arc
    const poles: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const a = aOut - span * 0.38 + (span * 0.76 * k) / 3;
      const r = R1 - 0.6;
      const p = new THREE.CylinderGeometry(0.07, 0.07, y0, 10);
      p.translate(centre.x + Math.cos(a) * r, y0 / 2, centre.y + Math.sin(a) * r);
      poles.push(p);
    }
    const poleMesh = new THREE.Mesh(mergeAll(poles, ['position', 'normal']), new THREE.MeshStandardMaterial({ color: 0xd4d7d8, roughness: 0.25, metalness: 0.9 }));
    poleMesh.castShadow = true;
    poleMesh.name = 'corner-canopy-poles';
    this.group.add(mesh, soffit, poleMesh);
  }
}
