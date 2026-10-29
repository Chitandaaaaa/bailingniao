/* 验证：弱机（CPU 4x 降速）在 300 连击时是否触发 lowSpec，以及触发后画面掉多少 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'shots');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });   // 模拟弱机

  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const snap = () => page.evaluate(() => {
    const G = window.__game.G;
    let live = 0; for (const p of G.parts) if (p.live) live++;
    return { combo: G.combo, tier: G.tier, lowSpec: G.lowSpec, live,
      cls: document.body.className,
      rays: getComputedStyle(document.querySelector('.cf-rays')).display,
      waves: getComputedStyle(document.querySelector('.cf-waves')).display,
      prism: getComputedStyle(document.querySelector('.cf-prism')).display,
      hint: (document.querySelector('#hint') || {}).textContent || '' };
  });

  // 按档位逐步推高连击，每档停 4 秒
  for (const c of [25, 60, 160, 260, 320, 380]) {
    await page.evaluate(v => {
      if (window.__pin) clearInterval(window.__pin);
      const G = window.__game.G;
      G.combo = v; G.maxCombo = v;
      window.__pin = setInterval(() => { G.combo = v; G.maxCombo = v; }, 60);
    }, c);
    await page.waitForTimeout(4000);
    const st = await snap();
    console.log('combo ' + c + ' → tier' + st.tier +
      ' lowSpec ' + st.lowSpec +
      ' | rays ' + st.rays + ' waves ' + st.waves + ' prism ' + st.prism +
      ' | live ' + st.live + ' | ' + st.cls +
      (st.hint ? ' | hint: ' + st.hint : ''));
    await page.screenshot({ path: path.join(OUT, 'weak-' + c + '.png') });
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
