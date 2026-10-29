/* 连击氛围粒子回归测试：规则星屑已移除、底部上升粒子、判定线火焰、随档位递增、不规则性 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); }
}

async function measure(page) {
  return page.evaluate(() => {
    const G = window.__game.G;
    const flame = [], rise = [];
    for (const p of G.parts) {
      if (!p.live) continue;
      if (p.kind === 'flame') flame.push(p);
      else if (p.kind === 'spark' && p.vy < 0) rise.push(p);
    }
    const uniq = a => new Set(a.map(v => Math.round(v * 100))).size;
    const ys = flame.map(p => p.y - G.judgeY).sort((a, b) => a - b);
    const xs = rise.map(p => p.x);
    const med = ys.length ? ys[(ys.length / 2) | 0] : 0;
    return {
      tier: G.tier, judgeY: G.judgeY,
      flame: flame.length, rise: rise.length,
      flameYmed: Math.round(med),
      lowRatio: rise.length ? +(rise.filter(p => p.y > 600).length / rise.length).toFixed(2) : 0,
      vyKinds: uniq(rise.map(p => p.vy)), sizeKinds: uniq(rise.map(p => p.size)),
      /* 只看底部区域的粒子：命中爆发的 spark 也在 vy<0 里，但它们不该有摆动 */
      wobRatio: rise.length ? +(rise.filter(p => p.y > 600 && p.wob > 0).length /
        Math.max(1, rise.filter(p => p.y > 600).length)).toFixed(2) : 0,
      xSpan: rise.length ? Math.round(Math.max(...xs) - Math.min(...xs)) : 0
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  console.log('=== 1. 规则网格星屑已移除 ===');
  const star = await page.evaluate(() => ({
    el: document.querySelectorAll('.cf-spark').length,
    css: (document.querySelector('style').textContent.match(/cfTwinkle|cf-spark/g) || []).length
  }));
  ok('DOM 中没有 .cf-spark 层', star.el === 0, star.el);
  ok('样式表里没有 cf-spark / cfTwinkle', star.css === 0, star.css);

  console.log('\n=== 2. 粒子随连击递增 ===');
  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
  await page.waitForTimeout(1800);

  const data = {};
  for (const lvl of [25, 60, 160, 360]) {
    await page.evaluate(c => {
      if (window.__pin) clearInterval(window.__pin);
      const G = window.__game.G;
      G.combo = c; G.maxCombo = c;
      window.__pin = setInterval(() => { G.combo = c; G.maxCombo = c; }, 40);
    }, lvl);
    await page.waitForTimeout(1700);
    data[lvl] = await measure(page);
    console.log('    combo ' + lvl + ' → tier ' + data[lvl].tier +
      ' 火焰 ' + data[lvl].flame + ' 上升 ' + data[lvl].rise);
  }
  ok('>20 就有向上粒子', data[25].rise > 10, data[25].rise);
  ok('数量随档位递增（25 < 60 < 160 < 360）',
    data[25].rise < data[60].rise && data[60].rise < data[160].rise && data[160].rise < data[360].rise,
    [data[25].rise, data[60].rise, data[160].rise, data[360].rise]);
  ok('火焰数量随档位递增',
    data[25].flame < data[160].flame && data[160].flame < data[360].flame,
    [data[25].flame, data[160].flame, data[360].flame]);

  console.log('\n=== 3. 形态与不规则性 ===');
  const d = data[360];
  ok('火焰紧贴判定线喷出（中位偏移 < 180px）', Math.abs(d.flameYmed) < 180, d.flameYmed);
  ok('上升粒子集中在屏幕下方（y>600 占比 > 25%）', d.lowRatio > 0.25, d.lowRatio);
  ok('上升速度不统一（≥6 种）', d.vyKinds >= 6, d.vyKinds);
  ok('粒子大小不统一（≥5 种）', d.sizeKinds >= 5, d.sizeKinds);
  ok('底部上升粒子都带横向摆动', d.wobRatio >= 0.9, d.wobRatio);
  ok('横向分布跨度 > 600px（不扎堆）', d.xSpan > 600, d.xSpan);

  console.log('\n=== 4. 减弱动效 ===');
  await page.evaluate(() => { window.__game.G.reduced = true; });
  await page.waitForTimeout(400);
  const before = await measure(page);
  await page.waitForTimeout(1500);
  const after = await measure(page);
  ok('减弱动效下不再新增粒子', after.rise <= before.rise + 2, [before.rise, after.rise]);
  await page.evaluate(() => { window.__game.G.reduced = false; });

  console.log('\n=== 5. 运行期 ===');
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    function tick() { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); }
    requestAnimationFrame(tick);
  }));
  ok('满特效帧率 ≥ 50fps', fps >= 50, fps + 'fps');
  ok('无 JS 运行错误', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
