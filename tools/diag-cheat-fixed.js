/* 修复后验证:暂停面板作弊行 + 各状态开关一致性 */
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

  const state = () => page.evaluate(() => ({
    st: window.__game.G.state, auto: window.__game.G.autoPerfect, run: window.__game.G.cheatRun,
    hud: document.querySelector('#hud-cheat').classList.contains('on'),
    pauseLbl: document.querySelector('#btn-pause-cheat .lbl').textContent,
    pauseBtnVisible: (() => { const b = document.querySelector('#btn-pause-cheat'); const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
  }));

  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('--- A. 暂停面板点作弊按钮(关→开) ---');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('#btn-pause-cheat');
  await page.waitForTimeout(250);
  console.log(JSON.stringify(await state()));
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shots', 'cheat-pause-fixed.png') });

  console.log('--- B. 暂停中首开作弊 → cheatRun 应标记 ---');
  // 重开一局,直接在暂停里首开(验证 cheatRun 标记修复)
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(2600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyC');     // C 备用键
  await page.waitForTimeout(200);
  console.log('按 C 开作弊:', JSON.stringify(await state()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  console.log('恢复后:', JSON.stringify(await state()));

  console.log('--- C. 暂停中关作弊再结算(应仍算作弊局) ---');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyC');     // 关
  await page.waitForTimeout(200);
  console.log('关掉后:', JSON.stringify(await state()));
  await page.evaluate(() => window.__game.finishGame());
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => ({
    ribbon: document.querySelector('#r-ribbon').textContent,
    ribbonShown: document.querySelector('#r-ribbon').style.display !== 'none',
    note: document.querySelector('#r-note').textContent.slice(-40),
  }));
  console.log('结算:', JSON.stringify(res));

  console.log('页面错误:', errs.length ? errs.slice(0, 5) : '无');
  await browser.close();
})();
