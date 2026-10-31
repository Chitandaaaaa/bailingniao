/* 换变量抓偶发:噩梦难度 / kaze 曲 / 开局竞态(未就绪就点开始) / elementFromPoint 检查遮挡 */
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

  // --- A. 按钮遮挡检查:三个状态下按钮中心点最顶层元素是谁 ---
  console.log('=== A. elementFromPoint 遮挡检查 ===');
  const checkHit = async () => page.evaluate(() => {
    const pick = (sel) => {
      const b = document.querySelector(sel);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { sel, top: el ? (el.id || el.className || el.tagName) : 'none', isSelf: el === b || (el && b.contains(el)) };
    };
    return [pick('#title-cheat'), pick('#hud-cheat')].filter(Boolean);
  });
  console.log('TITLE:', JSON.stringify(await checkHit()));
  await page.click('#title-cheat');
  await page.click('#btn-start');
  await page.waitForTimeout(400); // COUNTDOWN
  console.log('COUNTDOWN:', JSON.stringify(await checkHit()));
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
  console.log('PLAYING:', JSON.stringify(await checkHit()));
  await page.evaluate(() => window.__game.toTitle());
  await page.waitForTimeout(300);

  // --- B. 噩梦难度:鼠标流 8 轮 ---
  console.log('=== B. 噩梦难度 鼠标流 8 轮 ===');
  // 切到噩梦:标题页难度卡(找按钮)
  const diffBtn = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('#title-screen button')].map(b => b.textContent.trim());
    return cands;
  });
  console.log('标题页按钮:', JSON.stringify(diffBtn));
  const clickDiff = async (label) => {
    const ok = await page.evaluate((label) => {
      const btns = [...document.querySelectorAll('#title-screen button')];
      const b = btns.find(x => x.textContent.trim() === label);
      if (b) { b.click(); return true; } return false;
    }, label);
    return ok;
  };
  if (await clickDiff('噩梦')) {
    console.log('  已切噩梦');
  } else {
    console.log('  ⚠ 找不到噩梦按钮,用 JS 直切');
    await page.evaluate(() => { const g = window.__game; g.G.diff = 'nightmare'; if (g.applyLanes && g.DIFFS) { /* 下一局生效 */ } });
  }

  let badN = 0;
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      if (g.G.state !== 'TITLE') g.toTitle();
      if (g.G.autoPerfect) document.querySelector('#title-cheat').click();
    });
    await page.waitForTimeout(200);
    await page.click('#title-cheat');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => {
      const G = window.__game.G;
      return { auto: G.autoPerfect, first: G.notes.slice(0, 4).map(n => n.kind), counts: G.counts, diff: G.diff };
    });
    const bad = r.first.filter(k => k === 'miss').length;
    if (bad || !r.auto) badN++;
    console.log(`  #${i + 1} ${bad || !r.auto ? '❌' : '✅'} auto=${r.auto} 前4颗=${JSON.stringify(r.first)} counts=${JSON.stringify(r.counts)}`);
  }

  // --- C. kaze 曲:鼠标流 8 轮(含切歌竞态:立即点开始) ---
  console.log('=== C. kaze 切歌 + 立即点开始的竞态,8 轮 ===');
  let badK = 0;
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      if (g.G.state !== 'TITLE') g.toTitle();
      if (g.G.autoPerfect) document.querySelector('#title-cheat').click();
    });
    await page.waitForTimeout(150);
    // 切 kaze(异步 prepare 启动) → 立刻点作弊 + 立刻点开始(不等 ready,复刻"偶发"最容易出现的竞态)
    await page.evaluate(() => { window.__game.setSong('kaze'); });
    await page.click('#title-cheat');
    await page.click('#btn-start');           // 未就绪 → 排队开局
    await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => {
      const G = window.__game.G;
      return { auto: G.autoPerfect, first: G.notes.slice(0, 4).map(n => n.kind), counts: G.counts, n: G.notes.length };
    });
    const bad = r.first.filter(k => k === 'miss').length;
    if (bad || !r.auto) badK++;
    console.log(`  #${i + 1} ${bad || !r.auto ? '❌' : '✅'} auto=${r.auto} n=${r.n} 前4颗=${JSON.stringify(r.first)} counts=${JSON.stringify(r.counts)}`);
  }

  console.log(`\n结果: 噪梦 ${badN}/8 失效, kaze竞态 ${badK}/8 失效; 页面错误: ${errs.length ? errs.slice(0, 5) : '无'}`);
  await browser.close();
})();
