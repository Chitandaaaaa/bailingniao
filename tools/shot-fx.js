/* 特效强度视觉检查：伪造高连击档位，连续触发命中特效后截图 */
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
  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');            /* 作弊模式：不会 miss，combo 才留得住 */
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
  await page.waitForTimeout(4200);

  for (const lvl of [25, 60, 160, 260, 360]) {
    await page.evaluate(c => { window.__game.G.combo = c; window.__game.G.maxCombo = c; }, lvl);
    await page.waitForTimeout(160);
    // 连续 6 次命中，堆出满屏粒子
    for (let i = 0; i < 6; i++) {
      await page.evaluate(i => {
        const g = window.__game;
        g.spawnHitFx(i % 5, 'perfect', 300, { lane: i % 5 });
        g.bumpCombo && g.bumpCombo();
      }, i);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, 'fx-' + lvl + '.png') });
    const st = await page.evaluate(() => {
      const G = window.__game.G;
      let live = 0; for (const p of G.parts) if (p.live) live++;
      return { tier: G.tier, liveParts: live, rings: G.rings.length, body: document.body.className };
    });
    console.log('combo ' + lvl + ' → tier ' + st.tier + ' 活跃粒子 ' + st.liveParts + ' 环 ' + st.rings + ' | ' + st.body);
    await page.waitForTimeout(900);
  }
  // 帧率粗测（满粒子）
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); }
    requestAnimationFrame(tick);
  }));
  console.log('满特效 fps ≈ ' + fps);
  console.log('errors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
