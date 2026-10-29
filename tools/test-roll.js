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
  await p.click('[data-diff="nightmare"]');   /* 8 轨才好测轨道相关的东西 */
  await p.waitForTimeout(300);

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
    /* 每个候选点都必须真的踩在原曲起音上（±25ms），且同轨不挤 */
    let bad = 0, minSame = 9;
    for (const c of L.cands) {
      let best = 9;
      for (const cell of L.curCells) { const d = Math.abs(cell.t - c.t); if (d < best) best = d; }
      if (best > 0.026) bad++;
      let gap = 9;
      for (const n of L.notes) { if (n.lane !== c.lane) continue; const d = Math.abs(n.t - c.t); if (d < gap) gap = d; }
      if (gap < minSame) minSame = gap;
    }
    return { on: L.editOn, total: L.cands.length, bad, minSame: +minSame.toFixed(3) };
  });
  ok('编辑模式打开', cand.on === true, cand.on);
  ok('候选点位已计算', cand.total > 50, cand.total);
  ok('每个候选点都踩在原曲起音上（±25ms）', cand.bad === 0, { total: cand.total, bad: cand.bad });
  ok('候选点与同轨音符保持最小间隔', cand.minSame >= 0.195, cand.minSame);

  /* 点一个候选点 → 加音符 */
  const hit = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    const c = L.cands.find(x => x.t > L.roll.t0 + 1 && x.t < L.roll.t0 + 6);
    return { t: c.t, lane: c.lane, cx: r.left + g.x0 + c.lane * g.laneW + g.laneW / 2, cy: r.top + g.Y(c.t) };
  });
  const n0 = await p.evaluate(() => window.__lab.notes.length);
  await p.mouse.click(hit.cx, hit.cy);
  await p.waitForTimeout(250);
  const n1 = await p.evaluate(() => ({ n: window.__lab.notes.length, adds: window.__lab.adds.length }));
  ok('点候选点 → 加一个音符', n1.n === n0 + 1 && n1.adds === 1, { before: n0, after: n1.n });
  ok('新音符被标记为手工加', (await p.evaluate(() => window.__lab.notes.some(n => n.user))) === true);
  ok('统计总数同步 +1',
    (await p.evaluate(() => document.querySelector('#k-total').textContent)) === String(n0 + 1),
    await p.evaluate(() => document.querySelector('#k-total').textContent));

  /* 再点一次 → 删掉 */
  await p.mouse.click(hit.cx, hit.cy);
  await p.waitForTimeout(250);
  const n2 = await p.evaluate(() => ({ n: window.__lab.notes.length, adds: window.__lab.adds.length }));
  ok('再点同一位置 → 删掉它', n2.n === n0 && n2.adds === 0, { after: n2.n });

  console.log('=== 空按拒绝 ===');
  const empty = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    const lane = 6;
    let t = L.roll.t0 + 3, found = null;
    for (let k = 0; k < 900; k++) {
      const nearCand = L.cands.some(c => Math.abs(c.t - t) < 0.5);
      const nearNote = L.notes.some(n => n.lane === lane && Math.abs(n.t - t) < 0.35);
      if (!nearCand && !nearNote) { found = t; break; }
      t += 0.05;
      if (t > L.TL.chartEnd - 2) break;
    }
    if (found === null) return null;
    /* 保证这一屏能看到这个时刻 */
    L.roll.t0 = Math.max(0, found - 4);
    return { t: +found.toFixed(2), cx: r.left + g.x0 + g.laneW * (lane + 0.5), cy: r.top + g.Y(found) };
  });
  ok('找得到一个「原曲没声音」的空格', empty !== null, empty);
  await p.waitForTimeout(120);
  const emptyPt = await p.evaluate((t) => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    return { cx: r.left + g.x0 + g.laneW * 6.5, cy: r.top + g.Y(t) };
  }, empty.t);
  await p.mouse.click(emptyPt.cx, emptyPt.cy);
  await p.waitForTimeout(250);
  const rej = await p.evaluate(() => ({
    adds: window.__lab.adds.length,
    say: (document.querySelector('#say') || {}).textContent || ''
  }));
  ok('点原曲没声音的地方 → 拒绝加音符', rej.adds === 0 && /没有声音/.test(rej.say), rej);

  console.log('=== 长条 ===');
  await p.evaluate(() => window.__lab.setTool('hold'));
  await p.evaluate(() => {
    const L = window.__lab;
    L.roll.follow = false;
    L.roll.t0 = Math.max(0, L.cands[Math.min(20, L.cands.length - 1)].t - 3);
  });
  await p.waitForTimeout(150);
  const hAt = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    const c = L.cands.find(x => x.t > L.roll.t0 + 0.8 && x.t < L.roll.t0 + g.vis - 2);
    return { t: c.t, lane: c.lane, cx: r.left + g.x0 + c.lane * g.laneW + g.laneW / 2, cy: r.top + g.Y(c.t) };
  });
  await p.mouse.move(hAt.cx, hAt.cy);
  await p.mouse.down();
  await p.mouse.move(hAt.cx, hAt.cy + 66, { steps: 5 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const hAdd = await p.evaluate(() => {
    const L = window.__lab;
    return { adds: L.adds.length, type: L.adds[0] && L.adds[0].type, hb: L.adds[0] && L.adds[0].hb,
      note: L.notes.filter(n => n.user && n.type === 'hold').length };
  });
  ok('长条模式拖拽 → 加一个长按', hAdd.adds === 1 && hAdd.type === 'hold' && hAdd.hb > 0, hAdd);
  ok('长按真的进谱面（type=hold）', hAdd.note === 1, hAdd.note);

  /* 点长条中段 → 整条删掉 */
  const hMid = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    const r = document.querySelector('#roll').getBoundingClientRect();
    const n = L.notes.find(x => x.user && x.type === 'hold');
    const tm = n.t + n.holdBeats * L.TL.beat * 0.6;
    return { cx: r.left + g.x0 + n.lane * g.laneW + g.laneW / 2, cy: r.top + g.Y(tm) };
  });
  await p.mouse.click(hMid.cx, hMid.cy);
  await p.waitForTimeout(300);
  ok('点长条中段 → 整条删除', (await p.evaluate(() => window.__lab.adds.length)) === 0);
  await p.evaluate(() => window.__lab.setTool('tap'));

  /* 撤销恢复：刚才删了长条，撤销后长条应该回来 */
  await p.click('#ed-undo');
  await p.waitForTimeout(250);
  ok('撤销 → 回到上一步', (await p.evaluate(() => window.__lab.adds.length)) === 1,
    await p.evaluate(() => window.__lab.adds.length));
  await p.click('#ed-clear');
  await p.waitForTimeout(200);

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

  console.log('=== 播放跟随 / 音乐 ===');
  await p.evaluate(() => { window.__lab.scan.t = 60; window.__lab.roll.follow = false; });
  await p.keyboard.press('Space');
  await p.waitForTimeout(900);
  const pl = await p.evaluate(() => {
    const L = window.__lab, g = L.rollGeom();
    return { playing: L.scan.playing, follow: L.roll.follow, rel: (L.scan.t - L.roll.t0) / g.vis,
      bus: !!L.musBus, srcs: L.musSrcs };
  });
  ok('播放时自动回到跟随', pl.playing && pl.follow === true, pl);
  ok('播放头稳在视野正中（±6%）', Math.abs(pl.rel - 0.5) < 0.06, +pl.rel.toFixed(3));
  ok('音乐总线已建立', pl.bus === true, pl.bus);
  ok('音乐真的在排音（音源数 > 0）', pl.srcs > 0, pl.srcs);
  await p.waitForTimeout(500);
  const pl2 = await p.evaluate(() => ({ t: window.__lab.scan.t, t0: window.__lab.roll.t0 }));
  ok('画面跟着播放头一起走', pl2.t0 > 0, { t0: +pl2.t0.toFixed(2) });
  await p.keyboard.press('Space');
  await p.waitForTimeout(200);
  ok('空格可暂停', (await p.evaluate(() => window.__lab.scan.playing)) === false);

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
