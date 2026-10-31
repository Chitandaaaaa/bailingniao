/* 全曲作弊回归:summer 全程 216s,期间模拟用户中途关/开作弊,采样验证 autoPerfect=true 期间零 MISS */
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

  // 高频采样:每 150ms 记 songTime/miss/cheat/combo/fps
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__log = [];
    let lastT = 0, lastMiss = 0;
    window.__sampler = setInterval(() => {
      if (G.state !== 'PLAYING') return;
      const r = { t: +G.songTime.toFixed(2), miss: G.counts.miss, auto: !!G.autoPerfect, combo: G.combo, cur: G.cursor };
      // 记录「作弊开着期间新增的 miss」
      if (r.auto && r.miss !== lastMiss) window.__log.push(Object.assign({ ev: 'MISS_WHILE_CHEAT' }, r));
      if (!r.auto && r.miss !== lastMiss) window.__log.push(Object.assign({ ev: 'miss_while_manual' }, r));
      if (r.t - lastT > 0.4) window.__log.push({ ev: 'timeJump', from: lastT, to: r.t });
      lastT = r.t; lastMiss = r.miss;
    }, 150);
  });

  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForTimeout(2600);

  // 中途 3 次关→开(模拟用户摆弄),其余时间保持开
  const t0 = Date.now();
  let toggles = 0;
  const marks = [40000, 90000, 150000];
  while (Date.now() - t0 < 240000) {
    await page.waitForTimeout(1500);
    const el = Date.now() - t0;
    if (toggles < marks.length && el > marks[toggles]) {
      await page.keyboard.press('F2');   // 关
      await page.waitForTimeout(700);    // 关 0.7s(这期间的 miss 是预期)
      await page.keyboard.press('F2');   // 开
      toggles++;
      console.log('  切换 #' + toggles + ' @ ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    const st = await page.evaluate(() => ({ s: window.__game.G.state, t: +window.__game.G.songTime.toFixed(0) }));
    if (st.s === 'RESULT') { console.log('  打完了 @t=' + st.t); break; }
    if (st.s !== 'PLAYING') console.log('  状态:', st.s, '@t=' + st.t);
  }

  const fin = await page.evaluate(() => {
    clearInterval(window.__sampler);
    const G = window.__game.G;
    return { state: G.state, counts: G.counts, notes: G.notes.length, cursor: G.cursor, maxCombo: G.maxCombo, auto: G.autoPerfect, run: G.cheatRun,
             log: window.__log.filter(l => l.ev !== 'miss_while_manual') };
  });
  console.log('\n最终:', JSON.stringify({ ...fin, log: undefined }));
  console.log('作弊期间异常事件(' + fin.log.length + '):');
  fin.log.slice(0, 20).forEach(l => console.log(' ', JSON.stringify(l)));
  console.log('页面错误:', errs.length ? errs.slice(0, 8) : '无');
  await browser.close();
})();
