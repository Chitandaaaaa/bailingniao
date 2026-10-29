/* 保真校验：chart-lab.html 生成的总谱必须与游戏内 loadChart() 完全一致
   （同一批弹奏点、同一套生成器 → 每个难度的音符数/时间戳应逐点相同） */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = 'file://' + path.join(ROOT, 'index.html');
const LAB = 'file://' + path.join(ROOT, 'chart-lab.html');

let pass = 0, fail = 0;
function ok(n, c, x) {
  if (c) { pass++; console.log('  ✅ ' + n + (x !== undefined ? '  — ' + JSON.stringify(x) : '')); }
  else { fail++; console.log('  ❌ ' + n + (x !== undefined ? '  — ' + JSON.stringify(x) : '')); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });

  /* ---- 游戏侧 ---- */
  const gp = await browser.newPage();
  await gp.goto(GAME);
  await gp.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 120000 });
  const real = {};
  for (const song of ['summer', 'kaze']) {
    await gp.evaluate(id => window.__game.setSong(id), song);
    await gp.waitForFunction(() => window.__game.Sound.events && window.__game.Sound.events.length > 60, { timeout: 120000 });
    real[song] = {};
    for (const d of ['easy', 'hard', 'nightmare']) {
      const r = await gp.evaluate(dd => {
        window.__game.loadChart(dd);
        return window.__game.G.notes.map(n => Math.round(n.t * 1000) / 1000);
      }, d);
      real[song][d] = r;
    }
    await gp.evaluate(() => window.__game.toTitle());
  }
  console.log('游戏侧音符数:', Object.keys(real).map(s => s + '=' + ['easy', 'hard', 'nightmare'].map(d => real[s][d].length).join('/')).join('  '));

  /* ---- 实验页侧 ---- */
  const lp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  lp.on('pageerror', e => errs.push(e.message));
  lp.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await lp.goto(LAB);
  await lp.waitForTimeout(500);

  for (const song of ['summer', 'kaze']) {
    await lp.click('[data-song="' + song + '"]');
    for (const d of ['easy', 'hard', 'nightmare']) {
      await lp.click('[data-diff="' + d + '"]');
      const lab = await lp.evaluate(() => {
        const w = window.__lab;
        return w.notes.map(n => Math.round(n.t * 1000) / 1000);
      });
      const r = real[song][d];
      const same = lab.length === r.length && lab.every((t, i) => Math.abs(t - r[i]) < 1e-6);
      ok(song + ' / ' + d + ' 逐点一致（' + r.length + ' 音）', same,
        same ? undefined : { lab: lab.length, real: r.length, firstDiff: lab.findIndex((t, i) => Math.abs(t - r[i]) > 1e-6) });
    }
  }

  console.log('=== 交互 ===');
  await lp.click('[data-diff="nightmare"]');
  const stats = await lp.evaluate(() => ({
    total: document.querySelector('#k-total').textContent,
    nps: document.querySelector('#k-avg').textContent,
    peak: document.querySelector('#k-peak').textContent,
    bars: document.querySelectorAll('#lanebars .bar').length,
    keys: document.querySelector('#keyrow').textContent,
    vis: document.querySelector('#k-vis').textContent
  }));
  ok('统计面板已填充', stats.total !== '—' && stats.nps !== '—', stats);
  ok('8 轨条形图 8 条', stats.bars === 8, stats.bars);
  ok('键位显示 8 个字母', stats.keys === 'ASDFJKL;', stats.keys);

  /* 切到横向总谱视图（#map 只在那个视图里可见） */
  await lp.click('[data-view="wide"]');
  await lp.waitForTimeout(250);

  /* 扫描：空格开始，播放头前进 */
  await lp.click('#map', { position: { x: 400, y: 200 } });
  const t0 = await lp.evaluate(() => window.__lab.scan.t);
  await lp.keyboard.press('Space');
  await lp.waitForTimeout(900);
  const t1 = await lp.evaluate(() => window.__lab.scan.t);
  ok('空格开始扫描，播放头前进', t1 > t0 + 0.5, { t0: +t0.toFixed(2), t1: +t1.toFixed(2) });
  await lp.keyboard.press('Space');
  const t2 = await lp.evaluate(() => window.__lab.scan.t);
  await lp.waitForTimeout(400);
  const t3 = await lp.evaluate(() => window.__lab.scan.t);
  ok('再按空格暂停', Math.abs(t3 - t2) < 0.05, { t2: +t2.toFixed(2), t3: +t3.toFixed(2) });

  /* 参数改动实时重建 */
  const before = await lp.evaluate(() => window.__lab.notes.length);
  await lp.evaluate(() => {
    const s = document.querySelector('#s-step');
    s.value = '1'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await lp.evaluate(() => window.__lab.notes.length);
  ok('把最大跳槽调到 1 后音符变多', after > before * 1.1, { before, after });
  await lp.evaluate(() => {
    const s = document.querySelector('#s-step');
    s.value = '4'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* 进度条：点击跳转 + 填充比例 */
  const bw = await lp.evaluate(() => document.querySelector('#pbar').getBoundingClientRect());
  await lp.mouse.click(bw.x + bw.width * 0.5, bw.y + bw.height / 2);
  await lp.waitForTimeout(150);
  const pb = await lp.evaluate(() => {
    const L = window.__lab;
    return { prog: L.scan.t / L.TL.chartEnd, fill: parseFloat(document.querySelector('#pfill').style.width) };
  });
  ok('点击进度条中点 → 跳到 50%', Math.abs(pb.prog - 0.5) < 0.02, pb.prog.toFixed(3));
  ok('进度条填充同步', Math.abs(pb.fill - pb.prog * 100) < 0.5, pb.fill);

  ok('无页面异常', errs.length === 0, errs);

  await lp.click('[data-view="wide"]');
  await lp.click('[data-diff="nightmare"]');
  await lp.waitForTimeout(300);
  await lp.screenshot({ path: path.join(__dirname, 'shots', 'lab-nightmare.png') });
  await lp.click('[data-diff="easy"]');
  await lp.waitForTimeout(300);
  await lp.screenshot({ path: path.join(__dirname, 'shots', 'lab-easy.png') });

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
