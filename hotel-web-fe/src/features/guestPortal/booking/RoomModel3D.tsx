// The landing's configurator room (salim-inn/src/interiors/RoomBuilder.ts) as
// a small dollhouse the guest can orbit. Loaded lazily (React.lazy) only when
// a card's 3D view is tapped; everything is disposed on unmount.
import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomBuilder } from '../../../../salim-inn/src/interiors/RoomBuilder';
import { Z_CORRIDOR, Z_FACADE, ROOM_HEIGHT } from '../../../../salim-inn/src/interiors/roomLayouts';
import type { ModelCode } from './roomMedia';

interface Props { code: ModelCode; height: number; label: string; hint: string; unsupported: string }

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function dispose(root: THREE.Object3D): void {
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !seen.has(mesh.geometry)) { seen.add(mesh.geometry); mesh.geometry.dispose(); }
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && !seen.has(v)) { seen.add(v); v.dispose(); }
      m.dispose();
    }
  });
}

const RoomModel3D: React.FC<Props> = ({ code, height, label, hint, unsupported }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (webglAvailable() ? 'loading' : 'error'));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webglAvailable()) return undefined;
    let raf = 0;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1714);
    const room = new RoomBuilder(code);
    room.select(code, true);
    room.group.position.set(0, 0, 0);
    room.setLights(1);
    room.setDoor(0);
    // a dollhouse: no lid
    room.group.traverse((o) => { if (o.name === 'room-ceiling' || o.name.startsWith('bulk')) o.visible = false; });
    scene.add(room.group);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3128, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(-4, 8, -6);
    scene.add(sun);

    const w = room.currentWidth;
    const centre = new THREE.Vector3(-w / 2, ROOM_HEIGHT * 0.32, (Z_CORRIDOR + Z_FACADE) / 2);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
    const span = Math.max(w, Z_FACADE - Z_CORRIDOR);
    // start outside the corridor/left corner, looking in and down
    camera.position.copy(centre).add(new THREE.Vector3(-0.55, 0.75, -0.75).normalize().multiplyScalar(span * 1.25));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(centre);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = span * 0.6;
    controls.maxDistance = span * 1.9;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = 1.25;
    // keep to the open (cut-away) side: azimuth between the left wall and the corridor wall
    controls.minAzimuthAngle = -Math.PI + 0.15;
    controls.maxAzimuthAngle = -Math.PI / 2 - 0.15;
    controls.update();

    const local = new THREE.Vector3();
    const resize = () => {
      const width = host.clientWidth || 1;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = `${height}px`;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = Boolean(e?.isIntersecting); });
    io.observe(host);
    const clock = new THREE.Clock();
    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      controls.update();
      room.update(clock.getDelta());
      room.group.worldToLocal(local.copy(camera.position));
      room.cutawayFor(local);
      renderer.render(scene, camera);
    };
    tick();
    setState('ready');

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      dispose(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [code, height]);

  return (
    <Box sx={{ position: 'relative', height, bgcolor: '#0f1714' }}>
      <Box ref={hostRef} role="img" aria-label={label} sx={{ position: 'absolute', inset: 0, cursor: 'grab', '&:active': { cursor: 'grabbing' } }} />
      {state === 'loading' && <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} sx={{ color: 'var(--hotel-primary, #d9b572)' }} /></Box>}
      {state === 'error' && <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', p: 2 }}><Typography variant="body2" sx={{ color: '#e8e2d6', textAlign: 'center' }}>{unsupported}</Typography></Box>}
      {state === 'ready' && <Typography variant="caption" sx={{ position: 'absolute', left: 10, bottom: 8, px: 1, py: 0.25, borderRadius: 1, bgcolor: 'rgba(6,17,14,0.6)', color: '#e8e2d6', pointerEvents: 'none' }}>{hint}</Typography>}
    </Box>
  );
};

export default RoomModel3D;
