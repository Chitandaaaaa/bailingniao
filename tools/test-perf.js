/* 性能分级测试：hue-rotate 动画已移除、perf1 只关部分层、perf2 才关光网、能自动恢复 */
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

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  console.log('=== 1. 昂贵的全屏 filter 动画已移除 ===');
  const css = await page.evaluate(() => document.querySelector('style').textContent);
  ok('样式里不再有 hue-rotate 关键帧', !/keyframes cfHue/.test(css));
  ok('cfPrism 关键帧不带 filter', !/cfPrism\{[^}]*hue-rotate/.test(css));
  ok('plasma 动画不再叠加 cfHue', !/animation:cfSpin 9s linear infinite,cfHue/.test(css));

  console.log('\n=== 2. 分级降级 ===');
  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const layerState = () => page.evaluate(() => {
    const d = s => getComputedStyle(document.querySelector(s)).display;
    return {
      perf: window.__game.G.perf, lowSpec: window.__game.G.lowSpec, cls: document.body.className,
      rays: d('.cf-rays'), waves: d('.cf-waves'), rain: d('.cf-rain'), plasma: d('.cf-plasma'),
      prism: d('.cf-prism'), core: d('.cf-core'), sweep: d('.cf-sweep')
    };
  });
  let st = await layerState();
  ok('初始 perf=0', st.perf === 0, st.perf);
  ok('初始所有层可见', st.rays === 'block' && st.waves === 'block' && st.prism === 'block', st.cls);

  await page.evaluate(() => { const G = window.__game.G; G.perf = 1; window.__game.applyPerfLevel(); });
  st = await layerState();
  ok('perf1 关掉 waves/rain/plasma/prism', st.waves === 'none' && st.rain === 'none' && st.plasma === 'none' && st.prism === 'none', st.cls);
  ok('perf1 保留 rays 与 sweep（不再一刀切）', st.rays === 'block' && st.sweep === 'block', [st.rays, st.sweep]);
  ok('perf1 时 lowSpec 兼容标记为 true', st.lowSpec === true, st.lowSpec);

  await page.evaluate(() => { const G = window.__game.G; G.perf = 2; window.__game.applyPerfLevel(); });
  st = await layerState();
  ok('perf2 再关掉 rays/sweep', st.rays === 'none' && st.sweep === 'none', [st.rays, st.sweep]);
  ok('perf2 时 core 仍然保留', st.core === 'block', st.core);

  console.log('\n=== 3. 能自动恢复 ===');
  const before = await page.evaluate(() => window.__game.G.perf);
  await page.waitForTimeout(4200);
  const after = await page.evaluate(() => window.__game.G.perf);
  ok('帧率正常时自动降一级', after < before, [before, after]);
  st = await layerState();
  ok('恢复后 rays 重新出现', st.perf >= 1 ? st.rays === 'block' : st.rays === 'block', st.cls);

  console.log('\n=== 4. 运行期 ===');
  await page.evaluate(() => { const G = window.__game.G; G.perf = 0; window.__game.applyPerfLevel(); });
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
