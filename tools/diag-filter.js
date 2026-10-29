/* 对照实验：把已删除的 hue-rotate 全屏 filter 动画临时加回去，看帧率/降级是否明显变差 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

const measure = page => page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now(); const ds = [];
  let last = t0;
  function tick() {
    const t = performance.now(); n++; ds.push(t - last); last = t;
    if (t - t0 < 2500) requestAnimationFrame(tick);
    else {
      ds.sort((a, b) => a - b);
      res({
        fps: Math.round(n / ((performance.now() - t0) / 1000)),
        p50: +ds[(ds.length * 0.5) | 0].toFixed(1),
        p95: +ds[(ds.length * 0.95) | 0].toFixed(1),
        perf: window.__game.G.perf, lowSpec: window.__game.G.lowSpec
      });
    }
  }
  requestAnimationFrame(tick);
}));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });   // 放大渲染开销差异

  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 30000 });
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__pin = setInterval(() => { G.combo = 360; G.maxCombo = 360; }, 50);
  });
  await page.waitForTimeout(3500);

  console.log('① 现状（已移除 hue-rotate 动画）:', JSON.stringify(await measure(page)));

  await page.addStyleTag({
    content: `.cf-plasma{animation:cfSpin 5s linear infinite,cfHueTest 4s linear infinite!important}
      .cf-prism{animation:cfPrismTest 2.6s linear infinite!important}
      @keyframes cfHueTest{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(360deg)}}
      @keyframes cfPrismTest{0%{background-position:0 0;filter:hue-rotate(0deg)}100%{background-position:120px 0;filter:hue-rotate(360deg)}}`
  });
  await page.waitForTimeout(2500);
  console.log('② 把 hue-rotate 动画加回去:', JSON.stringify(await measure(page)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
