/* 结算界面截图 + 复制战报按钮验证 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);

  const cases = [
    { g: 'S', p: 356, gd: 0, m: 0, score: 128450, combo: 356 },
    { g: 'B', p: 240, gd: 60, m: 12, score: 74210, combo: 96 }
  ];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    await page.evaluate(c => {
      const G = window.__game.G;
      G.counts.perfect = c.p; G.counts.good = c.gd; G.counts.miss = c.m;
      G.score = c.score; G.maxCombo = c.combo; G.combo = c.combo;
      window.__game.finishGame();
    }, c);
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, 'result-' + i + '.png') });
    const t = await page.evaluate(() => ({
      note: document.querySelector('#r-note').textContent,
      rank: document.querySelector('#r-rank-num').textContent,
      cheer: document.querySelector('#r-cheer').textContent,
      report: window.__game.G.reportText,
      btn: !!document.querySelector('#btn-copy'),
      panelH: document.querySelector('#result-panel').getBoundingClientRect().height,
      overflow: (() => {
        const inner = document.querySelector('#result-inner');
        return inner.scrollHeight - inner.clientHeight;
      })()
    }));
    console.log('case' + i + ' rank=' + t.rank + ' overflow=' + t.overflow + ' btn=' + t.btn);
    console.log('  note: ' + t.note);
    console.log('  cheer: ' + t.cheer);
    console.log('  report: ' + JSON.stringify(t.report));
    // 点复制
    await page.click('#btn-copy');
    await page.waitForTimeout(320);
    const btnTxt = await page.evaluate(() => document.querySelector('#btn-copy').textContent);
    const clip = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'ERR:' + e.message; } });
    console.log('  复制按钮文案: ' + btnTxt + ' / 剪贴板: ' + JSON.stringify(clip));
    await page.waitForTimeout(1600);
    // 回到标题准备下一轮
    await page.evaluate(() => window.__game.toTitle());
    await page.waitForTimeout(400);
    await page.click('.diff-card[data-diff="hard"]');
    await page.keyboard.press('Space');
    await page.waitForTimeout(2600);
  }
  console.log('errors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
