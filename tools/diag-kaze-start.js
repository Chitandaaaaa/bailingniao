/* kaze 开局精细诊断:100ms 采样,定位第一颗音符被判 miss 的确切时刻 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  await page.evaluate(() => { window.__game.toTitle(); });
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await window.__game.setSong('kaze'); });
  await page.waitForFunction(() => window.__game.Sound.ready, { timeout: 30000 });

  // rAF 内采样:每个游戏帧都记,直到 t>6s
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__frames = [];
    window.__rec = true;
    const origFrame = null;
    const hook = () => {
      if (!window.__rec) return;
      if (G.state === 'PLAYING' || G.state === 'COUNTDOWN') {
        const f = window.__frames;
        if (f.length === 0 || G.songTime !== f[f.length - 1].st || f.length < 600) {
          f.push({
            st: +G.songTime.toFixed(4), state: G.state, n: G.notes.length, cur: G.cursor,
            miss: G.counts.miss, perf: G.counts.perfect,
            n0: G.notes[0] ? (G.notes[0].judged ? G.notes[0].kind : 'pend') : '-',
            n1: G.notes[1] ? (G.notes[1].judged ? G.notes[1].kind : 'pend') : '-',
            auto: !!G.autoPerfect,
            ctx: window.__game.Sound.ctx ? window.__game.Sound.ctx.state : 'null',
            ct: +(window.__game.Sound.chartTime()).toFixed(4),
          });
        }
        if (G.songTime > 7) window.__rec = false;
      }
      requestAnimationFrame(hook);
    };
    requestAnimationFrame(hook);
  });

  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForTimeout(11000);

  const data = await page.evaluate(() => {
    window.__rec = false;
    const fr = window.__frames;
    // 找关键转折:notes[0] 从 pend 变 miss 的帧
    let iMiss = fr.findIndex(f => f.n0 === 'miss');
    return {
      total: fr.length,
      first: fr.slice(0, 6),
      aroundMiss: iMiss >= 0 ? fr.slice(Math.max(0, iMiss - 8), iMiss + 4) : null,
      missAt: iMiss >= 0 ? fr[iMiss] : null,
      last: fr.slice(-3),
      // 帧间隔异常:st 相邻两帧差 > 0.1s 的位置
      jumps: (() => {
        const out = [];
        for (let i = 1; i < fr.length; i++) {
          const d = fr[i].st - fr[i - 1].st;
          if (d > 0.09) out.push({ i, d: +d.toFixed(3), from: fr[i - 1].st, to: fr[i].st, state: fr[i].state });
        }
        return out.slice(0, 10);
      })(),
    };
  });
  console.log(JSON.stringify(data, null, 1));
  console.log('页面错误:', errs.length ? errs.slice(0, 5) : '无');
  await browser.close();
})();
