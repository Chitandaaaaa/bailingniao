/* 长按音符分布诊断：各难度下 hold 的时间分布 / 密度 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

  for (const mode of ['easy', 'hard', 'nightmare']) {
    await page.goto(FILE);
    await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
    await page.reload();
    await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
    await page.click('.diff-card[data-diff="' + mode + '"]');
    await page.keyboard.press('Space');
    await page.waitForTimeout(3000);

    const r = await page.evaluate(() => {
      const G = window.__game.G;
      const END = 214.8;
      const ns = G.notes.slice().sort((a, b) => a.t - b.t);
      const holds = ns.filter(n => n.type === 'hold');
      const seg = 10, segCnt = [], segNotes = [];
      for (let i = 0; i < seg; i++) {
        const a = END * i / seg, b = END * (i + 1) / seg;
        segCnt.push(holds.filter(n => n.t >= a && n.t < b).length);
        segNotes.push(ns.filter(n => n.t >= a && n.t < b).length);
      }
      // 相邻 hold 最小间隔
      let minGap = 1e9;
      for (let i = 1; i < holds.length; i++) minGap = Math.min(minGap, holds[i].t - holds[i - 1].t);
      const beats = {};
      holds.forEach(h => beats[h.holdBeats] = (beats[h.holdBeats] || 0) + 1);
      return {
        mode: G.mode, total: ns.length, holds: holds.length,
        pct: +(holds.length / ns.length * 100).toFixed(1),
        segCnt, segNotes, minGap: isFinite(minGap) ? +minGap.toFixed(2) : null, beats,
        span: holds.length ? [Math.round(holds[0].t), Math.round(holds[holds.length - 1].t)] : null,
        lanes: [...new Set(holds.map(h => h.lane))],
        list: holds.map(n => Math.round(n.t) + 's/L' + n.lane + '/' + n.holdBeats)
      };
    });
    console.log('\n[' + r.mode + '] 音符 ' + r.total + '  hold ' + r.holds + ' (' + r.pct + '%)' +
      '  跨度 ' + (r.span ? r.span[0] + '→' + r.span[1] + 's' : '-') +
      '  最小间隔 ' + r.minGap + 's  轨道 ' + r.lanes.join(',') +
      '  拍长 ' + JSON.stringify(r.beats));
    console.log('  每 1/10 段 hold  ' + r.segCnt.join(' | '));
    console.log('  每 1/10 段 音符  ' + r.segNotes.join(' | '));
    console.log('  ' + r.list.join('  '));
  }
  await browser.close();
})();
