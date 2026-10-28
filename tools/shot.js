/* 视觉截图：1200x800 精确视口，抓多个时刻 */
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
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'v1-title.png') });

  // 等音频合成完成
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.screenshot({ path: path.join(OUT, 'v2-title-ready.png') });

  // 开始
  await page.keyboard.press('Space');
  await page.waitForTimeout(5200);   // 倒计时 + 进场
  await page.screenshot({ path: path.join(OUT, 'v3-playing.png') });

  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, 'v4-playing-notes.png') });

  // 自动打歌：持续命中最近的音符，攒 combo 触发庆典
  await page.evaluate(() => {
    const g = window.__game;
    window.__auto = setInterval(() => {
      const G = g.G; if (G.state !== 'PLAYING') return;
      const t = g.Sound.chartTime();
      let best = null, bd = 1e9;
      for (const n of G.notes) {
        if (n.judged || n.done) continue;
        const d = Math.abs(n.t - t);
        if (d < bd && d < 0.10) { bd = d; best = n; }
      }
      if (best) g.hitLane(best.lane, best.t);
    }, 16);
  });
  await page.waitForTimeout(4200);
  await page.screenshot({ path: path.join(OUT, 'v5-combo.png') });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, 'v6-combo2.png') });

  // 强制触发 100 连击庆典观察特效
  await page.evaluate(() => { window.__game.G.combo = 99; window.__game.celebrate(100); });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, 'v7-celebrate100-a.png') });
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(OUT, 'v8-celebrate100-b.png') });

  // 暂停
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'v9-pause.png') });

  // 结算
  await page.evaluate(() => {
    clearInterval(window.__auto);
    const g = window.__game;
    g.G.counts = { perfect: 380, good: 38, miss: 4 }; g.G.maxCombo = 132; g.G.score = 58240;
    g.finishGame();
  });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, 'v10-result.png') });

  console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
  const info = await page.evaluate(() => {
    const st = document.getElementById('stage');
    const r = st.getBoundingClientRect();
    return { stage: [r.width, r.height, r.x, r.y], vw: innerWidth, vh: innerHeight };
  });
  console.log('stage rect:', JSON.stringify(info));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
