/* 检查「底部上升粒子 + 判定线火焰」的密度、分布与帧率 */
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
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
  await page.waitForTimeout(2500);

  for (const lvl of [25, 60, 160, 360]) {
    await page.evaluate(c => { window.__game.G.combo = c; window.__game.G.maxCombo = c; }, lvl);
    // 让发射器自然跑够时间，粒子铺满屏幕
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => {
      const G = window.__game.G;
      let flame = 0, rise = 0, up = 0;
      for (const p of G.parts) {
        if (!p.live) continue;
        if (p.kind === 'flame') flame++;
        else if (p.kind === 'spark' && p.vy < 0) rise++;
        if (p.vy < 0) up++;
      }
      // 底部 1/4 区域的上升粒子数（判断是否「从最下方升起」）
      let low = 0;
      for (const p of G.parts) if (p.live && p.kind === 'spark' && p.y > 600) low++;
      return { tier: G.tier, flame, rise, up, low };
    });
    console.log('combo ' + lvl + ' → tier ' + st.tier + ' 火焰 ' + st.flame + ' 上升 ' + st.rise + ' 向上 ' + st.up + ' 下 1/4 区 ' + st.low);
    await page.screenshot({ path: path.join(OUT, 'rise-' + lvl + '.png') });
  }

  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); }
    requestAnimationFrame(tick);
  }));
  console.log('满特效 fps ≈ ' + fps);
  console.log('errors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
