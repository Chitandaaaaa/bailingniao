/* 真实演奏场景（噩梦 5 轨）下的连击光环截图：21+ 与 41+ */
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
  await page.evaluate(() => {
    localStorage.setItem('bailingniao.best', JSON.stringify({
      score: 0, acc: 0, maxChain: 0, plays: 3, seenTutorial: true,
      settings: { colorBlind: false, goodWindow: false, preHighlight: true, reduceMotion: 'off', offsetMs: 0, mode: 'nightmare' }
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(5600);

  await page.evaluate(() => {
    const g = window.__game;
    window.__auto = setInterval(() => {
      const G = g.G; if (G.state !== 'PLAYING') return;
      const t = g.Sound.chartTime();
      for (const n of G.notes) {
        if (n.judged) continue;
        if (Math.abs(n.t - t) < 0.045) g.hitLane(n.lane, n.t);
      }
    }, 12);
  });

  await page.waitForFunction(() => window.__game.G.combo > 21, { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'n1-combo21.png') });

  await page.waitForFunction(() => window.__game.G.combo > 41, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'n2-combo41.png') });
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, 'n3-combo41b.png') });

  const info = await page.evaluate(() => ({
    combo: window.__game.G.combo, tier: window.__game.G.tier,
    tierS: +window.__game.G.tierS.toFixed(2), mode: window.__game.G.mode
  }));
  console.log('state:', JSON.stringify(info));
  console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
