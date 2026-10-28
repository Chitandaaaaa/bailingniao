/* 稀疏段 / 密集段 画面对比截图（简单 + 噩梦） */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file://' + path.join(ROOT, 'index.html');

const POINTS = [
  { key: 'thin', t: 14 },   // 第 1 段（稀疏）
  { key: 'thick', t: 62 }   // 第 3 段（副歌）
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const mode of ['easy', 'nightmare']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(FILE);
    await page.evaluate(m => {
      localStorage.setItem('bailingniao.best', JSON.stringify({
        score: 0, acc: 0, maxChain: 0, plays: 3, seenTutorial: true,
        settings: { colorBlind: false, goodWindow: false, preHighlight: true, reduceMotion: 'off', offsetMs: 0, mode: m }
      }));
    }, mode);
    await page.reload();
    await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
    await page.keyboard.press('Space');
    await page.waitForTimeout(5200);
    await page.evaluate(() => {
      const g = window.__game;
      window.__auto = setInterval(() => {
        const G = g.G; if (G.state !== 'PLAYING') return;
        const t = g.Sound.chartTime();
        for (const n of G.notes) {
          if (n.judged) continue;
          if (Math.abs(n.t - t) < 0.05) g.hitLane(n.lane, n.t);
        }
      }, 12);
    });
    for (const p of POINTS) {
      await page.waitForFunction(t => window.__game.Sound.chartTime() > t, p.t, { timeout: 90000 });
      await page.screenshot({ path: path.join(OUT, `d-${mode}-${p.key}.png`) });
      const info = await page.evaluate(() => {
        const G = window.__game.G, now = window.__game.Sound.chartTime();
        const vis = G.notes.filter(n => !n.judged && n.t > now && n.t < now + 2.4).length;
        return { t: +now.toFixed(1), combo: G.combo, onScreen: vis };
      });
      console.log(mode, p.key, JSON.stringify(info));
    }
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
