// Liquid Glass for the TV home screen.
// The refraction / dispersion / Fresnel / specular model is adapted from ybouane/liquidglass (MIT, see vendor note below),
// rebuilt for a weak TV GPU: the only thing behind the glass is the wallpaper, so instead of rasterising the DOM every
// change we sample the wallpaper images directly, render once (per minute / layout / time-of-day change) into plain 2D
// canvases, and the compositor just shows still pictures. One shared WebGL context, nothing runs per frame.
//
// Two shapes:  panel(el, cfg) – rounded-rect pill bevel (dock, buttons, sheets)
//              clock(text)    – the digits themselves are the glass body (height field = blurred glyph mask)
// LiquidGlass (c) ybouane – MIT License – https://github.com/ybouane/liquidglass
'use strict';
window.LG = (() => {
  const gc = document.createElement('canvas');
  const gl = gc.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: false});
  if (!gl) return null;
  const dpr = () => window.devicePixelRatio || 1;

  const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  const COMMON = `
precision highp float;
varying vec2 uv;
uniform sampler2D u_bg, u_blur;
uniform vec2 u_scr;          // screen size, device px
uniform vec2 u_org;          // canvas top-left on screen, device px
uniform vec2 u_res;          // canvas size, device px
uniform float u_refract, u_chroma, u_edgeHL, u_spec, u_fresnel, u_blurMix, u_tint, u_bright, u_sat, u_smoke, u_dim, u_edgeDark;
vec2 canvasPx(){ return vec2(uv.x * u_res.x, (1.0 - uv.y) * u_res.y); }     // y down, like the DOM
vec3 sampleBg(vec2 sPx, vec2 N, float edge){
  vec2 base = sPx / u_scr;
  vec2 ca = N * u_chroma * 36.0 * (edge * 0.7 + 0.3) / u_scr;
  vec3 sharp = vec3(texture2D(u_bg, base + ca).r, texture2D(u_bg, base).g, texture2D(u_bg, base - ca).b);
  vec3 soft  = vec3(texture2D(u_blur, base + ca).r, texture2D(u_blur, base).g, texture2D(u_blur, base - ca).b);
  vec3 col = mix(sharp, soft, u_blurMix * (1.0 - edge * 0.15));
  col *= 1.0 + u_bright;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.0 + u_sat);
  col = mix(col, col * vec3(0.92, 0.95, 1.05), u_tint);
  col = mix(col, vec3(lum * 0.55 + 0.16), u_smoke);       // smoky grey body (Apple's clock glass)
  return col * (1.0 - u_dim);
}
vec3 light(vec3 N, float fresK){
  vec3 V = vec3(0., 0., 1.);
  float sp1 = pow(max(dot(N, normalize(normalize(vec3(0.4, 0.7, 1.0)) + V)), 0.), 90.);
  float sp2 = pow(max(dot(N, normalize(normalize(vec3(-0.3, -0.5, 1.0)) + V)), 0.), 50.) * 0.3;
  float spB = pow(max(dot(N, normalize(vec3(0.1, 0.3, 1.0))), 0.), 6.) * 0.1;
  float sp4 = pow(max(dot(N, normalize(normalize(vec3(0.0, 0.9, 0.4)) + V)), 0.), 120.) * 0.6;
  float fres = pow(1.0 - abs(N.z), 4.0) * u_fresnel;
  return vec3((sp1 + sp2 + spB + sp4) * u_spec + (N.y * 0.5 + 0.5) * fres * 0.08) + fresK * fres;
}`;

  // ---- rounded-rect panel (biconvex pill bevel), after FS_GLASS in liquidglass/src/shaders.ts
  const FS_PANEL = COMMON + `
uniform vec2 u_size; uniform float u_radius, u_zR, u_pad, u_shadow, u_spread, u_offY, u_dome, u_rim;
float rr(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + vec2(r); return min(max(q.x, q.y), 0.) + length(max(q, vec2(0.))) - r; }
float bevel(float d, float zR){ if (d <= 0.) return 0.; if (d >= zR) return zR; return sqrt(d * (2. * zR - d)); }
void main(){
  vec2 px = canvasPx(), lp = px - u_pad - u_size * 0.5, h2 = u_size * 0.5;
  float r = min(u_radius, min(h2.x, h2.y)), sdf = rr(lp, h2, r);
  if (sdf > 0.) {
    float d = max(rr(lp - vec2(0., u_offY), h2, r) - 1., 0.), s = max(u_spread, 1.);
    float sh = (exp(-d * d / (s * s)) * 0.65 + exp(-d * 0.08 / max(s * 0.04, 0.01)) * 0.35) * u_shadow;
    gl_FragColor = vec4(0., 0., 0., sh); return;
  }
  float mask = 1. - smoothstep(-1.5, 0.5, sdf), inside = -sdf, edge = smoothstep(min(h2.x, h2.y) * 0.35, 0., inside);
  float e = 2.;
  float hR = bevel(-rr(lp + vec2(e, 0.), h2, r), u_zR), hL = bevel(-rr(lp - vec2(e, 0.), h2, r), u_zR);
  float hU = bevel(-rr(lp + vec2(0., e), h2, r), u_zR), hD = bevel(-rr(lp - vec2(0., e), h2, r), u_zR);
  vec2 g = vec2(hR - hL, hU - hD) / (2. * e);
  vec3 N = normalize(vec3(-g, 1.));
  float depth = smoothstep(0., u_zR, inside), thick = bevel(inside, u_zR) * 2. / max(u_zR * 2., 1.);
  float rp = 1. - 1. / 1.5;
  vec2 refr = u_dome > 0.5 ? -lp * u_refract * depth * 0.35
                           : (g * rp * 2. + g * rp * thick * 0.5) * u_refract * 30. - lp / max(h2, vec2(1.)) * u_refract * 4. * depth;
  vec3 col = sampleBg(u_org + px + refr, N.xy, edge) * (1. + 0.06 * depth);
  float bw = 1.5 * ${'${DPR}'};
  float stroke = smoothstep(-bw - 1., -bw, sdf) * (1. - smoothstep(-1., 0., sdf)) * (0.4 + 0.6 * (0.5 + 0.5 * (-lp.y / h2.y)));
  vec3 fin = col + light(N, 0.) + vec3(edge * u_edgeHL * 0.22 + smoothstep(5., 0., inside) * u_edgeHL * 0.15 + stroke * u_edgeHL * 0.55);
  fin = mix(fin, vec3(1.), pow(1. - abs(N.z), 4.) * u_fresnel * 0.2);
  // rim after rdev/liquid-glass-react: 1.5px border with a 135° gradient (clear → .32 at 1/3 → .6 at 2/3 → clear),
  // a .5px white hairline and a soft 1-3px inner glow along the top edge
  float dg = clamp((lp.x / h2.x + lp.y / h2.y) * 0.25 + 0.5, 0., 1.);
  float prof = dg < .33 ? dg / .33 * .32 : dg < .66 ? mix(.32, .6, (dg - .33) / .33) : mix(.6, 0., (dg - .66) / .34);
  float ring = smoothstep(-bw - 1., -bw, sdf) * (1. - smoothstep(-1., 0., sdf));
  float hair = 1. - smoothstep(-1.2 * ${'${DPR}'}, 0., sdf);
  float topGlow = (1. - smoothstep(0., 3. * ${'${DPR}'}, inside)) * clamp(0.5 - lp.y / h2.y * 0.5, 0., 1.);
  fin += vec3(ring * prof * 1.25 + hair * 0.22 + topGlow * 0.25) * u_rim;
  gl_FragColor = vec4(fin * mask, mask);
}`;

  // ---- glyph glass: same optics, but the height field comes from the blurred digit mask
  const FS_TEXT = COMMON + `
uniform sampler2D u_mask, u_hf; uniform float u_zR, u_shadow; uniform vec2 u_shOff;
float H(vec2 p){ float b = texture2D(u_hf, p / u_res).a; float n = clamp((b - 0.5) * 2.0, 0., 1.); return u_zR * sqrt(1. - (1. - n) * (1. - n)); }
void main(){
  vec2 px = canvasPx(), t = px / u_res;
  float m = texture2D(u_mask, t).a;
  float sh = texture2D(u_hf, (px - u_shOff) / u_res).a * u_shadow;
  if (m < 0.004) { gl_FragColor = vec4(0., 0., 0., sh); return; }
  float e = 1.5;
  vec2 g = vec2(H(px + vec2(e, 0.)) - H(px - vec2(e, 0.)), H(px + vec2(0., e)) - H(px - vec2(0., e))) / (2. * e);
  vec3 N = normalize(vec3(-g, 1.));
  float hn = H(px) / u_zR, edge = 1. - smoothstep(0.0, 0.55, hn);
  vec2 refr = g * (1. - 1. / 1.5) * 2.4 * u_refract * 30.;
  vec3 col = sampleBg(u_org + px + refr, N.xy, edge);
  float band = smoothstep(0.06, 0.22, hn) * (1. - smoothstep(0.32, 0.75, hn));   // dark refracted band inside the rim
  col *= 1. - band * u_edgeDark;
  float stroke = (1. - smoothstep(0.04, 0.2, hn)) * (0.35 + 0.65 * clamp(-N.y * 2.0 + 0.5, 0., 1.));
  vec3 fin = col + light(N, 0.) + vec3(edge * u_edgeHL * 0.18 + stroke * u_edgeHL * 0.6);
  fin = mix(fin, vec3(1.), pow(1. - abs(N.z), 4.) * u_fresnel * 0.18);
  float a = m + sh * (1. - m);
  gl_FragColor = vec4(fin * m, a);
}`;

  function prog(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs.replaceAll('${DPR}', dpr().toFixed(2))]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  let P_PANEL, P_TEXT;
  try { P_PANEL = prog(FS_PANEL); P_TEXT = prog(FS_TEXT); } catch (e) { console.log('LG shader', e.message); return null; }
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // fixed texture units: 0 scene(bg+fg) 1 clear 2 blur 3 bg 4 glyph mask 5 glyph height field
  const U = {scene: 0, clear: 1, blur: 2, bg: 3, mask: 4, hf: 5}, texs = [];
  function tex(unit, src) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const t = texs[unit] || (texs[unit] = gl.createTexture());
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (src) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }
  function set(p, u) {
    for (const [k, v] of Object.entries(u)) {
      const loc = gl.getUniformLocation(p, k); if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]); else gl.uniform1i(loc, v[0]);
    }
  }
  function draw(target, w, h) {          // render the GL canvas into a 2D canvas that the compositor keeps
    target.width = w; target.height = h;
    const c = target.getContext('2d');
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    c.clearRect(0, 0, w, h); c.drawImage(gc, 0, 0);
  }
  const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  // wallpaper: bg (behind the clock), scene = bg+fg (behind panels), plus pre-blurred copies
  let W = null;
  async function setWall(slot) {
    const [bg, fg, clear, blur] = await Promise.all(['bg', 'fg', 'clear', 'blur'].map(k => load(`wall/${slot}-${k}.webp`)));
    const sc = document.createElement('canvas'); sc.width = bg.naturalWidth; sc.height = bg.naturalHeight;
    const x = sc.getContext('2d'); x.drawImage(bg, 0, 0); x.drawImage(fg, 0, 0, sc.width, sc.height);
    for (const [k, v] of Object.entries({scene: sc, clear, blur, bg})) tex(U[k], v);   // upload once per time of day
    W = true;
  }

  const DEF = {u_edgeDark: 0, u_refract: 0.69, u_chroma: 0.05, u_edgeHL: 0.05, u_spec: 0, u_fresnel: 1, u_blurMix: 1, u_tint: 0, u_bright: 0, u_sat: 0, u_smoke: 0, u_dim: 0};
  const cvOf = el => el.querySelector(':scope > canvas.lg') || el.insertBefore(Object.assign(document.createElement('canvas'), {className: 'lg'}), el.firstChild);

  // el: element at rest geometry {x,y,w,h} in CSS px; cfg: optics + shape
  function panel(el, rect, cfg) {
    if (!W) return;
    const d = dpr(), pad = (cfg.pad ?? 44), cw = Math.round((rect.w + pad * 2) * d), ch = Math.round((rect.h + pad * 2) * d);
    gc.width = cw; gc.height = ch; gl.viewport(0, 0, cw, ch);
    gl.useProgram(P_PANEL);
    set(P_PANEL, Object.assign({}, DEF, cfg.optics, {
      u_bg: [U.scene], u_blur: [cfg.soft === 'blur' ? U.blur : U.clear], u_scr: [innerWidth * d, innerHeight * d], u_org: [(rect.x - pad) * d, (rect.y - pad) * d], u_res: [cw, ch],
      u_size: [rect.w * d, rect.h * d], u_radius: cfg.radius * d, u_zR: cfg.zR * d, u_pad: pad * d,
      u_shadow: cfg.shadow ?? 0.3, u_spread: (cfg.spread ?? 14) * d, u_offY: (cfg.offY ?? 4) * d, u_dome: cfg.dome ? 1 : 0, u_rim: cfg.rim ?? 0}));
    const cv = cvOf(el);
    cv.style.cssText = `position:absolute;left:${-pad}px;top:${-pad}px;width:${rect.w + pad * 2}px;height:${rect.h + pad * 2}px;z-index:-1;pointer-events:none`;
    draw(cv, cw, ch);
  }

  // clock: glyphs laid out like the CSS clock (centered, tall), drawn into canvas `cv` covering screen rows [top, top+height)
  function clock(cv, text, o) {
    if (!W) return;
    const d = dpr(), cw = Math.round(innerWidth * d), ch = Math.round(o.height * d);
    const mk = (f) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d'); f(x); return c; };
    const glyphs = x => {
      x.font = `${o.width || ''} ${o.weight} ${o.size * d}px ${o.font}`.trim(); x.textAlign = 'center'; x.textBaseline = 'alphabetic';
      try { x.letterSpacing = `${o.tracking * o.size * d}px`; } catch (e) {}
      x.fillStyle = '#fff'; x.save(); x.translate((o.x ?? innerWidth / 2) * d, o.baseline * d); x.scale(1, o.stretch); x.fillText(text, 0, 0); x.restore();
    };
    const mask = mk(glyphs);
    const hf = mk(x => { x.filter = `blur(${o.bevel * d}px)`; x.drawImage(mask, 0, 0); });
    gc.width = cw; gc.height = ch; gl.viewport(0, 0, cw, ch);
    gl.useProgram(P_TEXT);
    tex(U.mask, mask); tex(U.hf, hf);
    set(P_TEXT, Object.assign({}, DEF, o.optics, {
      u_bg: [U.bg], u_blur: [U.clear], u_mask: [U.mask], u_hf: [U.hf], u_scr: [innerWidth * d, innerHeight * d], u_org: [0, o.top * d], u_res: [cw, ch],
      u_zR: o.bevel * 2.2 * d, u_shadow: o.shadow ?? 0.22, u_shOff: [0, 5 * d]}));
    cv.style.cssText = `position:fixed;left:0;top:${o.top}px;width:100vw;height:${o.height}px;z-index:1;pointer-events:none`;
    draw(cv, cw, ch);
  }
  return {setWall, panel, clock};
})();
