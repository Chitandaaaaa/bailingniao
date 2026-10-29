/* 把 index.html 里真实的音乐弹奏点（musicOnsets 的 cell 序列）导出成
   tools/lab-cells.js，供 chart-lab.html 离线复用。
   口径与主代码完全一致：聚合间隔 55ms、p 取窗口内最高音、w 取力度和。 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

/* 与 index.html 的 PIANO_LO/HI + SCALE_D 一致 */
const PIANO_LO = 30, PIANO_HI = 86, SCALE_D = [0, 1, 2, 4, 6, 7, 8, 9, 11];
const PIANO_MIDI = (() => { const o = []; for (let m = PIANO_LO; m <= PIANO_HI; m++) if (SCALE_D.indexOf(m % 12) >= 0) o.push(m); return o; })();

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 120000 });

  const out = {};
  for (const id of ['summer', 'kaze']) {
    await page.evaluate(id => window.__game.setSong(id), id);
    await page.waitForFunction(() => true);
    /* 等事件表就绪（合成曲同步就有；音频曲要等解码+落点解析） */
    await page.waitForFunction(() => {
      const ev = window.__game.Sound.events;
      return ev && ev.length > 60;
    }, { timeout: 120000 });
    const raw = await page.evaluate(() => ({
      ev: window.__game.Sound.events.map(e => ({ t: e.t, k: e.k, g: e.g, p: e.p })),
      song: window.__game.song.timeline,
      id: window.__game.song.id
    }));
    /* 复刻 musicOnsets() */
    const cells = [];
    for (const e of raw.ev) {
      if (e.t > raw.song.chartEnd) continue;
      let c = cells.length ? cells[cells.length - 1] : null;
      if (!c || e.t - c.t > 0.055) { c = { t: e.t, s: 0, p: 0, n: 0 }; cells.push(c); }
      c.s += e.g; c.n++;
      const p = (e.p != null) ? e.p : (PIANO_MIDI[+String(e.k).slice(2)] || 60);
      if (p > c.p) c.p = p;
    }
    out[id] = {
      id,
      timeline: raw.song,
      cells: cells.map(c => [c.t, c.s, c.p])
    };
    console.log(id + ': cells=' + cells.length + ' 事件=' + raw.ev.length +
      ' 时长=' + raw.song.chartEnd + ' beat=' + raw.song.beat);
  }
  if (errs.length) console.log('页面异常:', errs);

  const js = '/* 自动生成：node tools/dump-cells.js —— 不要手改 */\n' +
    'window.LAB_CELLS=' + JSON.stringify(out) + ';\n';
  fs.writeFileSync(path.join(__dirname, 'lab-cells.js'), js);
  console.log('写入 tools/lab-cells.js  ' + (js.length / 1024).toFixed(1) + 'KB');
  await browser.close();
})();
