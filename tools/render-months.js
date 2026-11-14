// Pre-render the 3D scene for every month (15th): sunrise / day / golden / night at the same sun elevations, so light,
// day length and snow line follow the calendar. Output: <OUT>/<MM>-<slot>-bg.png|fg.png (raw; tools/grade-walls.py finishes them)
// usage: (cd www && python3 -m http.server 8099 &) ; node tools/render-months.js OUT_DIR
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/@playwright/cli/node_modules/playwright-core');
const out = process.argv[2], only = process.argv[3], LAT = 45.9763, LON = 7.6586, rad = Math.PI / 180;
function el(date) {
  const d = date / 864e5 - 10957.5, g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = ((18.697374558 + 24.06570982441908 * d) * 15 + LON) * rad - ra, p = LAT * rad;
  return Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(H)) / rad;
}
function hours(day) {                                   // local clock hours for the four looks on this date
  const at = m => { const d = new Date(day + 'T00:00'); d.setMinutes(m); return d; };
  let noon = 0; for (let m = 0; m < 1440; m++) if (el(at(m)) > el(at(noon))) noon = m;
  const cross = (target, from, to, dir) => { for (let m = from; dir > 0 ? m < to : m > to; m += dir) if (el(at(m)) <= target !== el(at(m + dir)) <= target) return m; return from; };
  return { sunrise: cross(1.05, noon, 0, -1) / 60, day: (noon + 30) / 60, golden: cross(0.86, noon, 1439, 1) / 60, night: cross(-4.9, noon, 1439, 1) / 60 };
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--ignore-gpu-blocklist', '--window-size=1920,1080', '--window-position=4000,0'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0'), day = `2026-${mm}-15`, hs = hours(day);
    for (const [slot, h] of Object.entries(hs)) {
      if (only && slot !== only) continue;
      await p.goto(`http://127.0.0.1:8099/?h=${h.toFixed(3)}&date=${day}${slot === 'night' ? '&exp=3.2' : ''}`);   // brighter night render = no banding when graded
      await p.waitForTimeout(12000);
      await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
      await p.waitForTimeout(400);
      await p.addStyleTag({ content: 'body>*:not(canvas){visibility:hidden!important} html,body{background:transparent!important} #fg{visibility:hidden}' });
      await p.screenshot({ path: `${out}/${mm}-${slot}-bg.png` });
      await p.addStyleTag({ content: '#fg{visibility:visible!important} #bg{visibility:hidden!important}' });
      await p.screenshot({ path: `${out}/${mm}-${slot}-fg.png`, omitBackground: true });
      console.log(mm, slot, h.toFixed(2));
    }
  }
  await b.close();
})();
