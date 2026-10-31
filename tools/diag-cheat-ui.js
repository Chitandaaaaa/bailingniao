/* 作弊开关 UI 验证:各状态下按钮点击/F2 是否生效、反馈是否可见 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  const state = () => page.evaluate(() => ({
    st: window.__game.G.state, auto: window.__game.G.autoPerfect, run: window.__game.G.cheatRun,
    hudBtn: document.querySelector('#hud-cheat').classList.contains('on'),
    titleBtn: document.querySelector('#title-cheat').getAttribute('aria-pressed'),
    hint: (document.querySelector('#hud-hint').textContent || '') + '|' + document.querySelector('#hud-hint').classList.contains('show'),
    hintAbovePause: (() => {  // hint 是否在暂停面板之上(可见)
      const h = document.querySelector('#hud-hint');
      return getComputedStyle(h).opacity;
    })(),
  }));

  console.log('--- 1. 标题页点按钮 ---');
  await page.click('#title-cheat');
  console.log(JSON.stringify(await state()));
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shots', 'cheat-title-on.png') });

  console.log('--- 2. 开着作弊开始游戏(等倒计时结束) ---');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 15000 });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await state()));

  console.log('--- 3. 暂停中按 F2(关) — 反馈可见? ---');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('F2');
  await page.waitForTimeout(300);
  console.log(JSON.stringify(await state()));
  await page.screenshot({ path: path.join(ROOT, 'tools', 'shots', 'cheat-paused-f2.png') });

  console.log('--- 4. 暂停中再按 F2(开) + C 键测试 ---');
  await page.keyboard.press('F2');
  await page.waitForTimeout(200);
  const s4 = await state();
  console.log(JSON.stringify(s4));
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  console.log('按 C 后(期望无变化,C 未绑定):', JSON.stringify(await state()));
  await page.keyboard.press('Escape'); // 恢复
  await page.waitForTimeout(1200);
  console.log('恢复后:', JSON.stringify(await state()));

  await browser.close();
})();
