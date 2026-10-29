/* 竖屏长卷 / 预览放大 / 手工编辑音符 回归
 * 用法：NODE_PATH=<playwright> node tools/test-roll.js
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LAB = 'file://' + path.join(ROOT, 'chart-lab.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); }
  else { fail++; console.log('  ❌ ' + name + '  — ' + JSON.stringify(extra)); }
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(LAB);
  await p.waitForTimeout(600);

  console.log('=== 竖屏长卷 ===');
  const boot = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const cv = document.querySelector('#roll');
    return {
      view: L.view, visible: cv.clientHeight > 200, w: cv.clientWidth, h: cv.clientHeight,
      lanes: L.P.lanes, vis: g.vis, t0: L.roll.t0,
      thumbH: document.querySelector('#rthumb').clientHeight,
      barH: document.querySelector('#rbar').clientHeight
    };
  });
  ok('默认打开竖屏长卷', boot.view === 'roll', boot.view);
  ok('长卷画布撑满主区', boot.visible && boot.w > 600, { w: boot.w, h: boot.h });
  ok('长卷只显示一个时间窗口而不是全曲', boot.vis > 3 && boot.vis < 40, +boot.vis.toFixed(2));
  ok('竖向滚动条 thumb 比例正确', boot.thumbH > 10 && boot.thumbH < boot.barH,
    { thumb: boot.thumbH, bar: boot.barH });

  /* 滚轮向下 → 时间轴前进 */
  const box = await p.evaluate(() => {
    const r = document.querySelector('#roll').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.mouse.move(box.x, box.y);
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(200);
  const afterWheel = await p.evaluate(() => ({ t0: window.__lab.roll.t0, follow: window.__lab.roll.follow }));
  ok('滚轮向下 → 视野时间前进', afterWheel.t0 > 3, +afterWheel.t0.toFixed(2));
  ok('手动滚动会关掉跟随', afterWheel.follow === false, afterWheel.follow);

  /* 拖动内容 */
  const tBeforeDrag = afterWheel.t0;
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  await p.mouse.move(box.x, box.y - 220, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  const afterDrag = await p.evaluate(() => window.__lab.roll.t0);
  /* 手指向上推 = 内容上移 = 看到更晚的时间（和手机滚列表一致） */
  ok('向上拖动内容 → 视野时间前进', afterDrag > tBeforeDrag + 1, { from: +tBeforeDrag.toFixed(2), to: +afterDrag.toFixed(2) });
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  await p.mouse.move(box.x, box.y + 400, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  ok('向下拖动内容 → 视野时间回退',
    (await p.evaluate(() => window.__lab.roll.t0)) < afterDrag - 1,
    +((await p.evaluate(() => window.__lab.roll.t0))).toFixed(2));

  /* 缩放 */
  const visBefore = await p.evaluate(() => window.__lab.rollGeom().vis);
  await p.evaluate(() => {
    const s = document.querySelector('#s-pps');
    s.value = '150'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const visAfter = await p.evaluate(() => window.__lab.rollGeom().vis);
  ok('放大后视野秒数变少', visAfter < visBefore * 0.6, { before: +visBefore.toFixed(2), after: +visAfter.toFixed(2) });
  await p.evaluate(() => {
    const s = document.querySelector('#s-pps');
    s.value = '72'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* 点击长卷跳转播放头 */
  await p.evaluate(() => { window.__lab.roll.t0 = 40; window.__lab.roll.follow = false; });
  const g40 = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    return { cx: r.left + g.x0 + g.laneW * 0.5, cy: r.top + g.y0 + (g.y1 - g.y0) * 0.4 };
  });
  await p.mouse.click(g40.cx, g40.cy);
  await p.waitForTimeout(200);
  const seeked = await p.evaluate(() => window.__lab.scan.t);
  ok('点长卷空白处 → 播放头跳过去', Math.abs(seeked - 44) < 4, +seeked.toFixed(2));

  console.log('=== 手工编辑音符 ===');
  await p.evaluate(() => { window.__lab.roll.t0 = 80; window.__lab.roll.follow = false; });
  await p.evaluate(() => window.__lab.toggleEdit());
  await p.waitForTimeout(200);

  const cand = await p.evaluate(() => {
    const L = window.__lab;
    const lv = L.cands.reduce((m, c) => { m[c.lvl] = (m[c.lvl] || 0) + 1; return m; }, {});
    return { on: L.editOn, total: L.cands.length, lvls: lv };
  });
  ok('编辑模式打开', cand.on === true, cand.on);
  ok('候选点位已计算', cand.total > 500, cand.total);
  ok('候选分成踩音/空档/太挤三级',
    cand.lvls.onset > 0 && cand.lvls.open > 0 && cand.lvls.tight > 0, cand.lvls);
  ok('踩音点比全部候选少（不是全选）', cand.lvls.onset < cand.total * 0.5,
    { onset: cand.lvls.onset, total: cand.total });

  /* 点一个「踩音」候选 → 加音符 */
  const hit = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    const c = L.cands.find(x => x.lvl === 'onset' && x.t > L.roll.t0 + 1 && x.t < L.roll.t0 + 6);
    return { t: c.t, lane: c.lane, cx: r.left + g.x0 + c.lane * g.laneW + g.laneW / 2, cy: r.top + g.Y(c.t) };
  });
  const n0 = await p.evaluate(() => window.__lab.notes.length);
  await p.mouse.click(hit.cx, hit.cy);
  await p.waitForTimeout(250);
  const n1 = await p.evaluate(() => ({ n: window.__lab.notes.length, adds: window.__lab.adds.length }));
  ok('点候选点 → 加一个音符', n1.n === n0 + 1 && n1.adds === 1, { before: n0, after: n1.n });
  const added = await p.evaluate(() => {
    const L = window.__lab;
    return L.notes.some(n => n.user && Math.abs(n.t - 0) < 999);
  });
  ok('新音符被标记为手工加', added === true, added);
  ok('统计总数同步 +1',
    (await p.evaluate(() => document.querySelector('#k-total').textContent)) === String(n0 + 1),
    await p.evaluate(() => document.querySelector('#k-total').textContent));

  /* 再点一次 → 删掉 */
  await p.mouse.click(hit.cx, hit.cy);
  await p.waitForTimeout(250);
  const n2 = await p.evaluate(() => ({ n: window.__lab.notes.length, adds: window.__lab.adds.length }));
  ok('再点同一位置 → 删掉它', n2.n === n0 && n2.adds === 0, { after: n2.n });

  /* 撤销恢复 */
  await p.click('#ed-undo');
  await p.waitForTimeout(250);
  ok('撤销 → 回到上一步', (await p.evaluate(() => window.__lab.notes.length)) === n0 + 1,
    await p.evaluate(() => window.__lab.notes.length));

  /* 删一个真实音符 */
  const real = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    const n = L.notes.find(x => x.t > L.roll.t0 + 2 && x.t < L.roll.t0 + 5 && x.type !== 'hold' && !x.user);
    return { t: n.t, lane: n.lane, cx: r.left + g.x0 + n.lane * g.laneW + g.laneW / 2, cy: r.top + g.Y(n.t) };
  });
  const m0 = await p.evaluate(() => window.__lab.notes.length);
  await p.mouse.click(real.cx, real.cy);
  await p.waitForTimeout(250);
  const m1 = await p.evaluate(() => ({ n: window.__lab.notes.length, dels: window.__lab.dels.length }));
  ok('点已有音符 → 删掉它', m1.n === m0 - 1 && m1.dels === 1, { before: m0, after: m1.n });

  await p.click('#ed-clear');
  await p.waitForTimeout(250);
  const cleared = await p.evaluate(() => ({ n: window.__lab.notes.length, adds: window.__lab.adds.length, dels: window.__lab.dels.length }));
  ok('清空改动 → 回到原始谱面', cleared.adds === 0 && cleared.dels === 0, cleared);

  /* 换难度后编辑不残留 */
  await p.click('[data-diff="easy"]');
  await p.waitForTimeout(250);
  const easy = await p.evaluate(() => ({ lanes: window.__lab.P.lanes, n: window.__lab.notes.length,
    bad: window.__lab.notes.filter(x => x.lane >= window.__lab.P.lanes).length }));
  ok('切难度后没有越界轨道音符', easy.bad === 0, easy);
  await p.click('[data-diff="nightmare"]');
  await p.waitForTimeout(250);

  console.log('=== 预览放大 / 全屏 ===');
  const pv0 = await p.evaluate(() => document.querySelector('#pv').clientHeight);
  await p.click('#pv-zoom');
  await p.waitForTimeout(400);
  const pv1 = await p.evaluate(() => ({
    h: document.querySelector('#pv').clientHeight,
    zoom: document.querySelector('#pv-card').classList.contains('zoom'),
    mask: getComputedStyle(document.querySelector('#zoom-mask')).display
  }));
  ok('放大后预览画布明显变大', pv1.h > pv0 * 2, { before: pv0, after: pv1.h });
  ok('放大时遮罩出现', pv1.zoom === true && pv1.mask === 'block', pv1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('Esc 退出放大', (await p.evaluate(() => document.querySelector('#pv-card').classList.contains('zoom'))) === false);
  ok('退出后画布恢复原尺寸',
    Math.abs((await p.evaluate(() => document.querySelector('#pv').clientHeight)) - pv0) < 4,
    { before: pv0, after: await p.evaluate(() => document.querySelector('#pv').clientHeight) });

  console.log('=== 视图切换 ===');
  await p.click('[data-view="wide"]');
  await p.waitForTimeout(300);
  const wide = await p.evaluate(() => ({
    view: window.__lab.view,
    mapH: document.querySelector('#map').clientHeight,
    pbarVisible: document.querySelector('#pbar').getBoundingClientRect().height > 2
  }));
  ok('切到横向总谱后 #map 有尺寸', wide.view === 'wide' && wide.mapH > 150, wide);
  ok('横向总谱的进度条可见', wide.pbarVisible === true, wide.pbarVisible);
  await p.click('[data-view="roll"]');
  await p.waitForTimeout(300);
  ok('切回长卷', (await p.evaluate(() => window.__lab.view)) === 'roll');

  ok('全程无页面异常', errs.length === 0, errs.slice(0, 3));

  await p.screenshot({ path: path.join(__dirname, 'shots', 'lab-roll.png') });
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
