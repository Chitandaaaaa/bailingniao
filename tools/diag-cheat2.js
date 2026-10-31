/* 作弊模式定向场景:暂停中开作弊 / 灰色区间 / kaze(audio) 曲 / 全程打到终章 */
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

  const waitPlaying = async () => {
    await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
  };

  // ---------- 测试 A:暂停期间按 F2 开作弊,再恢复 ----------
  console.log('=== A. 暂停中开作弊 → 恢复 ===');
  await page.keyboard.press('Space');            // 不开作弊直接开始
  await waitPlaying();
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape');           // 暂停(时钟冻结)
  await page.waitForTimeout(300);
  const pausedT = await page.evaluate(() => ({ state: window.__game.G.state, t: window.__game.G.songTime }));
  await page.keyboard.press('F2');               // 暂停中开作弊
  await page.waitForTimeout(200);
  const a1 = await page.evaluate(() => ({ auto: window.__game.G.autoPerfect, run: window.__game.G.cheatRun }));
  console.log('  暂停中 F2 后:', JSON.stringify(pausedT), 'autoPerfect=' + a1.auto, 'cheatRun=' + a1.run);
  await page.keyboard.press('Escape');           // 恢复
  await waitPlaying();
  // 等接下来 4 秒内的音符全部过线
  await page.waitForTimeout(5000);
  const a2 = await page.evaluate(() => {
    const G = window.__game.G;
    const t = G.songTime;
    const recent = G.notes.filter(n => n.t <= t && n.t > t - 4.5);
    return { state: G.state, t: +t.toFixed(2), miss: G.counts.miss, n: recent.length,
             bad: recent.filter(n => n.kind === 'miss').map(n => ({ t: n.t, lane: n.lane, type: n.type })),
             auto: G.autoPerfect };
  });
  console.log('  恢复后 4.5s 窗口:', JSON.stringify(a2));

  // ---------- 测试 B:恢复后立刻关掉作弊(模拟用户手滑再按一次) ----------
  console.log('=== B. 作弊开着暂停→恢复后 0.5s 关掉→再开 ===');
  await page.keyboard.press('F2');               // 关
  await page.waitForTimeout(500);
  await page.keyboard.press('F2');               // 开
  await page.waitForTimeout(4000);
  const b1 = await page.evaluate(() => {
    const G = window.__game.G;
    const t = G.songTime;
    const recent = G.notes.filter(n => n.t <= t && n.t > t - 4);
    return { miss: G.counts.miss, bad: recent.filter(n => n.kind === 'miss').map(n => ({ t: n.t, lane: n.lane })), auto: G.autoPerfect };
  });
  console.log('  再开后 4s 窗口:', JSON.stringify(b1));

  // ---------- 测试 C:切 kaze(audio 型)全程开作弊跑 ----------
  console.log('=== C. kaze(audio 型) 开作弊 ===');
  await page.evaluate(() => {
    window.__game.toTitle();
    // 归零作弊状态(前面场景可能把它开着,直接 F2 会变成"关")
    if (window.__game.G.autoPerfect) document.querySelector('#title-cheat').click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await window.__game.setSong('kaze'); });
  await page.waitForFunction(() => window.__game.Sound.ready, { timeout: 30000 });
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForTimeout(2600);
  await waitPlaying();
  const cT0 = Date.now();
  let cResult = null;
  while (Date.now() - cT0 < 110000) {
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({ state: window.__game.G.state, miss: window.__game.G.counts.miss, t: +window.__game.G.songTime.toFixed(1) }));
    if (st.miss > 0) { console.log('  ⚠ kaze 出现 MISS: ' + JSON.stringify(st)); cResult = st; break; }
    if (st.state === 'RESULT') break;
  }
  const c1 = await page.evaluate(() => {
    const G = window.__game.G;
    return { state: G.state, t: +G.songTime.toFixed(1), counts: G.counts, notes: G.notes.length, cursor: G.cursor };
  });
  console.log('  kaze 状态:', JSON.stringify(c1), cResult ? '(中途有 MISS)' : '(期间零 MISS)');

  console.log('页面错误:', errs.length ? errs.slice(0, 8) : '无');
  await browser.close();
})();
