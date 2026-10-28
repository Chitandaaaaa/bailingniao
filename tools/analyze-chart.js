/* 谱面质量分析：拍点对齐度 / 密度递进 / 速度递进 / 判定窗口 */
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
    await page.waitForTimeout(3000);

    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, D = g.DIFFS[G.mode];
      const BEAT = 0.6, END = 214.8;
      const ns = G.notes.slice();
      const dev = ns.map(n => {
        const b = Math.abs(n.t / BEAT - Math.round(n.t / BEAT)) * BEAT * 1000; // ms
        return b;
      });
      dev.sort((a, b) => a - b);
      const onBeat = dev.filter(d => d < 30).length / ns.length;
      const onHalf = dev.filter(d => d < 90).length / ns.length;
      const part = (a, b) => ns.filter(n => n.t >= a && n.t < b).length / (b - a);
      const third = END / 3;
      const laneCnt = [0, 0, 0, 0, 0]; ns.forEach(n => laneCnt[n.lane]++);
      const gaps = [];
      for (let i = 1; i < ns.length; i++) gaps.push((ns[i].t - ns[i - 1].t) * 1000);
      gaps.sort((a, b) => a - b);
      return {
        mode: G.mode, n: ns.length, laneCnt,
        onBeat30: +(onBeat * 100).toFixed(1),
        onBeat90: +(onHalf * 100).toFixed(1),
        devMed: Math.round(dev[dev.length >> 1]),
        dens: [+part(0, third).toFixed(2), +part(third, 2 * third).toFixed(2), +part(2 * third, END).toFixed(2)],
        gapMin: Math.round(gaps[0]), gapMed: Math.round(gaps[gaps.length >> 1]),
        win: D.win, speed: D.speed, speedEnd: D.speedEnd,
        speedAt: [D.speed, Math.round(D.speed * (1 + (D.speedEnd - 1) * 0.5)), Math.round(D.speed * D.speedEnd)],
        minGap: D.minGap, minGapEnd: D.minGapEnd
      };
    });
    console.log('\n[' + mode + '] 音数=' + r.n + ' 轨道=' + r.laneCnt.join('/') +
      ' | 正拍±30ms ' + r.onBeat30 + '%  ±90ms ' + r.onBeat90 + '% 偏差中位 ' + r.devMed + 'ms');
    console.log('  密度 音/秒  前段 ' + r.dens[0] + '  中段 ' + r.dens[1] + '  后段 ' + r.dens[2]);
    console.log('  间隔 min/中位 ' + r.gapMin + '/' + r.gapMed + 'ms   窗口 P±' + r.win.p + 'ms G±' + r.win.g + 'ms');
    console.log('  速度 ' + r.speedAt.join(' → ') + ' px/s   间隔限制 ' + r.minGap + '→' + r.minGapEnd + 'ms');
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
