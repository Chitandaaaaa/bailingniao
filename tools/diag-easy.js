/* easy 单轨场景：为什么后段没有长按？统计候选拒绝原因 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.click('.diff-card[data-diff="easy"]');
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => {
    const G = window.__game.G;
    const ns = G.notes.slice().sort((a, b) => a.t - b.t);
    const BEAT = 0.6, BAR = 2.4;
    const seg = 10, segRep = [];
    for (let s = 0; s < seg; s++) {
      const a = 214.8 * s / seg, b = 214.8 * (s + 1) / seg;
      const arr = ns.filter(n => n.t >= a && n.t < b);
      const gaps = [];
      for (let i = 1; i < arr.length; i++) gaps.push(arr[i].t - arr[i - 1].t);
      gaps.sort((x, y) => x - y);
      segRep.push({
        seg: s, n: arr.length,
        gapMax: gaps.length ? +gaps[gaps.length - 1].toFixed(2) : 0,
        gapMed: gaps.length ? +gaps[gaps.length >> 1].toFixed(2) : 0,
        n60: gaps.filter(g => g >= 0.6).length,
        n62: gaps.filter(g => g >= 0.62).length,
        n78: gaps.filter(g => g >= 0.78).length,
        n152: gaps.filter(g => g >= 1.52).length
      });
    }
    // 计算 easy 谱面各音符 room（同轨空档），统计后段
    const room = ns.map((n, i) => {
      for (let j = i + 1; j < ns.length; j++) if (ns[j].lane === n.lane) return +(ns[j].t - n.t).toFixed(2);
      return 9;
    });
    const back = ns.map((n, i) => ({ t: n.t, room: room[i], type: n.type })).filter(o => o.t >= 130);
    const backRooms = back.filter(o => o.type !== 'hold').map(o => o.room).sort((a, b) => b - a);
    return { segRep, backTop: backRooms.slice(0, 15), holds: ns.filter(n => n.type === 'hold').length };
  });
  console.log('easy 每段间隔统计');
  r.segRep.forEach(s => console.log('  段' + s.seg + ' 音符' + s.n + ' 间隔 max/med ' + s.gapMax + '/' + s.gapMed +
    's  ≥0.6s:' + s.n60 + ' ≥0.62s:' + s.n62 + ' ≥0.78s:' + s.n78 + ' ≥1.52s:' + s.n152));
  console.log('\n130s 之后非 hold 音符的同轨空档 top15: ' + r.backTop.join(', '));
  console.log('easy hold 总数 ' + r.holds);
  await browser.close();
})();
