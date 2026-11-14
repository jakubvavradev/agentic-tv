// VAVRA OS – live 3D landscape: real terrain (AWS Terrain Tiles + Sentinel-2 cloudless), real sun position,
// season (snow line, vegetation tint) and current weather (clouds, fog, rain, snow, lightning).
// Drawn as two WebGL layers so HTML (the glass clock) can sit *between* far mountains and the near peak.
import * as THREE from 'three';
import { Sky } from './vendor/Sky.js';

const rad = Math.PI / 180;

// ---------------------------------------------------------------- astronomy (good to ~0.5°)
export function sunPosition(date, lat, lon) {
  const d = date / 864e5 - 10957.5;                                    // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = ((18.697374558 + 24.06570982441908 * d) * 15 + lon) * rad - ra;
  const φ = lat * rad;
  const el = Math.asin(Math.sin(φ) * Math.sin(dec) + Math.cos(φ) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(φ) - Math.sin(φ) * Math.cos(H));   // from north, clockwise
  return { el, az, dir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)) };
}

// ---------------------------------------------------------------- seasons: [day of year, snow line m, vegetation tint]
const SEASONS = [[0, 1100, [0.92, 0.94, 1.0]], [60, 1300, [0.94, 0.95, 0.98]], [110, 2200, [0.98, 1.04, 0.94]],
  [170, 3100, [1.0, 1.02, 0.96]], [230, 3400, [1.03, 1.0, 0.92]], [280, 3000, [1.12, 0.98, 0.82]],
  [320, 2350, [1.04, 0.96, 0.88]], [350, 1500, [0.95, 0.95, 0.98]], [366, 1100, [0.92, 0.94, 1.0]]];
function season(date) {
  const doy = (date - new Date(date.getFullYear(), 0, 0)) / 864e5;
  const i = SEASONS.findIndex((s, j) => doy >= s[0] && doy < SEASONS[j + 1][0]);
  const [d0, s0, t0] = SEASONS[i], [d1, s1, t1] = SEASONS[i + 1], t = (doy - d0) / (d1 - d0);
  return { snowLine: s0 + (s1 - s0) * t, tint: t0.map((v, k) => v + (t1[k] - v) * t) };
}

// ---------------------------------------------------------------- WMO weather code -> visual parameters
function weatherFx(w) {
  const c = w ? w.code : 1, clouds = w ? w.clouds / 100 : 0.3;
  const rain = (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95 ? (c % 10 >= 5 || c >= 63 ? 1 : 0.5) : 0;
  const snow = (c >= 71 && c <= 77) || c === 85 || c === 86 ? (c === 75 || c === 86 ? 1 : 0.55) : 0;
  return { clouds: Math.max(clouds, rain || snow ? 0.85 : 0), rain, snow, storm: c >= 95,
           fog: c === 45 || c === 48 ? 1 : rain || snow ? 0.45 : clouds * 0.25, wind: w ? w.wind : 8,
           cold: w ? w.t <= 1 : false };
}

// ---------------------------------------------------------------- GLSL bits
const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*vnoise(p); p *= 2.03; a *= 0.5; } return v; }`;

export async function createScene(bgCanvas, fgCanvas) {
  const meta = await (await fetch('terrain/meta.json')).json();
  // levels of detail: "peak" (swissALTI3D 2 m + aerial photo), "near" (peak surroundings + foreground), "far" (distant ranges)
  async function level(name, skirt = 0) {
    const L = meta[name];
    const H16 = new Uint16Array(await (await fetch(`terrain/${name}.bin`)).arrayBuffer());
    const tex = await new THREE.TextureLoader().loadAsync(`terrain/${name}.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const G = L.grid, geo = new THREE.PlaneGeometry(L.size, L.size, G - 1, G - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(L.center[0], 0, L.center[1]);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const gx = i % G, gy = (i / G) | 0, edge = gx === 0 || gy === 0 || gx === G - 1 || gy === G - 1;
      pos.setY(i, L.min + H16[i] / 10 - (edge ? skirt : 0));        // skirt: edge tucks under the coarser level, no cracks
    }
    geo.computeVertexNormals();
    const hAt = (gx, gy) => L.min + H16[Math.max(0, Math.min(G - 1, gy)) * G + Math.max(0, Math.min(G - 1, gx))] / 10;
    const heightAt = (x, z) => {
      const fx = ((x - L.center[0]) / L.size + 0.5) * (G - 1), fz = ((z - L.center[1]) / L.size + 0.5) * (G - 1);
      const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
      return hAt(ix, iz) * (1 - tx) * (1 - tz) + hAt(ix + 1, iz) * tx * (1 - tz) + hAt(ix, iz + 1) * (1 - tx) * tz + hAt(ix + 1, iz + 1) * tx * tz;
    };
    let top = 0;
    for (const h of H16) top = Math.max(top, h);
    return { L, geo, tex, heightAt, top: L.min + top / 10 };
  }
  const [peak, near, far] = await Promise.all([meta.peak ? level('peak', 60) : null, level('near', 120), level('far')]);
  const holeOf = (L, inset) => new THREE.Vector4(L.center[0] - L.size / 2 + inset, L.center[1] - L.size / 2 + inset,
                                                  L.center[0] + L.size / 2 - inset, L.center[1] + L.size / 2 - inset);
  // each coarser level skips the square a finer one covers (inset one coarse cell so they overlap instead of cracking)
  const nearHole = holeOf(meta.near, 2.5 * meta.near.size / meta.near.grid);
  const peakHole = peak ? holeOf(meta.peak, 2.5 * meta.peak.size / meta.peak.grid) : new THREE.Vector4(1, 1, -1, -1);
  const inPeak = (x, z) => peak && Math.abs(x) < meta.peak.size / 2 && Math.abs(z) < meta.peak.size / 2;
  const heightAtWorld = (x, z) => (inPeak(x, z) ? peak : near).heightAt(x, z);

  // ---- camera: classic view from Zermatt side (ENE), telephoto so the peak looms
  const peakY = (peak || near).top;
  const camAz = meta.cam[0] * rad, camDist = meta.cam[1];
  const camBase = new THREE.Vector3(Math.sin(camAz) * camDist, 0, -Math.cos(camAz) * camDist);
  camBase.y = Math.max(heightAtWorld(camBase.x, camBase.z) + 80, 2750);
  const target = new THREE.Vector3(0, peakY - 980, 0);
  const camera = new THREE.PerspectiveCamera(25, innerWidth / innerHeight, 20, 400000);

  // ---- split plane: everything farther than the peak (+ margin) is "background", nearer is "foreground"
  const fwd = target.clone().sub(camBase).setY(0).normalize();
  const splitDist = camDist + 900;
  const farPlane = new THREE.Plane(fwd.clone(), -(fwd.dot(camBase) + splitDist));
  const nearPlane = new THREE.Plane(fwd.clone().negate(), fwd.dot(camBase) + splitDist);

  const uniforms = { uSnowLine: { value: 2500 }, uSnowAmt: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uWet: { value: 0 } };
  function terrainMaterial(plane, tex, hole) {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0, clippingPlanes: [plane] });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms, { uHole: { value: hole || new THREE.Vector4(1, 1, -1, -1) } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>',
        `#include <common>\nvarying vec3 vW; varying vec3 vWN; uniform float uSnowLine, uSnowAmt, uWet; uniform vec3 uTint; uniform vec4 uHole;${NOISE}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (vW.x > uHole.x && vW.x < uHole.z && vW.z > uHole.y && vW.z < uHole.w) discard;
          diffuseColor.rgb *= uTint;
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float n = fbm(vW.xz * 0.004) * 260.0 - 130.0;
          float flatness = smoothstep(0.42, 0.78, vWN.y);
          float snow = max(smoothstep(uSnowLine - 220.0, uSnowLine + 220.0, vW.y + n), uSnowAmt * 0.85) * flatness;
          snow = clamp(snow + smoothstep(0.7, 0.88, lum) * 0.15, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), snow);
          diffuseColor.rgb *= 1.0 - uWet * 0.25;`);
    };
    return m;
  }

  // ---- two renderers, two scenes sharing camera, lights are per scene
  const mk = (canvas, alpha) => {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.localClippingEnabled = true;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    if (alpha) r.setClearColor(0x000000, 0);
    return r;
  };
  const bgR = mk(bgCanvas, false), fgR = mk(fgCanvas, true);
  const bg = new THREE.Scene(), fg = new THREE.Scene();

  const lights = [bg, fg].map((sc, i) => {
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const hs = meta.near.size / 2;                                   // shadows only where detail is
    Object.assign(sun.shadow.camera, { left: -hs, right: hs, top: hs, bottom: -hs, near: 100, far: 80000 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 25;
    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4a4136, 0.8);
    const plane = i ? nearPlane : farPlane;
    const nm = new THREE.Mesh(near.geo, terrainMaterial(plane, near.tex, peakHole));
    nm.castShadow = nm.receiveShadow = true;
    const fm = new THREE.Mesh(far.geo, terrainMaterial(plane, far.tex, nearHole));
    sun.target.position.set(meta.near.center[0], 0, meta.near.center[1]);
    sc.add(sun, sun.target, hemi, nm, fm);
    if (peak) {
      const pm = new THREE.Mesh(peak.geo, terrainMaterial(plane, peak.tex, null));
      pm.castShadow = pm.receiveShadow = true;
      sc.add(pm);
    }
    return { sun, hemi };
  });

  // sky dome + stars + moon + clouds live in the background
  const sky = new Sky();
  sky.scale.setScalar(380000);
  bg.add(sky);
  const su = sky.material.uniforms;

  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 2600; i++) {
    const u = Math.random(), v = Math.random() * 0.95, th = 2 * Math.PI * u, ph = Math.acos(1 - v);
    sp.push(Math.sin(ph) * Math.cos(th) * 300000, Math.cos(ph) * 300000, Math.sin(ph) * Math.sin(th) * 300000);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
  bg.add(stars);

  const moonCv = document.createElement('canvas');
  moonCv.width = moonCv.height = 128;
  const mg = moonCv.getContext('2d'), grd = mg.createRadialGradient(54, 54, 8, 64, 64, 60);
  grd.addColorStop(0, '#fffdf2'); grd.addColorStop(0.75, '#d9d6c8'); grd.addColorStop(1, 'rgba(210,210,200,0)');
  mg.fillStyle = grd; mg.beginPath(); mg.arc(64, 64, 60, 0, 7); mg.fill();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(moonCv), fog: false, depthWrite: false, transparent: true }));
  moon.scale.setScalar(9000);
  bg.add(moon);

  // ---- volumetric clouds: ray-marched through a slab above the summit, in a quarter-resolution target,
  // composited behind the terrain. Noise comes from a tileable 3D texture (one fetch instead of 8 hashes).
  const NOISE3 = 64;
  function noiseTexture() {
    const n = NOISE3, data = new Uint8Array(n * n * n);
    const lattice = (p) => { const g = new Float32Array(p * p * p); for (let i = 0; i < g.length; i++) g[i] = Math.random(); return g; };
    const octaves = [[8, 0.55], [16, 0.28], [32, 0.17]].map(([p, a]) => ({ p, a, g: lattice(p) }));
    const sm = t => t * t * (3 - 2 * t);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = 0;
      for (const { p, a, g } of octaves) {
        const fx = x * p / n, fy = y * p / n, fz = z * p / n, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
        const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz), w = (i, j, k) => g[((iz + k) % p) * p * p + ((iy + j) % p) * p + ((ix + i) % p)];
        const l = (a0, a1, t) => a0 + (a1 - a0) * t;
        v += a * l(l(l(w(0, 0, 0), w(1, 0, 0), tx), l(w(0, 1, 0), w(1, 1, 0), tx), ty), l(l(w(0, 0, 1), w(1, 0, 1), tx), l(w(0, 1, 1), w(1, 1, 1), tx), ty), tz);
      }
      data[(z * n + y) * n + x] = Math.min(255, v * 255);
    }
    const t = new THREE.Data3DTexture(data, n, n, n);
    t.format = THREE.RedFormat; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.needsUpdate = true;
    return t;
  }
  const cloudRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  const cloudU = { uNoise: { value: noiseTexture() }, uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
    uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uAmb: { value: new THREE.Color() }, uCover: { value: 0.3 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0.3) },
    uBase: { value: peakY + 700 }, uTop: { value: peakY + 3200 }, uDens: { value: 1 } };
  const cloudScene = new THREE.Scene(), cloudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fullTri = new THREE.BufferGeometry();
  fullTri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const cloudMesh = new THREE.Mesh(fullTri, new THREE.ShaderMaterial({ uniforms: cloudU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float; precision highp sampler3D;
      uniform sampler3D uNoise; uniform mat4 uInvProj, uInvView; uniform vec3 uCam, uSun, uSunCol, uAmb;
      uniform float uCover, uTime, uBase, uTop, uDens; uniform vec2 uWind; varying vec2 vUv;
      float hg(float c, float g){ float g2 = g*g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0*g*c, 1.5)); }
      float dens(vec3 p, bool detail){
        float h = (p.y - uBase) / (uTop - uBase);
        if (h < 0.0 || h > 1.0) return 0.0;
        vec3 q = p * 0.000045 + vec3(uWind.x, 0.0, uWind.y) * uTime * 0.004;
        float shape = texture(uNoise, q * vec3(1.0, 2.2, 1.0)).r;
        float profile = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.35 + 0.4 * uCover, h);
        float d = (shape - mix(0.74, 0.3, uCover)) * profile;
        if (detail && d > 0.0) d -= (1.0 - texture(uNoise, q * 5.3 + 0.37).r) * 0.13 * (1.15 - h);
        return max(d, 0.0) * uDens;
      }
      void main(){
        vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); v /= v.w;
        vec3 rd = normalize((uInvView * vec4(v.xyz, 0.0)).xyz);
        if (rd.y < 0.004) { gl_FragColor = vec4(0.0); return; }
        float t0 = max((uBase - uCam.y) / rd.y, 0.0), t1 = min((uTop - uCam.y) / rd.y, t0 + 16000.0);
        if (t0 > 95000.0) { gl_FragColor = vec4(0.0); return; }
        const int STEPS = 26;
        float dt = (t1 - t0) / float(STEPS);
        float t = t0 + dt * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float mu = dot(rd, uSun), ph = 0.55 + mix(hg(mu, 0.8), hg(mu, -0.25), 0.4) * 9.0;   // isotropic base + silver lining
        float T = 1.0; vec3 col = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = uCam + rd * t;
          float d = dens(p, true);
          if (d > 0.002) {
            float ld = 0.0;
            for (int j = 1; j <= 3; j++) ld += dens(p + uSun * float(j * j) * 160.0, false);
            float h = (p.y - uBase) / (uTop - uBase);
            float beer = exp(-ld * 2.6), powder = 1.0 - exp(-d * 6.0);
            vec3 S = uSunCol * beer * ph * (0.35 + 0.65 * powder) * 3.2 + uAmb * (0.7 + 0.8 * h);
            float tr = exp(-d * dt * 0.0035);
            col += T * S * (1.0 - tr);
            T *= tr;
            if (T < 0.03) break;
          }
          t += dt;
        }
        float fade = 1.0 - smoothstep(38000.0, 92000.0, t0);
        gl_FragColor = vec4(col * fade, (1.0 - T) * fade);          // premultiplied
      }` }));
  cloudMesh.frustumCulled = false;
  cloudScene.add(cloudMesh);
  // composite quad drawn at the far plane: shows only where no terrain wrote depth
  const clouds = new THREE.Mesh(fullTri, new THREE.ShaderMaterial({ uniforms: { uTex: { value: cloudRT.texture } },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.99999, 1.0); }',
    fragmentShader: `uniform sampler2D uTex; varying vec2 vUv;
      void main(){                                               // same tone mapping as the sky, then back to premultiplied
        vec4 c = texture2D(uTex, vUv);
        gl_FragColor = vec4(c.a > 0.001 ? c.rgb / c.a : vec3(0.0), c.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb *= gl_FragColor.a;
      }` }));
  clouds.frustumCulled = false;
  bg.add(clouds);

  // precipitation lives in the foreground (falls in front of the clock)
  const N_P = 2400, pGeo = new THREE.BufferGeometry(), pArr = new Float32Array(N_P * 6);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
  const rain = new THREE.LineSegments(pGeo, new THREE.LineBasicMaterial({ color: 0xc8d4e8, transparent: true, opacity: 0.35, fog: false }));
  const snowGeo = new THREE.BufferGeometry(), sArr = new Float32Array(N_P * 3);
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sArr, 3));
  const flakeCv = document.createElement('canvas'); flakeCv.width = flakeCv.height = 32;
  const fgc = flakeCv.getContext('2d'), fgr = fgc.createRadialGradient(16, 16, 0, 16, 16, 16);
  fgr.addColorStop(0, 'rgba(255,255,255,1)'); fgr.addColorStop(1, 'rgba(255,255,255,0)');
  fgc.fillStyle = fgr; fgc.fillRect(0, 0, 32, 32);
  const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 5, map: new THREE.CanvasTexture(flakeCv), transparent: true, depthWrite: false, fog: false }));
  fg.add(rain, snowPts);
  const box = { w: 900, h: 600, d: 900 };
  const seed = (arr, stride) => { for (let i = 0; i < N_P; i++) { arr[i * stride] = (Math.random() - 0.5) * box.w; arr[i * stride + 1] = Math.random() * box.h; arr[i * stride + 2] = -Math.random() * box.d - 40; } };
  seed(pArr, 6); seed(sArr, 3);
  const precipGroup = [rain, snowPts];

  // ---------------------------------------------------------------- state
  let fx = weatherFx(null), lat = meta.lat, lon = meta.lon, flash = 0, paused = false, lastSunKey = '';
  const fogColor = new THREE.Color();
  bg.fog = new THREE.FogExp2(0x8899aa, 0.00002);
  fg.fog = new THREE.FogExp2(0x8899aa, 0.00002);

  function updateSky(now) {
    const s = sunPosition(now, lat, lon), el = s.el / rad;
    const day = THREE.MathUtils.smoothstep(el, -6, 8);               // 0 night .. 1 day
    const golden = 1 - THREE.MathUtils.smoothstep(Math.abs(el - 3), 0, 12);
    const overcast = fx.clouds * fx.clouds;
    su.sunPosition.value.copy(s.dir);
    su.turbidity.value = 2 + overcast * 14;
    su.rayleigh.value = 1.2 + golden * 1.6 - overcast * 0.8;
    su.mieCoefficient.value = 0.004 + overcast * 0.02;
    su.mieDirectionalG.value = 0.86;

    // moon roughly opposite the sun, kept above the horizon at night
    moon.position.set(-s.dir.x, Math.max(0.25, -s.dir.y + 0.15), -s.dir.z).normalize().multiplyScalar(250000);
    const sunCol = new THREE.Color().setHSL(0.09 + day * 0.04, 0.85 - day * 0.55, 0.55 + day * 0.4);
    for (const { sun, hemi } of lights) {
      sun.position.copy(s.dir.y > -0.05 ? s.dir : moon.position.clone().normalize()).multiplyScalar(40000).add(sun.target.position);
      sun.color.copy(s.dir.y > -0.05 ? sunCol : new THREE.Color(0x9fb4ff));
      sun.intensity = s.dir.y > -0.05 ? (0.2 + day * 4.4) * (1 - overcast * 0.75) : 0.3;
      hemi.intensity = 0.1 + day * (0.5 + overcast * 0.9);
      hemi.color.setHSL(0.6, 0.45 - overcast * 0.35, 0.35 + day * 0.4);
    }
    // haze colour ≈ sky at the horizon
    fogColor.setHSL(0.6 - golden * 0.52, 0.25 + golden * 0.35 - overcast * 0.2, 0.06 + day * (0.62 - overcast * 0.12));
    for (const sc of [bg, fg]) { sc.fog.color.copy(fogColor); sc.fog.density = 0.000012 + fx.fog * 0.00009; }
    const exp = (0.18 + day * 0.32) * (+new URLSearchParams(location.search).get("exp") || 1);   // ?exp= for offline renders
    bgR.toneMappingExposure = fgR.toneMappingExposure = exp * (1 + flash * 2.5);

    stars.material.opacity = (1 - day) * (1 - overcast) * 0.9;
    moon.material.opacity = (1 - day) * (1 - overcast * 0.8);

    cloudU.uCover.value = fx.clouds;
    cloudU.uDens.value = 0.8 + overcast * 1.6;
    cloudU.uSun.value.copy(s.dir.y > -0.05 ? s.dir : moon.position.clone().normalize());
    cloudU.uSunCol.value.copy(s.dir.y > -0.05 ? sunCol : new THREE.Color(0x8090b0)).multiplyScalar(s.dir.y > -0.05 ? (0.15 + day * 1.6) * (1 - overcast * 0.5) : 0.12);
    cloudU.uAmb.value.setHSL(0.6, 0.3 - overcast * 0.2, 0.04 + day * (0.55 - overcast * 0.12));

    const se = season(now);
    uniforms.uSnowLine.value = se.snowLine - (fx.cold ? 300 : 0) - fx.snow * 600;
    uniforms.uSnowAmt.value = fx.snow * 0.6;
    uniforms.uTint.value.set(...se.tint);
    uniforms.uWet.value = fx.rain;

    const key = s.dir.toArray().map(v => v.toFixed(3)).join();
    if (key !== lastSunKey) { lastSunKey = key; bgR.shadowMap.needsUpdate = fgR.shadowMap.needsUpdate = true; }
  }

  function resize() {
    bgR.setSize(innerWidth, innerHeight, false); fgR.setSize(innerWidth, innerHeight, false);
    cloudRT.setSize(Math.ceil(innerWidth / 3), Math.ceil(innerHeight / 3));
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let last = 0, t0 = performance.now(), skyAt = 0, now = new Date(), cloudAt = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const animated = fx.rain || fx.snow || fx.storm;
    const cloudsOn = fx.clouds > 0.04;
    if (paused || t - last < 1000 / (animated ? 30 : 12)) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const time = (t - t0) / 1000;

    // slow "breathing" camera drift for parallax
    const sway = Math.sin(time * 0.05) * 0.9 * rad, cam = camBase.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sway);
    cam.y += Math.sin(time * 0.07) * 25;
    camera.position.copy(cam);
    camera.lookAt(target);

    if (t - skyAt > 30000 || skyAt === 0) { now = window.__VAVRA_TIME__ ? window.__VAVRA_TIME__() : new Date(); updateSky(now); skyAt = t; }
    cloudU.uTime.value = time;
    cloudU.uWind.value.set(Math.cos(0.6), Math.sin(0.6)).multiplyScalar(0.4 + fx.wind / 20);
    clouds.visible = cloudsOn;
    if (cloudsOn && t - cloudAt > 220) {                          // clouds move slowly: ~4.5 updates per second is plenty
      cloudAt = t;
      camera.updateMatrixWorld();
      cloudU.uInvProj.value.copy(camera.projectionMatrixInverse);
      cloudU.uInvView.value.copy(camera.matrixWorld);
      cloudU.uCam.value.copy(camera.position);
      bgR.setRenderTarget(cloudRT); bgR.render(cloudScene, cloudCam); bgR.setRenderTarget(null);
    }

    // precipitation box follows the camera
    rain.visible = fx.rain > 0; snowPts.visible = fx.snow > 0;
    for (const p of precipGroup) { p.position.copy(camera.position); p.quaternion.copy(camera.quaternion); }
    if (rain.visible) {
      const n = Math.floor(N_P * fx.rain), sp = 520 * dt;
      for (let i = 0; i < N_P; i++) {
        const k = i * 6; let y = pArr[k + 1] - sp;
        if (y < -box.h / 2 || i >= n) y = i >= n ? -1e6 : box.h / 2;
        pArr[k + 1] = y; pArr[k + 3] = pArr[k] + 3; pArr[k + 4] = y + 26; pArr[k + 5] = pArr[k + 2];
      }
      pGeo.attributes.position.needsUpdate = true;
    }
    if (snowPts.visible) {
      const n = Math.floor(N_P * fx.snow);
      for (let i = 0; i < N_P; i++) {
        const k = i * 3;
        if (i >= n) { sArr[k + 1] = -1e6; continue; }
        sArr[k + 1] -= (35 + (i % 7) * 6) * dt; sArr[k] += Math.sin(time + i) * 12 * dt;
        if (sArr[k + 1] < -box.h / 2) sArr[k + 1] = box.h / 2;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }
    if (fx.storm && Math.random() < 0.004) flash = 1;
    if (flash > 0) { flash = Math.max(0, flash - dt * 4); updateSky(now); }

    bgR.render(bg, camera);
    fgR.render(fg, camera);
  }
  requestAnimationFrame(frame);

  return {
    meta,
    setWeather(w) { fx = weatherFx(w); if (w) { lat = w.lat ?? lat; lon = w.lon ?? lon; } skyAt = 0; },
    setPaused(p) { paused = p; },
    refresh() { skyAt = 0; },
  };
}
