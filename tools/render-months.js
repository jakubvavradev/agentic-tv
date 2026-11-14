// Pre-render the 3D scene for every month (15th): sunrise / day / golden / night at the same sun elevations, so light,
// day length and snow line follow the calendar. Output: <OUT>/<MM>-<slot>-bg.png|fg.png (raw; tools/grade-walls.py finishes them)
// usage: (cd www && python3 -m http.server 8099 &) ; [MONTHS=1,4,7,10] node tools/render-months.js OUT_DIR [terrain-id] [slot]
// Times are exact UTC instants (?ts=) found around the peak's own solar noon, so peaks in any time zone work.
const fs = require('fs');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/@playwright/cli/node_modules/playwright-core');
const out = process.argv[2], T = process.argv[3] || '', only = process.argv[4], rad = Math.PI / 180;
const meta = JSON.parse(fs.readFileSync(`${__dirname}/../www/terrain/${T ? T + '/' : ''}meta.json`));
const LAT = meta.lat, LON = meta.lon, MONTHS = (process.env.MONTHS || '1,2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
function el(ms) {
  const d = ms / 864e5 - 10957.5, g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = ((18.697374558 + 24.06570982441908 * d) * 15 + LON) * rad - ra, p = LAT * rad;
  return Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(H)) / rad;
}
function instants(day) {                                // UTC ms of the four looks on this date at the peak
  const noon0 = Date.parse(day + 'T12:00Z') - LON / 15 * 36e5, at = m => noon0 + m * 6e4;
  let noon = 0; for (let m = -120; m <= 120; m++) if (el(at(m)) > el(at(noon))) noon = m;
  const cross = (target, dir) => { for (let m = noon; Math.abs(m - noon) < 720; m += dir) if (el(at(m)) <= target !== el(at(m + dir)) <= target) return at(m); return at(noon); };
  return { sunrise: cross(1.05, -1), day: at(noon + 30), golden: cross(0.86, 1), night: cross(-4.9, 1) };
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--ignore-gpu-blocklist', '--window-size=1920,1080', '--window-position=4000,0'] });
  fs.mkdirSync(out, { recursive: true });
  for (const m of MONTHS) {
    const mm = String(m).padStart(2, '0'), day = `2026-${mm}-15`;
    for (const [slot, ts] of Object.entries(instants(day))) {
      if (only && slot !== only) continue;
      if (fs.existsSync(`${out}/${mm}-${slot}-fg.png`) && !process.env.FORCE) continue;   // resume
      for (let tryN = 1; ; tryN++) try {
        const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
        await p.goto(`http://127.0.0.1:8099/?ts=${ts}${T ? '&t=' + T : ''}${slot === 'night' ? '&exp=3.2' : ''}`, { timeout: 90000 });   // brighter night render = no banding when graded
        await p.waitForTimeout(12000);
        await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
        await p.waitForTimeout(400);
        await p.addStyleTag({ content: 'body>*:not(canvas){visibility:hidden!important} html,body{background:transparent!important} #fg{visibility:hidden}' });
        await p.screenshot({ path: `${out}/${mm}-${slot}-bg.png` });
        await p.addStyleTag({ content: '#fg{visibility:visible!important} #bg{visibility:hidden!important}' });
        await p.screenshot({ path: `${out}/${mm}-${slot}-fg.png`, omitBackground: true });
        await p.close();
        break;
      } catch (e) { console.log('retry', mm, slot, tryN, e.message.split('\n')[0]); if (tryN >= 3) throw e; }
      console.log(T || 'default', mm, slot, new Date(ts).toISOString());
    }
  }
  await b.close();
})();
