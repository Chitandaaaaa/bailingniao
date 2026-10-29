/* 结算界面：夸奖文案 / 超越百分比 / 复制战报 回归测试 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');
let pass = 0, fail = 0;
const ok = (n, c, d) => { console.log((c ? '  ✅ ' : '  ❌ ') + n + (d ? '  — ' + d : '')); c ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.removeItem('bailingniao.best'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });

  const runCase = async (c) => {
    await page.evaluate(() => {
      const g = window.__game;
      if (g.G.state === 'RESULT') g.toTitle();
    });
    await page.waitForTimeout(160);
    await page.evaluate(() => {
      if (window.__game.G.state !== 'PLAYING') { window.__game.toTitle(); }
    });
    await page.waitForTimeout(120);
    if (c.cheat) await page.keyboard.press('F2');
    await page.keyboard.press('Space');
    await page.waitForTimeout(2600);
    await page.evaluate(c => {
      const G = window.__game.G;
      G.counts.perfect = c.p; G.counts.good = c.gd; G.counts.miss = c.m;
      G.score = c.score; G.maxCombo = c.combo; G.combo = c.combo;
      window.__game.finishGame();
    }, c);
    await page.waitForTimeout(2200);
    return page.evaluate(() => {
      const q = s => document.querySelector(s);
      return {
        grade: q('#r-letter').textContent,
        rank: q('#r-rank-num').textContent,
        note: q('#r-note').textContent,
        cheer: q('#r-cheer').textContent,
        report: window.__game.G.reportText,
        overflow: (() => { const e = q('#result-inner'); return e.scrollHeight - e.clientHeight; })(),
        btn: q('#btn-copy') ? q('#btn-copy').textContent : null
      };
    });
  };

  console.log('\n=== 1. S 级完美局 ===');
  const a = await runCase({ p: 356, gd: 0, m: 0, score: 128450, combo: 356 });
  ok('评级为 S', a.grade === 'S', a.grade);
  const pct = parseFloat(a.rank);
  ok('超越百分比在 99.000~99.999', pct >= 99 && pct <= 99.999, a.rank);
  ok('百分比保留三位小数', /^\d{2}\.\d{3}%$/.test(a.rank), a.rank);
  ok('有夸奖文案', a.note.length > 10, a.note.slice(0, 30) + '…');
  ok('零 MISS 有专属夸奖', /零 MISS/.test(a.note), a.note.slice(-16));
  ok('有求赞文案', /赞/.test(a.cheer), a.cheer);
  ok('面板无溢出', a.overflow === 0, String(a.overflow));
  ok('复制按钮存在', a.btn === '复制战报', a.btn);
  console.log('   note: ' + a.note);
  console.log('   rank: ' + a.rank);

  console.log('\n=== 2. 复制战报 ===');
  await page.click('#btn-copy');
  await page.waitForTimeout(320);
  const btnTxt = await page.evaluate(() => document.querySelector('#btn-copy').textContent);
  ok('按钮反馈「已复制」', btnTxt === '已复制', btnTxt);
  const clip = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return ''; } });
  ok('剪贴板写入成功', clip.length > 20, String(clip.length) + ' 字');
  ok('战报含歌名', /Summer/.test(clip));
  ok('战报含评级分数', /评级 S/.test(clip) && /128,450/.test(clip));
  ok('战报含超越百分比', /超越 99/.test(clip));
  await page.waitForTimeout(1500);
  const btnBack = await page.evaluate(() => document.querySelector('#btn-copy').textContent);
  ok('1.5s 后按钮复原', btnBack === '复制战报', btnBack);

  console.log('\n=== 3. 确定性（同一成绩两次结算结果一致） ===');
  const a2 = await runCase({ p: 356, gd: 0, m: 0, score: 128450, combo: 356 });
  ok('同一成绩百分比一致', a2.rank === a.rank, a.rank + ' vs ' + a2.rank);

  console.log('\n=== 4. 中低评级 ===');
  const b = await runCase({ p: 240, gd: 60, m: 12, score: 74210, combo: 96 });
  const bpct = parseFloat(b.rank);
  ok('评级 B（不是误判 S）', b.grade === 'B', b.grade);
  ok('B 级百分比在范围内', bpct >= 99 && bpct <= 99.999, b.rank);
  ok('B 级文案不同', b.note !== a.note, b.note.slice(0, 20) + '…');
  const c = await runCase({ p: 60, gd: 90, m: 60, score: 12000, combo: 20 });
  ok('低准度不是 S', c.grade !== 'S', c.grade);
  ok('低准度百分比仍 >= 99', parseFloat(c.rank) >= 99, c.rank);

  console.log('\n=== 5. 作弊局标注 ===');
  const ch = await runCase({ p: 300, gd: 0, m: 0, score: 99000, combo: 300, cheat: true });
  ok('战报标注作弊局', /作弊局/.test(ch.report), ch.report.split('\n')[0]);
  ok('文案提示仅供娱乐', /仅供娱乐|自动演奏/.test(ch.note), ch.note.slice(-20));

  console.log('\n=== 6. 无运行错误 ===');
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
