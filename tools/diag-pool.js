/* 诊断：高连击 + 谱面后段（密集段）时，粒子池是否被打满（打满后新粒子会立刻覆盖旧粒子 → 视觉上特效"变少"） */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
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
  await page.waitForTimeout(1500);

  // 锁住连击，把谱面整体平移到后段（那里音符最密），制造真实的高压场景
  const info = await page.evaluate(() => {
    const G = window.__game.G;
    const before = { notes: G.notes.length, t0: G.notes[0] && G.notes[0].t, t1: G.notes[G.notes.length - 1] && G.notes[G.notes.length - 1].t };
    // 统计原谱面每 10 秒的音符数，找出最密的一段
    const bins = {};
    for (const n of G.notes) { const b = Math.floor(n.t / 10); bins[b] = (bins[b] || 0) + 1; }
    const dens = Object.keys(bins).map(k => [Number(k), bins[k]]).sort((a, b) => b[1] - a[1]);
    return { before, densest: dens.slice(0, 5) };
  });
  console.log('谱面: ' + JSON.stringify(info.before));
  console.log('最密的 10 秒段: ' + JSON.stringify(info.densest));

  // 平移到最密段的开头
  const startSec = info.densest[0][0] * 10;
  await page.evaluate((sec) => {
    const G = window.__game.G;
    const off = sec - G.songTime;
    for (const n of G.notes) n.t -= off;
    G.cursor = 0;
    G.combo = 320; G.maxCombo = 320;
    window.__pin = setInterval(() => { if (G.combo < 320) { G.combo = 320; G.maxCombo = 320; } }, 50);
  }, startSec);

  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate(() => {
      const G = window.__game.G;
      let live = 0, feather = 0, spark = 0, flame = 0, rise = 0;
      for (const p of G.parts) {
        if (!p.live) continue;
        live++;
        if (p.kind === 'feather') feather++;
        else if (p.kind === 'flame') flame++;
        else if (p.kind === 'spark' && p.wob > 0) rise++;
        else spark++;
      }
      return {
        combo: G.combo, perf: G.perf, songTime: +G.songTime.toFixed(1),
        live, feather, spark, flame, rise,
        use: +(live / 1200 * 100).toFixed(0),
        rings: G.rings.length, flashes: G.flashes.length
      };
    });
    console.log('t+' + (i + 1) + 's 池占用 ' + st.use + '% (' + st.live + '/1200)' +
      ' 羽' + st.feather + ' 星' + st.spark + ' 火' + st.flame + ' 升' + st.rise +
      ' | perf ' + st.perf + ' rings ' + st.rings + ' flash ' + st.flashes);
  }
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
