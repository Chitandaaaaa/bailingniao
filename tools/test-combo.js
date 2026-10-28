/* 连击光环 / PERFECT 爆发 / 额外震屏 的自动化验收 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');
let pass = 0, fail = 0;
const ok = (n, c, d) => { console.log((c ? '  ✅ ' : '  ❌ ') + n + (d ? '  — ' + d : '')); c ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => {
    localStorage.setItem('bailingniao.best', JSON.stringify({
      score: 0, acc: 0, maxChain: 0, plays: 3, seenTutorial: true,
      settings: { colorBlind: false, goodWindow: false, preHighlight: true, reduceMotion: 'off', offsetMs: 0, mode: 'nightmare' }
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(5400);

  console.log('\n=== 1. 档位切换（>20 小 / >40 大）===');
  // 清空未判定音符，避免 MISS 把 combo 清零（专注档位本身）
  await page.evaluate(() => { const G = window.__game.G; G.notes.length = 0; G.cursor = 0; });
  const tierAt = async (n, wait) => {
    await page.evaluate(v => { window.__game.G.combo = v; }, n);
    await page.waitForTimeout(wait);
    return page.evaluate(() => ({ tier: window.__game.G.tier, s: +window.__game.G.tierS.toFixed(2) }));
  };
  let r = await tierAt(6, 600);
  ok('6 连击 → 无光环', r.tier === 0 && r.s < 0.05, JSON.stringify(r));
  r = await tierAt(21, 700);
  ok('21 连击 → 小光环（tier1）', r.tier === 1 && r.s > 0.85, JSON.stringify(r));
  r = await tierAt(41, 800);
  ok('41 连击 → 大光环（tier2）', r.tier === 2 && r.s > 1.85, JSON.stringify(r));
  r = await tierAt(20, 700);
  ok('回落到 20 连击 → 光环淡出', r.tier === 0 && r.s < 0.15, JSON.stringify(r));

  console.log('\n=== 2. 连击续击的额外震屏（>40 才触发）===');
  // 清空未判定音符，避免 MISS 干扰 combo
  await page.evaluate(() => { const G = window.__game.G; G.notes.length = 0; G.cursor = 0; });
  const hitFake = async (combo) => page.evaluate(v => {
    const g = window.__game, G = g.G;
    G.combo = v; G.shakeAdd = { t0: 0, amp: 0, dur: 0, freq: 34 };
    // 造一个与当前时间对齐的音符再判定
    const t = g.Sound.chartTime();
    G.notes.push({ t: t, lane: 2, type: 'std', judged: false, holdBeats: 0, bpmSlot: 0 });
    g.hitLane(2, t);
    return { combo: G.combo, amp: G.shakeAdd.amp, dur: G.shakeAdd.dur };
  }, combo);

  let h = await hitFake(39);
  ok('40 连击（含当次）不额外震屏', h.combo === 40 && h.amp === 0, JSON.stringify(h));
  h = await hitFake(40);
  ok('41 连击起额外震屏', h.combo === 41 && h.amp > 0, JSON.stringify(h));
  h = await hitFake(60);
  ok('60 连击仍震屏', h.amp > 0, JSON.stringify(h));

  // 震屏叠加：shakeAdd 与 milestone shake 同时存在时位移不超过 15px
  const tf = await page.evaluate(() => {
    const g = window.__game, G = g.G;
    G.shake = { t0: performance.now(), amp: 12, dur: 1200 };
    G.shakeAdd = { t0: performance.now(), amp: 3.5, dur: 160, freq: 34 };
    return new Promise(res => {
      let mx = 0, my = 0, k = 0;
      const st = document.getElementById('stage');
      (function loop() {
        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(st.style.transform || '');
        if (m) { mx = Math.max(mx, Math.abs(+m[1])); my = Math.max(my, Math.abs(+m[2])); }
        if (++k < 22) requestAnimationFrame(loop);
        else res({ x: +mx.toFixed(2), y: +my.toFixed(2) });
      })();
    });
  });
  ok('双通道震屏不超过 ±15px 且确实在抖', Math.abs(tf.x) <= 15 && Math.abs(tf.y) <= 15 && tf.x > 2, JSON.stringify(tf));

  console.log('\n=== 3. PERFECT 爆发 ===');
  const pf = await page.evaluate(() => {
    const g = window.__game, G = g.G;
    G.combo = 50;
    const r0 = G.rings.length, l0 = G.laneFx[1].length;
    g.spawnHitFx(1, 'perfect', 120, { lane: 1 });
    return {
      rings: G.rings.length - r0, fx: G.laneFx[1].length - l0,
      glow: +G.judgeGlow.toFixed(2), n: G.rings[G.rings.length - 1]
    };
  });
  ok('PERFECT 追加扩散环', pf.rings === 1, JSON.stringify({ rings: pf.rings }));
  ok('PERFECT 追加命中特效项', pf.fx === 1, JSON.stringify({ fx: pf.fx }));
  ok('PERFECT 点亮判定线辉光', pf.glow > 0.9, 'glow=' + pf.glow);
  ok('光环扩散半径受控（不留残影）', pf.n && pf.n.rMax <= 120 && pf.n.dur <= 500, JSON.stringify(pf.n));

  console.log('\n=== 4. 降低动态效果时关闭震屏 ===');
  const rm = await page.evaluate(() => {
    const g = window.__game, G = g.G;
    G.reduced = true;
    G.shakeAdd = { t0: 0, amp: 0, dur: 0, freq: 34 };
    G.shake = { t0: 0, amp: 0, dur: 0 };
    G.combo = 60;
    const t = g.Sound.chartTime();
    G.notes.push({ t: t, lane: 2, type: 'std', judged: false, holdBeats: 0, bpmSlot: 0 });
    g.hitLane(2, t);
    const amp = G.shakeAdd.amp;
    G.reduced = false;
    return { amp: amp, combo: G.combo };
  });
  ok('降低动态效果 → 不震屏', rm.amp === 0, JSON.stringify(rm));

  console.log('\n=== 5. 高连击帧率 ===');
  await page.evaluate(() => { window.__game.G.combo = 60; });
  await page.waitForTimeout(300);
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function loop() { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(loop); else res(Math.round(n / ((performance.now() - t0) / 1000))); })();
  }));
  ok('大光环下帧率 ≥ 50', fps >= 50, 'fps=' + fps);

  console.log('\n=== 6. 运行期异常 ===');
  ok('无异常', errs.length === 0, errs.slice(0, 4).join(' | '));

  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
