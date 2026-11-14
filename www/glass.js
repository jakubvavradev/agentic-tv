// Liquid-glass text for the lock-screen clock: the backdrop is refracted along the glyph edges
// (SVG feDisplacementMap fed with a normal map drawn from the same text), clipped to the glyphs,
// plus a specular rim and a soft outer shadow. All layers come from one canvas layout, so they line up.
const FONT = 'Inter';

function layout(ctx, text, W, H) {
  ctx.font = `700 100px ${FONT}`;
  ctx.letterSpacing = '-4px';
  const w100 = ctx.measureText(text).width;
  const capH = 0.727;                                  // Inter digit height / em
  // the digits fill an inner box; the margin keeps shadow and refraction from being cut at the canvas edge
  const boxW = W * 0.9, boxH = H * 0.8;
  const fs = Math.min(boxW / (w100 / 100), boxH / (capH * 1.06));
  const sy = Math.min(1.32, Math.max(1, boxH / (capH * fs)));       // iOS-style tall digits
  return { fs, sy, base: H * 0.89 };
}

function drawText(ctx, text, W, H, L) {
  ctx.save();
  ctx.font = `700 ${L.fs}px ${FONT}`;
  ctx.letterSpacing = `${-L.fs * 0.04}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.translate(W / 2, L.base);
  ctx.scale(1, L.sy);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export async function liquidGlassText(el, lensEl, rimCanvas, mapImage, displaceEl, text) {
  await document.fonts.load(`700 100px ${FONT}`);
  const r = el.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
  if (!W || !H) return;
  const cv = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const L = layout(cv().getContext('2d'), text, W, H);

  // 1) glyph mask
  const mask = cv(), mc = mask.getContext('2d');
  mc.fillStyle = '#fff';
  drawText(mc, text, W, H, L);
  lensEl.style.setProperty('--m', `url(${mask.toDataURL()})`);

  // 2) normal map: blurred glyph height field -> gradient in R/G (128 = no shift)
  const blur = Math.max(2, H * 0.035);
  const hf = cv(), hc = hf.getContext('2d');
  hc.filter = `blur(${blur}px)`;
  hc.fillStyle = '#fff';
  drawText(hc, text, W, H, L);
  const src = hc.getImageData(0, 0, W, H).data;
  const map = cv(), mpc = map.getContext('2d'), out = mpc.createImageData(W, H), o = out.data;
  let gmax = 1;
  const g = new Float32Array(W * H * 2);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = src[(i + 1) * 4 + 3] - src[(i - 1) * 4 + 3], gy = src[(i + W) * 4 + 3] - src[(i - W) * 4 + 3];
    g[i * 2] = gx; g[i * 2 + 1] = gy;
    gmax = Math.max(gmax, Math.abs(gx), Math.abs(gy));
  }
  for (let i = 0; i < W * H; i++) {
    o[i * 4] = 128 + (g[i * 2] / gmax) * 127;
    o[i * 4 + 1] = 128 + (g[i * 2 + 1] / gmax) * 127;
    o[i * 4 + 2] = 128;
    o[i * 4 + 3] = 255;
  }
  mpc.putImageData(out, 0, 0);
  mapImage.setAttribute('href', map.toDataURL());
  mapImage.setAttribute('width', W);
  mapImage.setAttribute('height', H);
  displaceEl.setAttribute('scale', Math.round(H * 0.16));

  // 3) rim: outer soft shadow (outside the glyphs only), inner sheen, specular edge
  rimCanvas.width = W; rimCanvas.height = H;
  const c = rimCanvas.getContext('2d');
  c.clearRect(0, 0, W, H);
  c.save();
  c.shadowColor = 'rgba(0,0,0,.22)'; c.shadowBlur = H * 0.07; c.shadowOffsetY = H * 0.025;
  c.fillStyle = '#000';
  drawText(c, text, W, H, L);
  c.restore();
  c.globalCompositeOperation = 'destination-out';
  drawText(c, text, W, H, L);
  c.globalCompositeOperation = 'source-over';
  const sheen = c.createLinearGradient(0, H * 0.05, 0, H);
  sheen.addColorStop(0, 'rgba(255,255,255,.2)'); sheen.addColorStop(0.45, 'rgba(255,255,255,.03)'); sheen.addColorStop(1, 'rgba(255,255,255,.1)');
  c.fillStyle = sheen;
  drawText(c, text, W, H, L);
  // specular edges from the glyph silhouette itself (mask minus a shifted copy), so overlapping font contours
  // never show up as lines inside a digit
  const e = Math.max(1, H * 0.004);
  for (const [dx, dy, a] of [[0, e, 0.55], [e, 0, 0.16], [-e, 0, 0.1], [0, -e, 0.28]]) {
    const ec = cv(), x = ec.getContext('2d');
    x.fillStyle = '#fff';
    drawText(x, text, W, H, L);
    x.globalCompositeOperation = 'destination-out';
    x.save(); x.translate(dx, dy); drawText(x, text, W, H, L); x.restore();
    c.globalAlpha = a;
    c.drawImage(ec, 0, 0);
  }
  c.globalAlpha = 1;
}
