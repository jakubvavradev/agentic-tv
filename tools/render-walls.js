// Pre-render the 3D Matterhorn scene into static wallpaper layers for the TV launcher:
// <slot>-bg.jpg (sky + far range) and <slot>-fg.webp (near peak with alpha), so the clock can sit between them.
// usage: (cd www && python3 -m http.server 8099 &) ; node tools/render-walls.js [date]
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/@playwright/cli/node_modules/playwright-core');
const out = process.env.OUT || __dirname + '/../android/assets/wall/';
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const SLOTS = process.env.SLOTS ? JSON.parse(process.env.SLOTS) : { sunrise: 7.9, day: 12.5, golden: 16.4, night: 21 };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: false, args: ['--ignore-gpu-blocklist', '--window-size=1920,1080'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [slot, h] of Object.entries(SLOTS)) {
    await p.goto(`http://127.0.0.1:8099/?h=${h}&date=${date}`);
    await p.waitForTimeout(15000);                                        // terrain + shadows + clouds settle
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; });  // freeze: both layers keep the same frame
    await p.waitForTimeout(500);
    await p.addStyleTag({ content: 'body>*:not(canvas){visibility:hidden!important} html,body{background:transparent!important}' });
    await p.addStyleTag({ content: '#fg{visibility:hidden}' });
    await p.screenshot({ path: out + slot + '-bg.jpg', type: 'jpeg', quality: 88 });
    await p.addStyleTag({ content: '#fg{visibility:visible!important} #bg{visibility:hidden!important}' });
    await p.screenshot({ path: out + slot + '-fg.png', omitBackground: true });
    console.log(slot, 'done');
  }
  await b.close();
})();
