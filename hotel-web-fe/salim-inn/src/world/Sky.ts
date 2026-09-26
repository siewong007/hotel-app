// Dusk atmosphere: an art-directed dusk sky (warm glow on the sunset side, a
// pink Belt of Venus over a blue earth-shadow on the far side, deep-blue
// zenith) → PMREM for exterior reflections; a low warm sun in the west with a
// camera-following shadow frustum; hemisphere fill; height-aware haze; and a
// sparse cloud deck the opening shot looks down on before descending through.
import * as THREE from 'three';

// Late-September sunset at Sibu (2.3° N) sits just south of due west.
const SUN_AZIMUTH = 262; // compass degrees (the key light, a touch south of west so WNW facades rake)
const SKY_SUN_ELEVATION = 2.2; // the visible sun disc / glow
const LIGHT_ELEVATION = 19; // the key light is lifted for readable shadows at golden hour
const CLOUD_ALT = 1100;

/** The dusk look, golden hour (…0) → blue hour (…1). Mutable so look-dev
 *  renders can try variants (perf/look.ts --variants). */
export const LOOK = {
  sunI: [5.0, 2.5], sunG: [0.75, 0.53], sunB: [0.47, 0.27], sunEl: [LIGHT_ELEVATION, 6.5],
  hemiI: [1.05, 0.58], hemiSky: [[0.64, 0.71, 0.9], [0.43, 0.49, 0.8]], hemiGround: [0x6e563c, 0x44383a],
  skyI: [1.0, 0.55], envI: [0.8, 0.46],
  fog: [[0.36, 0.32, 0.38], [0.2, 0.19, 0.27]],
};

function dirFrom(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  // compass: north = −Z, east = +X
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDir = w.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_Position.z = gl_Position.w; // on the far plane
  }`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uZenith, uUpper, uHorizonSun, uHorizonAnti, uBelt, uShadow, uGround, uGlow;
  uniform float uIntensity;
  varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    float el = d.y;
    vec2 hz = normalize(d.xz + 1e-5);
    // clamp: pow() of a float-error negative is NaN, and one NaN texel poisons the whole PMREM
    float toward = clamp(dot(hz, normalize(uSunDir.xz)) * 0.5 + 0.5, 0.0, 1.0); // 0 anti-solar … 1 solar
    float h = max(el, 0.0);
    vec3 horizon = mix(uHorizonAnti, uHorizonSun, pow(toward, 2.4));
    vec3 col = mix(horizon, uUpper, smoothstep(0.0, 0.32, h));
    col = mix(col, uZenith, smoothstep(0.28, 0.95, h));
    // earth shadow (blue) hugging the anti-solar horizon, Belt of Venus above it
    float anti = pow(max(1.0 - toward, 0.0), 1.6);
    col = mix(col, uShadow, anti * (1.0 - smoothstep(0.0, 0.055, h)) * 0.7);
    col = mix(col, uBelt, anti * smoothstep(0.035, 0.09, h) * (1.0 - smoothstep(0.11, 0.3, h)) * 0.6);
    // sun glow and disc
    float c = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
    col += uGlow * (pow(c, 6.0) * 0.55 + pow(c, 48.0) * 1.2 + smoothstep(0.99955, 0.9998, c) * 14.0);
    // below the horizon: the haze the ground fades into
    col = mix(col, uGround, smoothstep(0.0, -0.06, el));
    gl_FragColor = vec4(col * uIntensity, 1.0);
    #include <colorspace_fragment>
  }`;

export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  readonly clouds: THREE.Mesh;
  envMap: THREE.Texture | null = null;
  readonly sunDir = dirFrom(SUN_AZIMUTH, LIGHT_ELEVATION);
  readonly skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private shadowSize = 120;
  private tmpC = new THREE.Color();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const col = (hex: number) => new THREE.Color(hex);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uSunDir: { value: dirFrom(SUN_AZIMUTH + 3, SKY_SUN_ELEVATION) },
        uZenith: { value: col(0x1d2c55) },
        uUpper: { value: col(0x4f6699) },
        uHorizonSun: { value: col(0xf7a86f) },
        uHorizonAnti: { value: col(0xa99bb6) },
        uBelt: { value: col(0xd9a2a9) },
        uShadow: { value: col(0x5b6a92) },
        uGround: { value: col(0x7d7887) },
        uGlow: { value: col(0xffb775) },
        uIntensity: { value: 1.0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffc995, 3.6);
    this.sun.position.copy(this.sunDir).multiplyScalar(600);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 2400;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xb4c6e2, 0x5a4a38, 0.85);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0x938ea0, 0.00016);
    scene.fog = this.fog;

    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunDir.clone() },
        uCam: { value: new THREE.Vector3() },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main(){
          vec4 w = modelMatrix * vec4(position,1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uCam; uniform float uOpacity;
        varying vec3 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.07+13.7; a*=0.5; } return v; }
        void main(){
          vec2 q = vWorld.xz * 0.0011 + vec2(uTime * 0.006, uTime * 0.002);
          vec2 warp = vec2(fbm(q + 3.1), fbm(q + 7.9));
          float n = fbm(q + warp * 1.4);
          float cover = smoothstep(0.58, 0.82, n);
          float dcam = length(vWorld - uCam);
          float farFade = 1.0 - smoothstep(3500.0, 9000.0, dcam);
          float hole = smoothstep(700.0, 1800.0, length(vWorld.xz - vec2(40.0, -60.0)));
          float a = cover * farFade * hole * 0.9 * uOpacity;
          if (a < 0.004) discard;
          // lit tops: warm where thick, lilac where thin
          float thick = smoothstep(0.62, 0.9, n);
          vec3 warm = vec3(1.0, 0.78, 0.6);
          vec3 cool = vec3(0.66, 0.62, 0.74);
          vec3 col = mix(cool, warm, 0.35 + 0.65 * thick) * 1.15;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000, 1, 1).rotateX(-Math.PI / 2), this.cloudMat);
    this.clouds.position.y = CLOUD_ALT;
    this.clouds.renderOrder = 5;
    this.clouds.frustumCulled = false;
    this.clouds.name = 'clouds';
    scene.add(this.clouds);
  }

  /** Golden hour (0) → blue hour (1): sun lower, warmer and dimmer; sky and
   *  haze deepen; reflections dim. The baked environment stays (intensity only). */
  setDusk(d: number): void {
    const L = THREE.MathUtils.lerp;
    const k = LOOK;
    const el = L(k.sunEl[0], k.sunEl[1], d);
    this.sunDir.copy(dirFrom(SUN_AZIMUTH, el));
    this.sun.intensity = L(k.sunI[0], k.sunI[1], d);
    this.sun.color.setRGB(1, L(k.sunG[0], k.sunG[1], d), L(k.sunB[0], k.sunB[1], d));
    this.hemi.intensity = L(k.hemiI[0], k.hemiI[1], d);
    this.hemi.color.setRGB(L(k.hemiSky[0][0], k.hemiSky[1][0], d), L(k.hemiSky[0][1], k.hemiSky[1][1], d), L(k.hemiSky[0][2], k.hemiSky[1][2], d));
    this.hemi.groundColor.setHex(k.hemiGround[0]).lerp(this.tmpC.setHex(k.hemiGround[1]), d);
    const u = this.skyMat.uniforms;
    u.uIntensity.value = L(k.skyI[0], k.skyI[1], d);
    u.uSunDir.value.copy(dirFrom(SUN_AZIMUTH + 3, L(SKY_SUN_ELEVATION, -1.2, d)));
    this.fog.color.setRGB(L(k.fog[0][0], k.fog[1][0], d), L(k.fog[0][1], k.fog[1][1], d), L(k.fog[0][2], k.fog[1][2], d));
    this.scene.environmentIntensity = L(k.envI[0], k.envI[1], d);
  }

  /** Bake the sky into a prefiltered environment for PBR reflections. */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const mat = this.skyMat.clone();
    mat.depthTest = true;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
    envScene.add(dome);
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 1000);
    pmrem.dispose();
    dome.geometry.dispose();
    mat.dispose();
    this.envMap = rt.texture;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.7;
    return rt.texture;
  }

  setShadowResolution(size: number): void {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Keep the shadow frustum tight around what the camera is looking at. */
  update(dt: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3): void {
    this.cloudMat.uniforms.uTime.value += dt;
    this.cloudMat.uniforms.uCam.value.copy(camera.position);
    const dist = camera.position.distanceTo(focus);
    const target = THREE.MathUtils.clamp(dist * 0.85, 28, 520);
    this.shadowSize += (target - this.shadowSize) * Math.min(1, dt * 3);
    const s = this.shadowSize;
    const sc = this.sun.shadow.camera;
    // snap the frustum centre to shadow texels to avoid shimmering
    const texel = (2 * s) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 900);
    if (sc.right !== s) {
      sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
      sc.updateProjectionMatrix();
    }
    // Haze: denser near the ground, where the views are short and need the
    // depth cue; thinner from high up, where the sight lines run for kilometres.
    const h = camera.position.y;
    this.fog.density = THREE.MathUtils.lerp(0.00024, 0.000115, THREE.MathUtils.smoothstep(h, 40, 900));
    // Cloud deck: full above it, dissolving as the camera passes through.
    const gap = Math.abs(h - CLOUD_ALT);
    this.cloudMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(gap, 60, 260) * THREE.MathUtils.smoothstep(h, 300, 700);
    this.clouds.visible = h > 250;
    // The sky dome rides with the camera (always inside the far plane).
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(Math.max(10, camera.far * 0.9));
  }
}
