/* >300 连击（tier5）专项：数字必须有「跃动」，不能只剩持续摇摆；火舌要够旺 */
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.click('.diff-card[data-diff="nightmare"]');
  await page.keyboard.press('F2');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.G.state === 'PLAYING', { timeout: 20000 });
  await page.waitForTimeout(1000);

  console.log('=== 1. 动画不冲突 ===');
  const css = await page.evaluate(() => document.querySelector('style').textContent);
  ok('tier5 的 #combo-val 不再挂 comboPrismGlow', !/#hud-combo\.tier5 #combo-val\{[^}]*comboPrismGlow/.test(css));

  await page.evaluate(() => {
    const G = window.__game.G;
    window.__pin = setInterval(() => { G.combo = 350; G.maxCombo = 350; }, 30);
  });
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => {
    window.__game.bumpCombo();
    const val = document.querySelector('#combo-val');
    const shell = document.querySelector('#combo-shell');
    return {
      tier: window.__game.G.tier, hudCls: document.querySelector('#hud-combo').className,
      valAnim: getComputedStyle(val).animationName,
      swayAnim: getComputedStyle(shell).animationName,
      swayDur: parseFloat(getComputedStyle(shell).animationDuration)
    };
  });
  ok('已进入 tier5', st.tier === 5 && /tier5/.test(st.hudCls), st.hudCls);
  ok('每击仍是 kick5（不再被色相动画顶掉）', st.valAnim === 'comboKick5', st.valAnim);
  ok('持续摇摆降速到 ≥0.6s（原来 .42s 太快像发抖）', st.swayDur >= 0.6, st.swayDur + 's');

  console.log('\n=== 2. 跃动幅度 ===');
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.__game.bumpCombo());
    await page.waitForTimeout(55);
    samples.push(await page.evaluate(() => {
      const m = getComputedStyle(document.querySelector('#combo-val')).transform;
      const p = m.match(/matrix\(([-\d.]+)/);
      return p ? +(+p[1]).toFixed(2) : 1;
    }));
  }
  const peak = Math.max(...samples);
  ok('kick5 峰值缩放 > 1.7（肉眼是「弹跳」不是「抖」）', peak > 1.7, { samples, peak });

  console.log('\n=== 3. 火舌更旺 ===');
  await page.waitForTimeout(1500);
  const fire = await page.evaluate(() => {
    const G = window.__game.G;
    const live = G.parts.filter(p => p.live);
    const flame = live.filter(p => p.kind === 'flame');
    const spark = live.filter(p => p.kind === 'spark');
    return {
      flame: flame.length, spark: spark.length,
      wob: flame.length ? Math.round(flame.reduce((s, p) => s + p.wob, 0) / flame.length) : 0
    };
  });
  ok('tier5 火焰粒子 ≥ 45（改前 ~38）', fire.flame >= 45, fire.flame);
  ok('火苗平均摆动幅度 ≥ 180（改前 ~160）', fire.wob >= 180, fire.wob);
  ok('上升粒子仍正常', fire.spark > 60, fire.spark);

  console.log('\n=== 4. 性能 ===');
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
