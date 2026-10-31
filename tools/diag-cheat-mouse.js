/* 纯鼠标流复现:点作弊→点开始→盯开局前几秒,连跑 N 轮抓偶发失效 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');
const N = parseInt(process.argv[2] || '10', 10);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  // 帧级记录器:autoPerfect 翻转 + 前 5 颗音符判定时刻
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__trace = [];
    window.__tracing = false;
    window.__lastAuto = null;
    (function hook() {
      if (window.__tracing && (G.state === 'PLAYING' || G.state === 'COUNTDOWN')) {
        const auto = !!G.autoPerfect;
        if (auto !== window.__lastAuto) {
          window.__trace.push({ ev: 'autoFlip', to: auto, st: G.state, t: +G.songTime.toFixed(3) });
          window.__lastAuto = auto;
        }
        if (G.state === 'PLAYING' && G.songTime > 8) window.__tracing = false;
      }
      requestAnimationFrame(hook);
    })();
  });

  let caught = 0;
  for (let i = 0; i < N; i++) {
    // 回标题,确保作弊 OFF 起步
    await page.evaluate(() => {
      const g = window.__game;
      if (g.G.state !== 'TITLE') g.toTitle();
      if (g.G.autoPerfect) document.querySelector('#title-cheat').click();   // 归零为 OFF
      window.__trace.length = 0; window.__lastAuto = false; window.__tracing = true;
    });
    await page.waitForTimeout(250);

    // 用户操作:鼠标点「作弊」→ 鼠标点「开始演奏」
    await page.click('#title-cheat');
    const afterCheat = await page.evaluate(() => ({ auto: window.__game.G.autoPerfect, aria: document.querySelector('#title-cheat').getAttribute('aria-pressed') }));
    await page.click('#btn-start');

    // 等进入演奏,记录开局前 8 秒
    await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
    await page.waitForTimeout(8500);

    const r = await page.evaluate(() => {
      const G = window.__game.G;
      const first = G.notes.slice(0, 5).map(n => ({ t: +n.t.toFixed(2), kind: n.kind }));
      return {
        autoNow: !!G.autoPerfect, run: G.cheatRun, counts: G.counts, t: +G.songTime.toFixed(1),
        first, trace: window.__trace.slice(0, 8),
      };
    });
    const bad = r.first.filter(n => n.kind === 'miss').length;
    const failed = !r.autoNow || bad > 0;
    if (failed) caught++;
    console.log(`#${i + 1} ${failed ? '❌ 失效' : '✅'} 点作弊后auto=${afterCheat.auto} aria=${afterCheat.aria} 现在auto=${r.autoNow} run=${r.run} 前5颗=${JSON.stringify(r.first)} counts=${JSON.stringify(r.counts)} trace=${JSON.stringify(r.trace)}`);
  }
  console.log(`\n${N} 轮中 ${caught} 轮失效;页面错误: ${errs.length ? errs.slice(0, 5) : '无'}`);
  await browser.close();
})();
