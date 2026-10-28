/* 诊断：谱面音符是否与音乐实际弹奏点同步 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const g = window.__game, G = g.G;
    const ev = g.Sound.events || [];
    const ts = ev.map(e => +e.t.toFixed(3)).sort((a, b) => a - b);
    const onsets = [];
    for (const t of ts) if (!onsets.length || t - onsets[onsets.length - 1] > 0.05) onsets.push(t);
    const nearest = t => {
      let lo = 0, hi = onsets.length - 1;
      if (!onsets.length) return 1e9;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (onsets[mid] < t) lo = mid + 1; else hi = mid;
      }
      return Math.min(Math.abs(onsets[lo] - t), Math.abs(onsets[Math.max(0, lo - 1)] - t));
    };
    const diffs = G.notes.map(n => nearest(n.t) * 1000);
    const sorted = diffs.slice().sort((a, b) => a - b);
    const pct = ms => Math.round(diffs.filter(d => d <= ms).length / diffs.length * 100);
    return {
      events: ev.length, onsets: onsets.length,
      onsetsPerSec: +(onsets.length / 216).toFixed(2),
      notes: G.notes.length,
      within60: pct(60), within120: pct(120), within250: pct(250),
      med: Math.round(sorted[sorted.length >> 1]),
      p90: Math.round(sorted[Math.floor(sorted.length * 0.9)])
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
