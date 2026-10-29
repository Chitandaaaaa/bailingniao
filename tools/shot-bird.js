/* 标题界面 Q 版百灵鸟飞行：用 Web Animations API 把动画钉到轨迹各时刻再截图 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');
const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const seek = (page, sec) => page.evaluate((s) => {
  const el = document.querySelector('#title-bird');
  el.getAnimations().forEach(a => { a.pause(); a.currentTime = 700 + s * 1000; });
  const r = el.querySelector('.bird-art').getBoundingClientRect();
  return { op: +getComputedStyle(el).opacity, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
}, sec);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.waitForTimeout(300);

  for (const sec of [1.4, 3.4, 5.2, 6.6, 7.6, 8.6]) {
    const info = await seek(page, sec);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, 'bird-t' + sec + '.png') });
    console.log('t=' + sec + 's  opacity ' + info.op + '  bird@' + info.x + ',' + info.y + ' (' + info.w + 'px)');
  }

  await seek(page, 4.2);
  await page.waitForTimeout(120);
  const box = await page.evaluate(() => {
    const r = document.querySelector('#title-bird .bird-art').getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    return { x: Math.round(cx - 170), y: Math.round(cy - 150), width: 340, height: 300 };
  });
  await page.screenshot({ path: path.join(OUT, 'bird-zoom.png'), clip: box });
  console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await browser.close();
})();
