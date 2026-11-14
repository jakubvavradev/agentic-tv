// Claude orb: Jakub Antalik's dotted thinking-orbs (MIT, vendor/thinking-orbs-engine.js), floating free over the scene.
// The engine returns finished, z-sorted dots per instant; we paint them with a light ink tinted per state and
// cross-fade when the state changes. No container: the orb floats on its own over the scene.
import { MODE_FRAMES, resolvePreset } from './vendor/thinking-orbs-engine.js';

// VAVRA state -> thinking-orbs state(s); "running" cycles through the busy verbs while Claude works
const STATES = {
  idle: ['breathing'], pending: ['breathing'], listening: ['listening'], transcribing: ['searching'],
  running: ['working', 'weaving', 'solving', 'connecting', 'shaping'], speaking: ['composing'],
};
const TINT = {                                   // far-dot colour; near dots go to white
  idle: [217, 119, 87], pending: [255, 205, 170], listening: [110, 190, 255], transcribing: [150, 170, 255],
  running: [217, 119, 87], speaking: [255, 170, 130],
};
const CYCLE_S = 6.5;

export function createOrb(canvas) {
  const ctx = canvas.getContext('2d');
  let state = 'idle', active = false, layers = [], tint = TINT.idle.slice(), start = performance.now(), lastCycle = 0;

  function setOrbState(name, now) {
    const r = resolvePreset(name, 64);
    layers.forEach(l => l.fadeOut = true);
    layers.push({ name, ...r, born: now, alpha: 0, fadeOut: false });
  }

  function paint(frame, alpha, size) {
    for (const d of frame.dots) {
      const ink = 1 - Math.min(1, Math.max(0, d.white));          // dark substrate: near dots bright
      const r = Math.round(tint[0] + (255 - tint[0]) * ink), g = Math.round(tint[1] + (255 - tint[1]) * ink), b = Math.round(tint[2] + (255 - tint[2]) * ink);
      ctx.fillStyle = `rgba(${r},${g},${b},${(d.a ?? 1) * alpha * (0.7 + 0.3 * ink)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 1.55, 0, Math.PI * 2);              // larger dots: the orb floats free on a busy scene
      ctx.fill();
    }
    for (const l of frame.lines) {
      ctx.strokeStyle = `rgba(255,255,255,${(l.a ?? 1) * alpha * 0.5})`;
      ctx.lineWidth = l.w;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!active && !layers.some(l => l.alpha > 0)) return;
    const size = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const t = (now - start) / 1000;

    if (state === 'running' && t - lastCycle > CYCLE_S) {           // next "thinking" verb
      lastCycle = t;
      const cur = layers.at(-1)?.name, list = STATES.running;
      setOrbState(list[(list.indexOf(cur) + 1) % list.length], now);
    }
    const target = TINT[state];
    tint = tint.map((v, i) => v + (target[i] - v) * 0.06);

    ctx.clearRect(0, 0, size, size);
    const inner = Math.round(size * 0.92), off = (size - inner) / 2;  // free-floating: dots use almost the whole canvas
    ctx.save();
    ctx.translate(off, off);
    for (const l of layers) {
      l.alpha = Math.max(0, Math.min(1, l.alpha + (l.fadeOut ? -0.06 : 0.06)));
      if (l.alpha > 0) paint(MODE_FRAMES[l.mode](inner, ((now - l.born) / 1000) * l.speed, l.opts), l.alpha * (active ? 1 : 0.0), inner);
    }
    ctx.restore();
    layers = layers.filter(l => !(l.fadeOut && l.alpha <= 0));
    if (!active) layers.forEach(l => l.alpha = 0);
  }
  requestAnimationFrame(frame);

  return {
    setState(st) {
      const next = st && STATES[st] ? st : null;
      active = !!next;
      if (!next || next === state && layers.length) return;
      state = next;
      lastCycle = (performance.now() - start) / 1000;
      setOrbState(STATES[next][0], performance.now());
    },
  };
}
