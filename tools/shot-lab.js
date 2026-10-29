'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LAB = 'file://' + path.join(ROOT, 'chart-lab.html');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [w, h, tag] of [[1440, 900, 'wide'], [1280, 800, 'mid'], [1180, 760, 'narrow']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto(LAB);
    await p.waitForTimeout(400);
    await p.click('[data-diff="nightmare"]');
    await p.waitForTimeout(200);
    /* 扫到中段，让播放头进入密集区 */
    await p.evaluate(() => { const L = window.__lab; L.scan.t = 120; });
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(__dirname, 'shots', 'lab-' + tag + '.png') });
    await p.close();
  }
  await b.close();
  console.log('done');
})();
