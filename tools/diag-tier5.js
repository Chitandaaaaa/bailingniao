/* 诊断：噩梦模式 300 连击前后的特效状态（是否触发 lowSpec、粒子池是否被打满、rings 是否膨胀） */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });

  const sample = () => page.evaluate(() => {
    const G = window.__game.G;
    let live = 0, feather = 0, spark = 0, flame = 0, dead = 0;
    for (const p of G.parts) { if (p.live) { live++; if (p.kind === 'feather') feather++; else if (p.kind === 'flame') flame++; else spark++; } else dead++; }
    return {
      tier: G.tier, tierS: +G.tierS.toFixed(2), combo: G.combo,
      lowSpec: G.lowSpec, reduced: G.reduced, cls: document.body.className,
      live, feather, spark, flame, freeSlots: dead,
      rings: G.rings.length, flashes: G.flashes.length
    };
  });

  // 手动把连击推上去并保持（作弊模式仍在自动命中，谱面高压照样存在）
  await page.evaluate(() => {
    const G = window.__game.G;
    window.__pin = setInterval(() => { if (G.combo < 320) { G.combo = 320; G.maxCombo = 320; } }, 50);
  });
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(1000);
    const st = await sample();
    console.log('t+' + (i + 1) + 's combo ' + st.combo + ' tier' + st.tier + ' tierS ' + st.tierS +
      ' live ' + st.live + '(羽' + st.feather + ' 星' + st.spark + ' 火' + st.flame + ')' +
      ' 空位 ' + st.freeSlots + ' rings ' + st.rings +
      ' lowSpec ' + st.lowSpec + (st.reduced ? ' REDUCED' : '') + ' | ' + st.cls);
  }
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
