/* 长按音符视觉检查：把目标 hold 平移到当前时间前 1.35s，截图 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  for (const mode of ['easy', 'hard', 'nightmare']) {
    await page.evaluate(() => window.__game.toTitle && window.__game.toTitle());
    await page.click('.diff-card[data-diff="' + mode + '"]');
    await page.keyboard.press('Space');
    await page.waitForTimeout(4200);
    for (let k = 0; k < 4; k++) {
      const info = await page.evaluate(() => {
        const g = window.__game, G = g.G;
        const now = g.Sound.chartTime();
        const h = G.notes.find(n => n.type === 'hold' && n.t > now + 3);
        if (!h) return null;
        const delta = h.t - (now + 1.35);
        G.notes.forEach(n => { n.t -= delta; n.judged = false; n.holdActive = false; });
        G.cursor = 0; G.holds.length = 0; G.combo = 0; G.msFx = null;
        G.parts.forEach(p => { p.live = false; });
        if (G.flashes) G.flashes.length = 0;
        if (G.rings) G.rings.length = 0;
        return { t: Math.round(h.t + delta), lane: h.lane, beats: h.holdBeats };
      });
      if (!info) { console.log(mode + ' no more holds'); break; }
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        const G = window.__game.G;
        G.combo = 0; G.parts.forEach(p => { p.live = false; });
        if (G.flashes) G.flashes.length = 0;
      });
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(OUT, 'hv-' + mode + '-' + k + '.png') });
      console.log(mode + ' #' + k + ' hold@' + info.t + 's lane' + info.lane + ' ' + info.beats + '拍');
      await page.waitForTimeout(600);
    }
  }
  console.log('errors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
