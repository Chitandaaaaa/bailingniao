/* 密度节奏分析：按 8 段 / 16 段统计谱面密度，验证“稀疏-稠密交替” */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

  for (const mode of ['easy', 'hard', 'nightmare']) {
    await page.goto(FILE);
    await page.evaluate(m => {
      localStorage.setItem('bailingniao.best', JSON.stringify({
        score: 0, acc: 0, maxChain: 0, plays: 3, seenTutorial: true,
        settings: { colorBlind: false, goodWindow: false, preHighlight: true, reduceMotion: 'on', offsetMs: 0, mode: m }
      }));
    }, mode);
    await page.reload();
    await page.waitForFunction(() => window.__game && window.__game.Sound.ready, { timeout: 60000 });
    await page.keyboard.press('Space');
    await page.waitForTimeout(3200);

    const r = await page.evaluate(() => {
      const G = window.__game.G;
      const END = 214.8;
      const ns = G.notes.slice().sort((a, b) => a.t - b.t);
      const seg = 8, out = [];
      for (let i = 0; i < seg; i++) {
        const a = END * i / seg, b = END * (i + 1) / seg;
        const k = ns.filter(n => n.t >= a && n.t < b).length;
        out.push(+(k / (b - a)).toFixed(2));
      }
      // 相邻 1.6s 窗的密度方差，衡量“起伏感”
      const win = [];
      for (let t = 0; t < END - 1.6; t += 1.6) {
        win.push(ns.filter(n => n.t >= t && n.t < t + 1.6).length / 1.6);
      }
      const mean = win.reduce((s, v) => s + v, 0) / win.length;
      const sd = Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / win.length);
      const gaps = [];
      for (let i = 1; i < ns.length; i++) gaps.push((ns[i].t - ns[i - 1].t) * 1000);
      gaps.sort((a, b) => a - b);
      const acts = (G.chart.notes || []).filter(c => typeof c.a === 'number').map(c => c.a);
      return {
        n: ns.length, seg: out, mean: +mean.toFixed(2), sd: +sd.toFixed(2),
        cv: +(sd / mean).toFixed(2),
        gapPe: [Math.round(gaps[Math.floor(gaps.length * 0.1)]), Math.round(gaps[gaps.length >> 1]), Math.round(gaps[Math.floor(gaps.length * 0.9)])],
        actN: acts.length, actLo: +(acts.filter(a => a < 0.2).length / acts.length * 100).toFixed(0),
        actHi: +(acts.filter(a => a > 0.8).length / acts.length * 100).toFixed(0)
      };
    });

    const bar = r.seg.map(v => {
      const h = Math.round(v / 4.6 * 18);
      return v.toFixed(2).padStart(5) + ' ' + '█'.repeat(Math.max(1, h));
    });
    console.log('\n[' + mode + '] 音数=' + r.n + '  起伏(cv)=' + r.cv + '  间隔 p10/中位/p90=' + r.gapPe.join('/') + 'ms');
    console.log('  活跃度分布：<0.2 占 ' + r.actLo + '%  >0.8 占 ' + r.actHi + '%  (共 ' + r.actN + ' 个弹奏点)');
    console.log('  8 段密度 音/秒:');
    bar.forEach((s, i) => console.log('   ' + (i + 1) + '  ' + s));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
