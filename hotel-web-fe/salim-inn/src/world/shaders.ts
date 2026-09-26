// Shared material patches (onBeforeCompile) and the global uniforms they
// read. Everything procedural is driven by world position, so no texture
// downloads are needed (brief §4.6 allows generated textures).
import * as THREE from 'three';

/** Shared, animated uniforms (one object, referenced by every patch). */
export const GLOBAL = {
  uTime: { value: 0 },
  uDusk: { value: 0 }, // 0 golden hour … 1 blue hour; drives city lights
  uLights: { value: 0 }, // 0..1 practical lights (signage, windows, lamps)
};

const NOISE = /* glsl */ `
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
  float fbm3(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.13+7.1)*0.3 + vnoise(p*4.37+3.3)*0.15; }
`;

function addCommon(shader: THREE.WebGLProgramParametersWithUniforms, worldVarying = true) {
  Object.assign(shader.uniforms, GLOBAL);
  if (worldVarying) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  #ifdef USE_INSTANCING\n  vW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n  #endif\n  #ifdef USE_BATCHING\n  vW = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;\n  #endif');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW;\nuniform float uTime; uniform float uDusk; uniform float uLights;\n${NOISE}`);
  }
}

function patch(mat: THREE.Material, key: string, fn: (s: THREE.WebGLProgramParametersWithUniforms) => void): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    prev?.call(mat, s, r);
    fn(s);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
}

/** Weathered asphalt: patches, stains, fine grain; roughness varies with it. */
export function asphalt(mat: THREE.MeshStandardMaterial, scale = 1): THREE.MeshStandardMaterial {
  patch(mat, `asphalt${scale}`, (s) => {
    addCommon(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vW.xz * ${(0.22 * scale).toFixed(3)};
        float patches = smoothstep(0.35, 0.75, fbm3(q * 0.18));
        float grain = vnoise(vW.xz * 7.0) * 0.6 + vnoise(vW.xz * 19.0) * 0.4;
        float stain = smoothstep(0.62, 0.9, fbm3(q * 0.9 + 11.0));
        diffuseColor.rgb *= mix(0.86, 1.13, patches) * (0.9 + 0.2 * grain) * (1.0 - 0.28 * stain);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.92 + 0.12 * grain) - 0.25 * stain, 0.35, 1.0);`);
  });
  return mat;
}

/** Plaster / painted render: low-frequency staining and rain streaks. */
export function plaster(mat: THREE.MeshStandardMaterial, amount = 1): THREE.MeshStandardMaterial {
  patch(mat, `plaster${amount}`, (s) => {
    addCommon(s);
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float st = fbm3(vec2(vW.x + vW.z, vW.y * 0.25) * 0.9);
      float streak = vnoise(vec2((vW.x + vW.z) * 3.1, vW.y * 0.12)) * smoothstep(0.0, 3.0, vW.y);
      diffuseColor.rgb *= 1.0 - ${(0.07 * amount).toFixed(3)} * st - ${(0.06 * amount).toFixed(3)} * streak * streak;`);
  });
  return mat;
}

/** Grass / ground cover: clumpy colour variation. */
export function grass(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  patch(mat, 'grass', (s) => {
    addCommon(s);
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float g1 = fbm3(vW.xz * 0.08);
      float g2 = vnoise(vW.xz * 1.3);
      vec3 dry = vec3(0.52, 0.5, 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb * (0.82 + 0.3 * g2), dry * 0.55, smoothstep(0.55, 0.85, g1) * 0.45);`);
  });
  return mat;
}

/** Worn road/bay paint: fades toward the asphalt where the noise says so. */
export function wornPaint(mat: THREE.MeshStandardMaterial, base = new THREE.Color(0x4f5254)): THREE.MeshStandardMaterial {
  patch(mat, 'wornPaint', (s) => {
    addCommon(s);
    s.uniforms.uBase = { value: base };
    s.fragmentShader = s.fragmentShader
      .replace('uniform float uTime;', 'uniform float uTime; uniform vec3 uBase;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wear = smoothstep(0.35, 0.8, fbm3(vW.xz * 1.7)) * 0.75 + vnoise(vW.xz * 11.0) * 0.25;
        diffuseColor.rgb = mix(diffuseColor.rgb, uBase, clamp(wear * 0.85, 0.0, 0.85));`);
  });
  return mat;
}

/** Foliage: clumped colour variation, darker inside, sun translucency. */
export function foliage(mat: THREE.MeshStandardMaterial, sunDir: THREE.Vector3): THREE.MeshStandardMaterial {
  patch(mat, 'foliage', (s) => {
    addCommon(s);
    s.uniforms.uSun = { value: sunDir };
    s.fragmentShader = s.fragmentShader
      .replace('uniform float uTime;', 'uniform float uTime; uniform vec3 uSun;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float clump = vnoise(vW.xz * 0.9 + vW.y * 0.7) * 0.6 + vnoise(vW.xz * 3.7 - vW.y * 2.1) * 0.4;
        float leaf = vnoise(vW.xz * 13.0 + vW.y * 11.0) * 0.6 + vnoise(vW.zy * 29.0 - vW.x * 7.0) * 0.4;
        diffuseColor.rgb *= (0.8 + 0.34 * clump) * (0.84 + 0.3 * leaf);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // leafy micro-relief: a jittered shading normal catches the low sun in flecks
        vec3 jit = vec3(vnoise(vW.xy * 5.3), vnoise(vW.yz * 5.9 + 3.1), vnoise(vW.zx * 6.7 + 7.7)) - 0.5;
        normal = normalize(normal + jit * 0.9);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 V = normalize(cameraPosition - vW);
        float back = pow(clamp(dot(-V, normalize(uSun)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.85, 0.45) * back * 0.35;`);
  });
  return mat;
}

/** Corrugated metal: ridges along local X perturb the normal. */
export function corrugated(mat: THREE.MeshStandardMaterial, pitch = 0.076): THREE.MeshStandardMaterial {
  patch(mat, `corr${pitch}`, (s) => {
    addCommon(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float ph = (vW.x * 0.7 + vW.z * 0.7) * ${(6.2832 / pitch).toFixed(3)};
        // fade the ridges out before they alias (moiré on distant roofs)
        float ridgeAA = 1.0 - smoothstep(0.8, 2.4, fwidth(ph));
        normal = normalize(normal + vec3(cos(ph), 0.0, 0.0) * 0.12 * ridgeAA);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.9 + 0.18 * fbm3(vW.xz * 0.35) - 0.08 * smoothstep(0.6, 0.9, vnoise(vW.xz * 0.9));`);
  });
  return mat;
}

/**
 * Interior-mapped windows: a fake room box behind each pane (brief §5: "lit
 * room cards with parallax offset so windows don't look painted on"). Needs
 * per-vertex attributes aWin (0..1 across the pane), aSeed (per-window
 * random) and aTan (the facade's horizontal direction, world space).
 */
export function interiorWindows(mat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial, opts: { depth?: number; litShare?: number; warm?: THREE.ColorRepresentation; size?: [number, number]; levels?: { value: number } } = {}): typeof mat {
  const depth = opts.depth ?? 3.2; // room depth, metres
  const size = opts.size ?? [2.8, 1.5]; // typical pane width × height, metres
  const lit = opts.litShare ?? 0.62;
  const warm = new THREE.Color(opts.warm ?? 0xffc98e);
  patch(mat, `interior${depth}${lit}${size.join('x')}`, (s) => {
    addCommon(s);
    s.uniforms.uWarm = { value: warm };
    s.uniforms.uLevelOn = opts.levels ?? { value: 99 };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWin; attribute float aSeed; attribute vec3 aTan;\nvarying vec2 vWin; varying float vSeed; varying vec3 vTan; varying vec3 vNrmW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWin = aWin; vSeed = aSeed; vTan = normalize(mat3(modelMatrix) * aTan); vNrmW = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('uniform float uTime;', 'uniform float uTime; uniform vec3 uWarm; uniform float uLevelOn;\nvarying vec2 vWin; varying float vSeed; varying vec3 vTan; varying vec3 vNrmW;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 N = normalize(vNrmW);
          vec3 T = normalize(vTan);
          vec3 B = normalize(cross(N, T));
          vec3 Vw = normalize(vW - cameraPosition);
          // ray in room space: x across, y up, z into the room (−N)
          vec3 rd = vec3(dot(Vw, T) / ${size[0].toFixed(2)}, dot(Vw, B) / ${size[1].toFixed(2)}, -dot(Vw, N) / ${depth.toFixed(2)});
          vec3 ro = vec3(vWin, 0.0);
          float D = 1.0;
          vec3 tA = (vec3(0.0, 0.0, D) - ro) / rd;
          vec3 tB = (vec3(1.0, 1.0, D) - ro) / rd;
          vec3 tMax = max(tA, tB);
          float t = min(min(tMax.x, tMax.y), tMax.z);
          vec3 hit = ro + rd * t;
          float r = fract(vSeed * 91.7);
          vec3 wall = mix(vec3(0.86, 0.82, 0.74), vec3(0.72, 0.78, 0.8), step(0.6, fract(vSeed * 13.1)));
          vec3 col;
          if (t == tMax.z) col = wall * 0.95;                       // back wall
          else if (t == tMax.x) col = wall * 0.78;                  // side walls
          else col = hit.y < 0.5 ? vec3(0.42, 0.33, 0.25) : vec3(0.95); // floor / ceiling
          // a lamp glow on the back wall + a bed/cupboard silhouette
          float lamp = exp(-8.0 * length(hit.xy - vec2(fract(vSeed * 7.3) * 0.6 + 0.2, 0.62)));
          col *= 0.55 + 0.9 * lamp;
          float furniture = step(hit.y, 0.28) * step(0.15, hit.x) * step(hit.x, 0.85) * step(D * 0.45, hit.z);
          col = mix(col, vec3(0.3, 0.26, 0.22), furniture * 0.8);
          // curtains on some panes
          float curtain = step(0.55, fract(vSeed * 3.7)) * smoothstep(0.0, 0.02, vWin.x - 0.62 - 0.2 * fract(vSeed * 5.3));
          col = mix(col, vec3(0.93, 0.88, 0.78), curtain * 0.9);
          float on = step(r, ${lit.toFixed(2)}) * uLights * step(vW.y, uLevelOn);
          totalEmissiveRadiance += col * uWarm * on * 1.25;
          // daytime: a dim view of the room through the glass
          diffuseColor.rgb = mix(diffuseColor.rgb, col * 0.18, 0.55);
        }`);
  });
  return mat;
}

/** Procedural lit windows for massing (far field, mid rows): a window grid
 *  in local metres (needs aLocal = local-space position in metres). */
export function cityWindows(mat: THREE.MeshStandardMaterial, opts: { floor?: number; bay?: number; sill?: number; share?: number } = {}): THREE.MeshStandardMaterial {
  const floor = opts.floor ?? 3.2, bay = opts.bay ?? 3.0, share = opts.share ?? 0.45;
  patch(mat, `cityWin${floor}${bay}${share}`, (s) => {
    addCommon(s);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalM; varying float vInst; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObjN = normal;
        #ifdef USE_INSTANCING
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vLocalM = position * sc; vInst = float(gl_InstanceID);
        #else
          vLocalM = position; vInst = 0.0;
        #endif`);
    s.fragmentShader = s.fragmentShader
      .replace('uniform float uTime;', 'uniform float uTime;\nvarying vec3 vLocalM; varying float vInst; varying vec3 vObjN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // walls only (skip roofs)
          float wallish = 1.0 - step(0.6, abs(vObjN.y));
          float u = (abs(vObjN.x) > abs(vObjN.z) ? vLocalM.z : vLocalM.x);
          vec2 cell = vec2(floor(u / ${bay.toFixed(2)}), floor((vLocalM.y - 0.9) / ${floor.toFixed(2)}));
          vec2 f = vec2(fract(u / ${bay.toFixed(2)}), fract((vLocalM.y - 0.9) / ${floor.toFixed(2)}));
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.7) * step(0.5, vLocalM.y);
          float rnd = h12(cell + vInst * 1.37);
          float on = step(rnd, ${share.toFixed(2)}) * uLights;
          vec3 lampCol = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.75, h12(cell * 3.1 + vInst)));
          totalEmissiveRadiance += lampCol * win * on * wallish * 1.6;
          diffuseColor.rgb *= 1.0 - win * wallish * 0.55;
        }`);
  });
  return mat;
}

/**
 * Canopy downlights without light objects: each light is a downward ~45° cone
 * (2,700 K); a surface gets irradiance cone × cos / r², which draws warm pools
 * on the floor and the classic scallops on the wall behind. `on` counts the
 * lights up in sequence (the same counter as their emissive discs); `toLocal`
 * maps world → the building frame for a cheap bounding-box early-out.
 */
export interface Wash { lights: THREE.Vector3[]; on: { value: number }; toLocal: THREE.Matrix4; box: THREE.Vector4; intensity: number }
export function downlightWash(mat: THREE.MeshStandardMaterial, w: Wash): THREE.MeshStandardMaterial {
  const n = w.lights.length;
  patch(mat, `wash${n}`, (s) => {
    if (!s.vertexShader.includes('varying vec3 vW;')) addCommon(s);
    s.uniforms.uDL = { value: w.lights };
    s.uniforms.uDLOn = w.on;
    s.uniforms.uDLToLocal = { value: w.toLocal };
    s.uniforms.uDLBox = { value: w.box };
    s.uniforms.uDLK = { value: w.intensity };
    s.fragmentShader = s.fragmentShader
      .replace('uniform float uTime;', `uniform float uTime; uniform vec3 uDL[${n}]; uniform float uDLOn; uniform mat4 uDLToLocal; uniform vec4 uDLBox; uniform float uDLK;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (uDLOn > 0.0) {
          vec3 lp = (uDLToLocal * vec4(vW, 1.0)).xyz;
          if (lp.x > uDLBox.x && lp.x < uDLBox.y && lp.z > uDLBox.z && lp.z < uDLBox.w && lp.y < 4.0) {
            vec3 nW = inverseTransformDirection(normal, viewMatrix);
            vec3 acc = vec3(0.0);
            for (int i = 0; i < ${n}; i++) {
              vec3 D = vW - uDL[i];
              float r2 = dot(D, D);
              if (r2 > 42.0) continue;
              vec3 dir = D * inversesqrt(r2);
              float cone = smoothstep(0.64, 0.9, -dir.y);
              float lam = max(dot(nW, -dir), 0.0);
              acc += vec3(cone * lam * clamp(uDLOn - float(i), 0.0, 1.0) / (r2 + 0.35));
            }
            reflectedLight.directDiffuse += material.diffuseColor * acc * vec3(1.0, 0.72, 0.45) * uDLK;
          }
        }`);
  });
  return mat;
}

/** Lightbox shop signboards (rows): off-white face, a band of blocky generic
 *  "lettering" in the board colour (vertex colour), warm backlight at dusk.
 *  The board's own axis comes from its world normal. */
export function signBoards(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  patch(mat, 'signboards', (s) => {
    addCommon(s);
    s.fragmentShader = s.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nW = normalize(cross(dFdx(vW), dFdy(vW))); // face normal (normal is not set up yet here)
        vec3 Tn = normalize(vec3(nW.z, 0.0, -nW.x) + 1e-5);
        float along = dot(vW, Tn);
        float yy = vW.y;
        float face = step(0.5, abs(nW.x) + abs(nW.z)) * step(abs(nW.y), 0.5);
        float band = smoothstep(3.84, 3.87, yy) * (1.0 - smoothstep(4.3, 4.33, yy));
        float cellX = along * 2.4;
        float glyph = step(0.3, h12(vec2(floor(cellX), floor(yy * 5.0) + 17.0))) * step(fract(cellX), 0.74);
        float word = step(0.22, h12(vec2(floor(along * 0.52), 5.0)));
        float trim = step(yy, 3.72) + step(4.48, yy);
        float ink = face * max(band * glyph * word, trim);
        vec3 boardCol = diffuseColor.rgb;
        vec3 paper = mix(vec3(0.93, 0.92, 0.88), boardCol, 0.12);
        diffuseColor.rgb = mix(paper, boardCol * 0.85, ink);
        vec3 signGlow = mix(vec3(1.0, 0.9, 0.74), boardCol * 0.55, ink);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= signGlow;');
  });
  return mat;
}
