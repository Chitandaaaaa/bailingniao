/* 作弊模式回归:开着自动完美打一局,抓「有时候不生效」的现场 */
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
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  // 采样记录:每 250ms 记一次 counts/combo/cursor/songTime,miss 或 combo 断裂即抓现场
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__snap = [];
    window.__events = [];
    window.__lastMiss = 0; window.__lastCombo = 0;
    window.__sampler = setInterval(() => {
      if (G.state !== 'PLAYING') return;
      const s = {
        t: +G.songTime.toFixed(3), miss: G.counts.miss, good: G.counts.good, perf: G.counts.perfect,
        combo: G.combo, cursor: G.cursor, cheat: !!G.autoPerfect,
        ctx: window.__game.Sound.ctx ? window.__game.Sound.ctx.state : 'null',
      };
      if (s.miss !== window.__lastMiss || (s.combo === 0 && window.__lastCombo > 0)) {
        window.__events.push(Object.assign({ reason: s.miss !== window.__lastMiss ? 'miss+' : 'comboBreak' }, s));
        // 抓现场:cursor 附近未判定的音符
        const near = [];
        for (let i = Math.max(0, G.cursor - 2); i < Math.min(G.notes.length, G.cursor + 4); i++) {
          const n = G.notes[i];
          near.push({ i, t: +n.t.toFixed(3), lane: n.lane, judged: n.judged, kind: n.kind, type: n.type });
        }
        window.__events[window.__events.length - 1].near = near;
        window.__events[window.__events.length - 1].empty = G.emptyCount.slice();
        window.__events[window.__events.length - 1].holds = G.holds.map(h => ({ lane: h.lane, end: +h.holdEnd.toFixed(2) }));
      }
      window.__lastMiss = s.miss; window.__lastCombo = s.combo;
      if (window.__snap.length < 4000) window.__snap.push(s);
    }, 250);
  });

  // 场景一:F2 开作弊 → 空格开始 → 打 100 秒
  await page.keyboard.press('F2');
  await page.waitForTimeout(200);
  const cheatOn = await page.evaluate(() => window.__game.G.autoPerfect);
  console.log('F2 开关生效:', cheatOn);
  await page.keyboard.press('Space');
  await page.waitForTimeout(2600); // 倒计时

  const t0 = Date.now();
  while (Date.now() - t0 < 100000) {
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => ({ state: window.__game.G.state, miss: window.__game.G.counts.miss, t: +window.__game.G.songTime.toFixed(1) }));
    if (st.state === 'RESULT') break;
    if (st.state !== 'PLAYING') console.log('  状态:', st.state, 't=' + st.t);
  }

  const ev1 = await page.evaluate(() => ({ events: window.__events, last: window.__snap[window.__snap.length - 1] }));
  console.log('\n=== 场景一:从头开作弊,100 秒内 ===');
  console.log('事件数:', ev1.events.length);
  ev1.events.slice(0, 12).forEach(e => console.log(JSON.stringify(e)));

  // 场景二:中途暂停/恢复几次
  console.log('\n=== 场景二:暂停/恢复轮番 ===');
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(4000);
  const ev2 = await page.evaluate(() => window.__events.slice(12));
  console.log('新增事件数:', ev2.length);
  ev2.slice(0, 12).forEach(e => console.log(JSON.stringify(e)));

  // 场景三:关掉再开(中途切换)
  console.log('\n=== 场景三:中途关→开 ===');
  await page.keyboard.press('F2');
  await page.waitForTimeout(1500);
  await page.keyboard.press('F2');
  await page.waitForTimeout(5000);
  const ev3 = await page.evaluate(() => window.__events.slice(-6));
  console.log('新增事件数:', ev3.length);
  ev3.forEach(e => console.log(JSON.stringify(e)));

  const fin = await page.evaluate(() => {
    const G = window.__game.G;
    return { state: G.state, counts: G.counts, combo: G.combo, maxCombo: G.maxCombo, cursor: G.cursor, notes: G.notes.length, t: +G.songTime.toFixed(1), cheat: G.autoPerfect, cheatRun: G.cheatRun };
  });
  console.log('\n最终状态:', JSON.stringify(fin));
  console.log('页面错误:', errs.length ? errs.slice(0, 8) : '无');

  await page.screenshot({ path: path.join(ROOT, 'tools', 'shots', 'diag-cheat.png') });
  await browser.close();
})();
