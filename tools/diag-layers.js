/* 对比 tier4（299 连击）与 tier5（301 连击）各特效层的实际 opacity，找出 tier5 反而变弱的层 */
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
  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const layers = async () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#combo-full .cf').forEach(el => {
      const cs = getComputedStyle(el);
      out[el.className.replace('cf cf-', '')] = {
        op: +(parseFloat(cs.opacity) || 0).toFixed(2),
        disp: cs.display,
        dur: cs.animationDuration
      };
    });
    const shell = getComputedStyle(document.querySelector('#combo-full'));
    return { tier: window.__game.G.tier, cls: document.body.className, shellOp: +parseFloat(shell.opacity).toFixed(2), layers: out };
  });

  for (const [name, combo] of [['cmp4', 250], ['cmp5', 350]]) {
    await page.evaluate(c => {
      if (window.__pin) clearInterval(window.__pin);
      const G = window.__game.G;
      G.combo = c; G.maxCombo = c;
      window.__pin = setInterval(() => { G.combo = c; G.maxCombo = c; }, 40);
    }, combo);
    await page.waitForTimeout(2600);
    const st = await layers();
    console.log('--- ' + name + ' (combo ' + combo + ') tier' + st.tier + ' | ' + st.cls + ' | #combo-full opacity ' + st.shellOp);
    for (const k of Object.keys(st.layers)) {
      const L = st.layers[k];
      console.log('    ' + k.padEnd(10) + ' opacity ' + String(L.op).padEnd(5) + ' display ' + L.disp.padEnd(6) + ' anim ' + L.dur);
    }
    await page.screenshot({ path: path.join(OUT, 'cmp-' + name + '.png') });
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
