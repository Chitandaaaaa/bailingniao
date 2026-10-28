/* 连击光环三档 + PERFECT 爆发 截图 */
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
  page.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()); });

  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(5200);

  // 清空未判定音符，避免 MISS 打断 combo（专注观察光环档位）
  await page.evaluate(() => { const G = window.__game.G; G.notes.length = 0; G.cursor = 0; });

  const setCombo = async (n, wait) => {
    await page.evaluate(v => { window.__game.G.combo = v; }, n);
    await page.waitForTimeout(wait);
  };

  await setCombo(6, 900);
  await page.screenshot({ path: path.join(OUT, 'c0-none.png') });

  await setCombo(25, 1100);
  await page.screenshot({ path: path.join(OUT, 'c1-tier1.png') });

  await setCombo(45, 1500);
  await page.screenshot({ path: path.join(OUT, 'c2-tier2.png') });

  // PERFECT 爆发瞬间（三档）
  for (const [tag, c] of [['t0', 6], ['t1', 25], ['t2', 45]]) {
    await page.evaluate(v => {
      const g = window.__game; g.G.combo = v;
      g.spawnHitFx(2, 'perfect', 120, { lane: 2 });
    }, c);
    await page.waitForTimeout(45);
    await page.screenshot({ path: path.join(OUT, 'p-' + tag + '.png') });
    await page.waitForTimeout(500);
  }

  const info = await page.evaluate(() => ({
    tier: window.__game.G.tier, tierS: window.__game.G.tierS.toFixed(2),
    shakeAdd: window.__game.G.shakeAdd, rings: window.__game.G.rings.length
  }));
  console.log('state:', JSON.stringify(info));
  console.log('errors:', errs.length ? errs.slice(0, 6) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
